import test from 'node:test'
import assert from 'node:assert/strict'
import {shouldRunWindow} from '../lib/peak-schedule.mjs'
const now=new Date('2026-10-24T20:00:00Z')
test('default keeps once per window on the same date',()=>{
 assert.equal(shouldRunWindow({now,windowKey:'2026-10-24:night',windows:{'2026-10-24:night':true}}).allowed,false)
 assert.equal(shouldRunWindow({now,windowKey:'2026-10-24:noon',windows:{'2026-10-24:night':true}}).allowed,true)
})
test('interval permits another round after elapsed minutes',()=>{
 assert.equal(shouldRunWindow({now,windowKey:'2026-10-24:night',intervalMinutes:120,lastRunAt:'2026-10-24T17:59:59Z'}).allowed,true)
 assert.equal(shouldRunWindow({now,windowKey:'2026-10-24:night',intervalMinutes:120,lastRunAt:'2026-10-24T18:01:00Z'}).allowed,false)
})
test('stale old key does not block interval runs',()=>{
 assert.equal(shouldRunWindow({now,windowKey:'2026-10-24:night',intervalMinutes:60,windows:{'2026-10-24:night':true},lastRunAt:'2026-10-24T18:30:00Z'}).allowed,true)
})
test('handles missing and future start timestamps safely',()=>{
 assert.equal(shouldRunWindow({now,windowKey:'2026-10-24:night',intervalMinutes:60}).allowed,true)
 assert.equal(shouldRunWindow({now,windowKey:'2026-10-24:night',intervalMinutes:60,lastRunAt:'2026-10-25T00:00:00Z'}).allowed,false)
})
test('configuration and UI include interval and API allowlist',async()=>{
 const fs=await import('node:fs/promises')
 const index=await fs.readFile(new URL('../index.js',import.meta.url),'utf8')
 const client=await fs.readFile(new URL('../client.js',import.meta.url),'utf8')
 assert.match(index,/peakIntervalMinutes: z\.natural\(\)\.default\(0\)/)
 assert.match(index,/['"]peakIntervalMinutes['"]/)
 assert.match(client,/谷时自动运行间隔/)
})
