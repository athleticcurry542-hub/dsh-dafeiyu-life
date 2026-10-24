import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const index=readFileSync(new URL('../index.js', import.meta.url),'utf8')
const client=readFileSync(new URL('../client.js', import.meta.url),'utf8')
const charter=readFileSync(new URL('../prompts/duty.md',import.meta.url),'utf8')
const python=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
test('one AI decision per bili_reply, not unconditional auto sync',()=>{
  assert.match(index,/sync_to_dynamic: cfg\.commentSyncDynamic === true && args\.sync_to_dynamic === true/)
  assert.match(index,/sync_to_dynamic: \{ type: 'boolean'/)
  assert.match(index,/dynamic_daily_limit: cfg\.dynamicDailyLimit/)
  assert.match(python,/return \(arg is True and/)
  assert.match(charter,/sync_to_dynamic: true\/false/)
})
test('daily cap is part of settings, overlay, status and UI',()=>{
  for(const x of ['dynamicDailyLimit: z.natural().default(3)','BILI_DYNAMIC_DAILY_LIMIT','dynamicSyncUsage','dynamicDailyLimit']) assert.ok(index.includes(x),x)
  for(const x of ['每日最多同步几条动态','今日已尝试','dynamicDailyLimitDraft']) assert.ok(client.includes(x),x)
})
test('no random sync, safe atomic quota',()=>{
  assert.doesNotMatch(python,/randbelow|random\.random/)
  assert.match(python,/BEGIN IMMEDIATE/)
  assert.match(python,/return \"already_attempted\"/)
  assert.match(python,/reservation_failed_no_publish/)
})
