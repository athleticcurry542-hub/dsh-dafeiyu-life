import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {recentComments} from '../lib/recent-comments.mjs'
import {apply} from '../index.js'

function setup(){const dir=mkdtempSync(join(tmpdir(),'bili-recent-'));return {dir,close:()=>rmSync(dir,{recursive:true,force:true})}}
function makeSources(dir){
  mkdirSync(join(dir,'seen'),{recursive:true});mkdirSync(join(dir,'mention-diagnostics'),{recursive:true});
  writeFileSync(join(dir,'seen.md'),[
    '# 判重表','## 评论记录',
    '| BV | rpid | root | 时间 | 正文前20字 |',
    '|---|---|---|---|---|',
    '| BV1234567890 | 321798740304 | 0 | 2026-10-24 21:30 | 这条来自旧判重表 |',
    '- 2026-10-25 08:20 · BV1234567891 · rpid=321798740305 · 正文：自由文本评论',
    '## 看过的视频',
    '| 2026-10-25 | BV1234567892 | 视频标题 | 123456789999 | 已收藏 |',
  ].join('\n'),'utf8')
  writeFileSync(join(dir,'seen','2026-09.md'),'| BV1234567893 | 321798740300 | 0 | 2026-09-11 11:00 | 历史归档 |\n')
  writeFileSync(join(dir,'mention-diagnostics','2026-10-25.jsonl'),[
    JSON.stringify({day:'2026-10-25',time:'2026-10-25T09:00:13+08:00',bvid:'BV1234567894',rpid:'321798740306',kind:'top',success:true}),
    JSON.stringify({day:'2026-10-25',time:'2026-10-25T08:20:17+08:00',bvid:'BV1234567891',rpid:'321798740305',kind:'top',success:true}),
    JSON.stringify({day:'2026-10-25',time:'2026-10-25T09:01:13+08:00',bvid:'BV1234567895',rpid:'321798740307',kind:'reply',success:true}),
    JSON.stringify({day:'2026-10-25',time:'2026-10-25T10:00:13+08:00',bvid:'BV1234567896',rpid:'321798740308',kind:'top',success:false}),
    JSON.stringify({day:'2026-10-25',time:'2026-10-25T10:20:13+08:00',bvid:'BV1234567897',rpid:'',kind:'top',success:true}),
    '{corrupt',
    JSON.stringify({day:'2026-10-25',time:'2026-10-25T15:20:13+08:00',bvid:'not a BV',rpid:'321798740309',kind:'top',success:true}),
  ].join('\n'),'utf8')
}
test('combine verified tool submissions, free text, old seen table and archives without claiming B站 visibility',()=>{
 const fx=setup();try{
  makeSources(fx.dir)
  const before=readFileSync(join(fx.dir,'seen.md'),'utf8')
  const x=recentComments(fx.dir,{limit:20})
  assert.equal(x.total,6) // 24th, freeform 25th, archive, new 25th, reply, idless
  assert.equal(x.rows[0].bvid,'BV1234567897')
  assert.ok(x.rows.some(r=>r.bvid==='BV1234567894' && r.rpid==='321798740306' && r.hasReceipt))
  assert.ok(x.rows.some(r=>r.bvid==='BV1234567895' && r.kind==='reply'))
  assert.ok(x.rows.some(r=>r.bvid==='BV1234567891' && r.snippet==='自由文本评论' && r.hasReceipt))
  assert.ok(x.rows.some(r=>r.bvid==='BV1234567893' && r.snippet==='历史归档'))
  assert.ok(!x.rows.some(r=>r.bvid==='BV1234567896'))
  assert.ok(!x.rows.some(r=>r.bvid==='BV1234567892'))
  assert.equal(x.counts.withoutId,1)
  assert.match(x.note,/不等于 B站 已公开/)
  assert.equal(readFileSync(join(fx.dir,'seen.md'),'utf8'),before)
 }finally{fx.close()}
})
test('date filter, total, offset/limit pagination, and zero record day',()=>{
 const fx=setup();try{
  makeSources(fx.dir)
  const x=recentComments(fx.dir,{day:'2026-10-25',limit:2,offset:2})
  assert.equal(x.total,4)
  assert.equal(x.rows.length,2)
  assert.equal(x.offset,2)
  assert.ok(x.days.includes('2026-10-24'))
  assert.equal(recentComments(fx.dir,{day:'2026-10-23'}).total,0)
  assert.equal(recentComments(fx.dir,{day:'../../file'}).total,6) // invalid day ignored; path never opened
 }finally{fx.close()}
})
test('real HTTP route aggregates diagnostic rows missing from seen.md and exposes counts',async()=>{
 const home=mkdtempSync(join(tmpdir(),'bili-recent-http-'));let handler
 try{
  const ctx={get:k=>k==='dshHomePath'?(...p)=>join(home,...p):undefined,logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
  apply(ctx,{})
  const dir=join(home,'bili-duty');makeSources(dir)
  async function get(path){
   const req=Readable.from([]);req.url='/api/bili-duty/'+path;req.method='GET';req.headers={host:'127.0.0.1:9011'}
   let code,payload;const res={writeHead(c){code=c},end(x){payload=String(x||'')}}
   await handler(req,res);return {code,data:JSON.parse(payload)}
  }
  const r=await get('recent-comments?day=2026-10-25&limit=50')
  assert.equal(r.code,200);assert.equal(r.data.total,4)
  assert.ok(r.data.rows.some(x=>x.bvid==='BV1234567894'))
  const d=await get('recent-comments?day=2026-10-24&limit=50')
  assert.equal(d.data.total,1)
 }finally{rmSync(home,{recursive:true,force:true})}
})
