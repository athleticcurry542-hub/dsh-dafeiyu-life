import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import vm from 'node:vm'
import {buildGrowthContext,proposeGrowth,updateGrowthSuggestion,reviewGrowth,listGrowth} from '../lib/persona-growth.mjs'

const web=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')

// 从真实前端代码中抽取纯排序函数执行，避免测试中的排序副本偏离上线实现。
function getSorter(){
  const start=web.indexOf('  const growthPriority=')
  const end=web.indexOf('  let growthPreviewQuery=',start)
  assert.ok(start>=0&&end>start,'成长排序函数必须存在')
  return vm.runInNewContext(`${web.slice(start,end)}\ngrowthDisplayOrder`,{Date})
}

test('成长经验待审核最前、已批准中间、拒绝最后，组内最近更新的优先',()=>{
  const sort=getSorter()
  const entries=[
    {id:'r1',status:'rejected',updatedAt:'2026-10-25T12:00:00Z'},
    {id:'a1',status:'approved',updatedAt:'2026-10-25T14:00:00Z'},
    {id:'p1',status:'pending',updatedAt:'2026-10-24T14:00:00Z'},
    {id:'r2',status:'rejected',updatedAt:'2026-10-26T12:00:00Z'},
    {id:'p2',status:'pending',updatedAt:'2026-10-25T14:00:00Z'},
    {id:'a2',status:'approved',updatedAt:'2026-10-23T14:00:00Z'}
  ]
  assert.deepEqual(Array.from(sort(entries),x=>x.id),['p2','p1','a1','a2','r2','r1'])
  assert.deepEqual(entries.map(x=>x.id),['r1','a1','p1','r2','p2','a2'],'不得修改服务端原顺序')
  assert.deepEqual(Array.from(sort(entries.filter(e=>e.status==='pending')),x=>x.id),['p2','p1'])
  assert.match(web,/growthDisplayOrder\(entries\.filter\(/,'真实列表必须调用排序函数')
  assert.match(html,/待审核 → 已批准 → 已拒绝/)
})

test('主题 Claude 通过已批准的成长正文/标签本地召回，错误拼写不依赖 AI 纠正',()=>{
  const dir=mkdtempSync(join(tmpdir(),'growth-recall-v2443-'))
  try{
    const pending=proposeGrowth(dir,{type:'relationship',text:'Claude 小姐和大肥鱼属于同一个虚构 AI 角色世界。'})
    assert.doesNotMatch(buildGrowthContext(dir,{scene:'video',query:'Claude'}),/属于同一个虚构/,'待审核不能参与召回')
    updateGrowthSuggestion(dir,pending.id,{origin:'model',suggestion:'Claude 小姐和大肥鱼在虚构角色世界里互相熟悉，能自然调侃。'})
    reviewGrowth(dir,pending.id,'approved')
    const found=buildGrowthContext(dir,{scene:'video',query:'claude'})
    assert.match(found,/Claude 小姐和大肥鱼/)
    assert.doesNotMatch(buildGrowthContext(dir,{scene:'video',query:'Cluade'}),/Claude 小姐和大肥鱼/)
    assert.doesNotMatch(buildGrowthContext(dir,{scene:'video'}),/Claude 小姐和大肥鱼/,'关系没有主题就不注入')
    const entry=listGrowth(dir).entries[0]
    assert.equal(entry.personName,undefined,'relationship 并无专门的人物字段')
  } finally {rmSync(dir,{recursive:true,force:true})}
  assert.match(html,/本地关键词召回预览，不调用 AI/)
})
