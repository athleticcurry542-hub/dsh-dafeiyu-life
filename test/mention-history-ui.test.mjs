import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const ui=readFileSync(new URL('../client.js',import.meta.url),'utf8')
const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
test('daily mention history endpoint only reads fixed today local jsonl',()=>{
  assert.match(server,/path === '\/api\/bili-duty\/mention-diagnostics'/)
  assert.match(server,/join\(stateDir, 'mention-diagnostics', `\$\{day\}\.jsonl`\)/)
  for(const field of ['notMentioned','attempted','total','failed','recent']) assert.ok(server.includes(field))
})
test('settings UI shows counts and reasons without another model',()=>{
  for(const phrase of ['今日 @ 诊断','尝试 @','未 @','AI 决定不 @','AI 想 @，但没有选中名单内好友','尝试 @ 不保证通知送达']) assert.ok(ui.includes(phrase),phrase)
  assert.ok(ui.includes("jget('/mention-diagnostics')"))
})
test('tool no longer returns verbose AI-facing mention decision, but preserves receipt',()=>{
  assert.ok(py.includes('return _comment_result(out, bvid, rpid, mention_diagnostic, meme_diagnostic)'))
  assert.ok(!py.includes('"mention_diagnostic": mention_diagnostic'))
  assert.ok(py.includes('"mention_delivery": "uid_mapping_submitted_unverified"'))
})

test('host preserves AI intent for diagnostics while target selection remains validated',()=>{
  assert.ok(server.includes('should_mention: args.should_mention === true'))
  assert.ok(server.includes('mention_names: choice.targets.map(t=>t.name)'))
})
