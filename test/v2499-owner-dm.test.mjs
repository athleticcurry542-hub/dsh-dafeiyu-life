import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {parseOwnerDmTodo,queueOwnerDmReadTodo} from '../lib/owner-dm-commands.mjs'

test('B站主人指令仅解析固定只读格式，不相信外部转述或写操作',()=>{
 assert.equal(parseOwnerDmTodo('大肥鱼 看 BV19SJi6VEj1').type,'watch_video')
 assert.equal(parseOwnerDmTodo('大肥鱼 搜索 奶蛙').type,'search_videos')
 assert.equal(parseOwnerDmTodo('大肥鱼 看一下给我点赞 BV19SJi6VEj1'),null)
 assert.equal(parseOwnerDmTodo('他说：“大肥鱼 看 BV19SJi6VEj1”'),null)
 assert.equal(parseOwnerDmTodo('大肥鱼 点赞 BV19SJi6VEj1'),null)
})
test('仅已配置并通过 inbox 验证的精确主人 UID 能入队，重复消息不新增',()=>{
 const home=mkdtempSync(join(tmpdir(),'v2499-dm-'))
 try{
  const todos=createOwnerTodoEngine({dataDir:home})
  const messages=[{incoming:true,senderUid:'12345',messageId:'m1',timestampMs:Date.now(),text:'大肥鱼 看 BV19SJi6VEj1'}, {incoming:true,senderUid:'12346',messageId:'m2',timestampMs:Date.now(),text:'大肥鱼 看 BV19SJi6VEj1'}]
  assert.equal(queueOwnerDmReadTodo({messages,ownerUid:'12345',enabled:false,todos}).added,0)
  assert.equal(queueOwnerDmReadTodo({messages,ownerUid:'12345',enabled:true,todos}).added,1)
  assert.equal(queueOwnerDmReadTodo({messages,ownerUid:'12345',enabled:true,todos}).added,0)
  const row=todos.list()[0]
  assert.equal(row.origin.kind,'owner-dm');assert.equal(row.ownerAuthorized,false)
  assert.match(row.origin.quotedText,/大肥鱼 看/)
 }finally{rmSync(home,{recursive:true,force:true})}
})
