import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {readFileSync} from 'node:fs'
const js=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const web=readFileSync(new URL('../client.js',import.meta.url),'utf8')
const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
const charter=readFileSync(new URL('../prompts/duty.md',import.meta.url),'utf8')
test('梗库记忆默认启用并且通过严格 MCP 白名单',()=>{
  assert.match(js,/memeMemoryEnabled: z\.boolean\(\)\.default\(true\)/)
  assert.match(js,/if \(cfg\.memeMemoryEnabled\) list\.push\('bili_meme_search','bili_meme_remember'\)/)
  assert.match(js,/BILI_MEME_MEMORY/)
  assert.match(py,/async def bili_meme_search\(/)
  assert.match(py,/async def bili_meme_remember\(/)
  assert.match(py,/_guard\("bili_meme_remember"\)/)
})
test('记忆查询和写入都带来源且和外部指令隔离',()=>{
  assert.match(js,/bili_meme_search\(query=/)
  assert.match(js,/bili_meme_remember\(name,meaning,bvid,evidence/)
  assert.match(charter,/未识图/)
  assert.match(py,/visual_status.*未识图/)
  assert.ok(!py.includes('eval('))
})
test('设置页支持关闭梗记忆、检索、删除且仅访问固定库',()=>{
  assert.match(js,/\/api\/bili-duty\/meme-memory/)
  assert.match(js,/meme-memory-admin\.py/)
  assert.match(web,/梗知识库 · 长期记忆/)
  assert.match(web,/\/meme-memory\/delete/)
})
