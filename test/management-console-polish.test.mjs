import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const python=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
test('recent comment link targets a specific rpid instead of only opening the video',()=>{
  assert.match(js,/safeCommentLink/)
  assert.match(js,/定位具体评论 · rpid/)
  assert.match(js,/\?comment=/)
  assert.match(js,/safeCommentLink\(c\)/)
})
test('comment per-poll limit and per-user own-comment limits are visually separated',()=>{
  assert.match(html,/主动参与视频热评/)
  assert.match(html,/优先回复别人对大肥鱼自己评论的留言/)
  assert.match(html,/每轮最多回复（1–5）/)
  assert.match(html,/与上面的“每轮最多回复”不是同一概念/)
})
test('DM page separates private-message quotas and context from public comment quotas',()=>{
  assert.match(html,/私信额度与上下文/)
  assert.match(html,/只统计自动发送的私信，不包含公开评论/)
  assert.match(html,/每日自动私信回复上限（0=不限，最大1000）/)
  assert.match(html,/每次回复读取的私信上下文条数（0–80/)
})
test('dynamic decision diagnosis distinguishes AI choice from send receipt',()=>{
  assert.match(html,/今日动态同步诊断/)
  assert.match(html,/dynamic-summary/)
  assert.match(js,/dynamic_ai_decision/)
  assert.match(index,/dynamicRecent: dynamicEvents/)
  assert.match(python,/dynamic_ai_decision/)
})
test('persona settings contain core persona only; approved growth is joined at model-call time',()=>{
  assert.match(client,/这里只保存核心人设，不包含成长系统的附加经验/)
  assert.match(client,/已批准经验只会在实际调用模型时按场景临时拼接/)
  assert.match(index,/buildGrowthContext\(stateDir,\{scene:/)
})
