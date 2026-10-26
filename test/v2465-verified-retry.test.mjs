import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommentInteract} from '../lib/comment-interact.mjs';

const BV='BV1hrWF6mE1m', AID='117500977089472';
const raw=items=>({code:0,data:{items}});
const reply=(rpid,uid=1420423830)=>({user:{mid:uid,uname:'蒂瀚'},item:{business:'评论',business_id:1,
  subject_id:AID,source_id:String(rpid),root_id:'7000000',target_id:'8000000',
  source_content:'放我肚子里[doge]',target_reply_content:'冰箱要是真被搬走，大米饭往哪放啊，我先急了',
  uri:'https://www.bilibili.com/video/'+BV,timestamp:Math.floor(Date.now()/1000)}});
const make=(dir,getItems,generateReply,send,ctx=async()=>({usable:true,text:'视频标题、楼中楼、热评'}))=>createCommentInteract({
  dataDir:dir,selfUid:async()=> '900',getConfig:()=>({watchReplies:true,replyPerDay:20,globalDailyLimit:100,ownTopPerUser:10,ownNestedPerUser:10}),
  getNotifications:async()=>raw(getItems()),getOwnComments:async()=>({top:['7000000'],nested:['8000000']}),
  getVideoContext:ctx,generateReply,send,logger:{warn(){},error(){}}
});
const statePath=dir=>join(dir,'comment-interact-state.json');

async function scenario(fn){const dir=await mkdtemp(join(tmpdir(),'bili-verified-'));let items=[];
 try{
  let draftCalls=0,sends=0;
  const engine=make(dir,()=>items,async()=>{draftCalls++;return '大米饭先放小鱼肚子里好了[doge]'},async()=>{sends++;throw Error('B站接口报错 HTTP 412')});
  await engine.poll({notifications:true,mentions:false,top:false});items=[reply('900001')];
  await engine.poll({notifications:true,mentions:false,top:false});
  assert.equal(engine.status().replyDiagnostics[0].reason,'send_failed');
  return await fn({dir,items,engine,gets:()=>({draftCalls,sends})});
 }finally{await rm(dir,{recursive:true,force:true})}}

test('人工核对未发出：重发已保存 AI 草稿，不再调用 AI 或视频 API，成功后完全禁止重发',async()=>{
 await scenario(async({dir,items,engine,gets})=>{
  assert.equal(engine.status().replyDiagnostics[0].retryBlocked,true);
  assert.equal(engine.status().replyDiagnostics[0].manualRetryAllowed,true);
  assert.equal(engine.status().replyDiagnostics[0].manualRetryRemaining,3);
  await assert.rejects(()=>engine.forceReply({id:'comment:900001'}),/请先在 B站核对/);
  assert.deepEqual(gets(),{draftCalls:1,sends:1});
  let resendArgs=null;
  const reloaded=make(dir,()=>items,async()=>{throw Error('不得再次调用 AI')},async req=>{resendArgs=req;return {ok:true,rpid:'77889900'}},async()=>{throw Error('已有草稿时不得读取视频 API')});
  const ack=await reloaded.forceReply({id:'comment:900001',confirmedMissing:true});
  assert.equal(ack.ok,true);assert.equal(ack.verifiedRetry,true);assert.equal(ack.reusedDraft,true);
  assert.equal(resendArgs.text,'大米饭先放小鱼肚子里好了[doge]');
  const row=reloaded.status().replyDiagnostics[0];
  assert.equal(row.reason,'sent');assert.equal(row.manualRetryAllowed,false);assert.equal(row.retryBlocked,true);
  await assert.rejects(()=>reloaded.forceReply({id:'comment:900001',confirmedMissing:true}),/已发送/);
  const persisted=JSON.parse(await readFile(statePath(dir),'utf8'));
  assert.equal(persisted.sendAttempts.at(-1).verifiedMissing,true);
  assert.equal(persisted.sendAttempts.at(-1).reusedDraft,true);
  assert.equal(persisted.sendAttempts.at(-1).outcome,'success');
  assert.equal(persisted.manualVerifiedRetries['source:'+AID+':900001'].length,1);
 });
});

test('历史失败记录没有 AI 草稿：人工确认后才重新生成；发送不成功保留新草稿与原因',async()=>{
 await scenario(async({dir,items})=>{
  const db=JSON.parse(await readFile(statePath(dir),'utf8'));
  db.replyDiagnostics[0].generatedReply='';delete db.replyDiagnostics[0].errorDetail;
  await writeFile(statePath(dir),JSON.stringify(db));
  let generated=0,sendCount=0;
  const reloaded=make(dir,()=>items,async()=>{generated++;return '先放鱼肚子里，包保鲜！'},async req=>{sendCount++;assert.match(req.text,/包保鲜/);throw Error('接口返回 HTTP 500')});
  await assert.rejects(()=>reloaded.forceReply({id:'comment:900001',confirmedMissing:true}),/发送失败/);
  assert.equal(generated,1);assert.equal(sendCount,1);
  const row=reloaded.status().replyDiagnostics[0];
  assert.equal(row.reason,'manual_send_failed');assert.match(row.generatedReply,/包保鲜/);
  assert.match(row.errorDetail,/HTTP 500/);assert.equal(row.manualRetryAllowed,true);
  assert.equal(row.manualRetryRemaining,2);
 });
});

test('人工核对重试上限为24小时3次，且失败后不会自动重试',async()=>{
 await scenario(async({dir,items,engine,gets})=>{
  for(let i=0;i<3;i++){
   const status=engine.status().replyDiagnostics[0];
   assert.equal(status.manualRetryAllowed,true);
   assert.equal(status.manualRetryRemaining,3-i);
   await assert.rejects(()=>engine.forceReply({id:'comment:900001',confirmedMissing:true}),/发送失败/);
  }
  assert.equal(engine.status().replyDiagnostics[0].manualRetryAllowed,false);
  assert.equal(engine.status().replyDiagnostics[0].manualRetryRemaining,0);
  await assert.rejects(()=>engine.forceReply({id:'comment:900001',confirmedMissing:true}),/重试次数/);
  assert.deepEqual(gets(),{draftCalls:1,sends:4});
  await engine.poll({notifications:true,mentions:false,top:false});
  assert.deepEqual(gets(),{draftCalls:1,sends:4});
 });
});

test('跨通知源已发送或发送中：即使人工确认也不能覆盖成功/待发送状态',async()=>{
 await scenario(async({dir,items})=>{
  const source='source:'+AID+':900001';
  for(const state of ['sent','manual-sent','pending','manual-pending']){
   const db=JSON.parse(await readFile(statePath(dir),'utf8'));
   db.seen[source]=state;await writeFile(statePath(dir),JSON.stringify(db));
   const engine=make(dir,()=>items,async()=>{throw Error('AI 不应调用')},async()=>{throw Error('禁止重复发送')});
   const row=engine.status().replyDiagnostics[0];assert.equal(row.manualRetryAllowed,false);
   await assert.rejects(()=>engine.forceReply({id:'comment:900001',confirmedMissing:true}),/已发送|正在发送/);
  }
 });
});

test('确认重试权限不能用于普通跳过记录；接口路由必须显式传入确认字段',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bili-verified-skip-'));try{
  let items=[];const engine=make(dir,()=>items,async()=> 'SKIP',async()=>{throw Error('不得发送')});
  await engine.poll({notifications:true,mentions:false,top:false});items=[reply('900007')];await engine.poll({notifications:true,mentions:false,top:false});
  assert.equal(engine.status().replyDiagnostics[0].reason,'ai_skipped');
  await assert.rejects(()=>engine.forceReply({id:'comment:900007',confirmedMissing:true}),/只有发送失败/);
  const route=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  assert.match(route,/body\?\.confirmedMissing===true/);
  assert.match(route,/forceReply\(\{id,confirmedMissing\}\)/);
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
  assert.match(js,/e\.manualRetryAllowed===true/);
  assert.match(js,/confirmedMissing:true/);
  assert.match(js,/你已在 B站检查该楼层/);
 }finally{await rm(dir,{recursive:true,force:true})}
});


test('旧版本无草稿且视频上下文临时失败时，仍保留人工确认重试入口，不消耗发送重试次数',async()=>{
 await scenario(async({dir,items})=>{
  const db=JSON.parse(await readFile(statePath(dir),'utf8'));
  db.replyDiagnostics[0].generatedReply='';await writeFile(statePath(dir),JSON.stringify(db));
  const unavailable=make(dir,()=>items,async()=>{throw Error('不应调用AI')},async()=>{throw Error('不应发送')},async()=>({usable:false,text:''}));
  await assert.rejects(()=>unavailable.forceReply({id:'comment:900001',confirmedMissing:true}),/上下文不可用/);
  assert.equal(unavailable.status().replyDiagnostics[0].reason,'manual_context_unavailable');
  assert.equal(unavailable.status().replyDiagnostics[0].manualRetryAllowed,true);
  assert.equal(unavailable.status().replyDiagnostics[0].manualRetryRemaining,3);
  const recovered=make(dir,()=>items,async()=> '重新找到视频信息啦',async()=>({ok:true,rpid:'500500'}));
  const ack=await recovered.forceReply({id:'comment:900001',confirmedMissing:true});
  assert.equal(ack.ok,true);assert.equal(ack.reusedDraft,false);
 });
});
