import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {apply} from '../index.js'

function fixture(){
 const home=mkdtempSync(join(tmpdir(),'bili-console-'))
 let handler=null
 const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
   logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
 apply(ctx,{})
 async function call(method,path,body,headers={host:'127.0.0.1:7012'}){
   const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
   req.url='/api/bili-duty/'+path;req.method=method;req.headers=headers
   let code,headersOut,payload
   const res={writeHead(c,h){code=c;headersOut=h},end(x){payload=String(x??'')}}
   await handler(req,res)
   return {code,headers:headersOut,text:payload,json(){return JSON.parse(payload)}}
 }
 return {call,close:()=>rmSync(home,{recursive:true,force:true})}
}

test('manage HTML and JS are served from same DSH route without extra port or process',async()=>{
 const fx=fixture();try{
   const h=await fx.call('GET','manage')
   assert.equal(h.code,200)
   assert.match(h.headers['content-type'],/text\/html/)
   assert.match(h.headers['content-security-policy'],/script-src 'self'/)
   assert.match(h.text,/成长记忆/)
   assert.match(h.text,/梗知识库/)
   assert.match(h.text,/限额聊天申请/)
   assert.match(h.text,/manage\.js/)
   const js=await fx.call('GET','manage.js')
   assert.equal(js.code,200)
   assert.match(js.headers['content-type'],/javascript/)
   assert.match(js.text,/meme-memory\/review/)
   assert.match(js.text,/dm-approvals/)
   assert.ok(!js.text.includes('.innerHTML ='))
   assert.ok(!h.text.includes('18763'))
 }finally{fx.close()}
})

test('management page API rejects different localhost port and hostile web origin',async()=>{
 const fx=fixture();try{
   const hostile=await fx.call('GET','manage',undefined,{host:'127.0.0.1:7012',origin:'https://evil.example'})
   assert.equal(hostile.code,403)
   const otherPort=await fx.call('POST','persona-growth',{action:'add',type:'style',text:'明显可用的主人纠正经验'},
    {host:'127.0.0.1:7012',origin:'http://127.0.0.1:9812'})
   assert.equal(otherPort.code,403)
   const okay=await fx.call('POST','persona-growth',{action:'add',type:'style',text:'明显可用的主人纠正经验'},
    {host:'127.0.0.1:7012',origin:'http://127.0.0.1:7012'})
   assert.equal(okay.code,200)
 }finally{fx.close()}
})

test('meme moderation invalid writes are rejected; empty library is safe',async()=>{
 const fx=fixture();try{
   const listing=await fx.call('GET','meme-memory?q=奶蛙')
   assert.equal(listing.code,200)
   assert.equal(listing.json().total,0)
   const bad=await fx.call('POST','meme-memory/review',{id:-3,status:'approved'})
   assert.equal(bad.code,400)
 }finally{fx.close()}
})


test('管理中心复用原生设置接口修改限额申请开关和额度',async()=>{
 const fx=fixture();try{
  const initial=(await fx.call('GET','config')).json();
  assert.equal(initial.ok,true);
  const change=await fx.call('POST','config',{dmApprovalEnabled:true,dmApprovalPhrase:'白饭🍚',dmApprovedDailyLimit:3,dmApprovedTotalLimit:12});
  assert.equal(change.code,200);
  assert.equal(change.json().ok,true);
  const saved=(await fx.call('GET','config')).json().config;
  assert.equal(saved.dmApprovalEnabled,true);
  assert.equal(saved.dmApprovedDailyLimit,3);
  assert.equal(saved.dmApprovedTotalLimit,12);
 }finally{fx.close()}
});
