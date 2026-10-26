import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommentInteract} from '../lib/comment-interact.mjs';

const BV='BV1ignA6REjB',AID='117500977089472';
const raw=items=>({code:0,data:{items}});
const reply=(rpid)=>({user:{mid:7934143,uname:'光明谬可'},item:{business:'评论',business_id:1,
  subject_id:AID,source_id:String(rpid),root_id:'4000',target_id:'5000',
  source_content:'回复 @大肥鱼 :是转转',target_reply_content:'查是能查啦',
  uri:'https://www.bilibili.com/video/'+BV,timestamp:Math.floor(Date.now()/1000)}});
const cfg={watchReplies:true,replyPerPoll:2,replyPerDay:12,globalDailyLimit:100,diagReplyInboxEnabled:true};
const make=(dir,getItems,makeReply,send)=>createCommentInteract({dataDir:dir,selfUid:async()=> '900',getConfig:()=>cfg,
  getNotifications:async()=>raw(getItems()),getOwnComments:async()=>({top:[],nested:['5000']}),
  getVideoContext:async()=>({text:'真实视频标题和评论上下文',usable:true,summary:'真实视频标题 · 楼中楼 · 热评'}),
  generateReply:makeReply,send,logger:{warn(){},error(){}}});

test('自动回复：AI 成功但 B站报错，保存草稿及错误，重开诊断仍保留且禁止重复',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2464-auto-'));try{
  let items=[];const engine=make(dir,()=>items,async()=> '哦哦！原来是转转！',async()=>{throw Error('B站接口拒绝：HTTP 412')});
  await engine.poll({notifications:true,top:false,mentions:false});
  items=[reply('400001')];await engine.poll({notifications:true,top:false,mentions:false});
  const row=engine.status().replyDiagnostics[0];
  assert.equal(row.reason,'send_failed');assert.equal(row.generatedReply,'哦哦！原来是转转！');
  assert.match(row.errorDetail,/HTTP 412/);assert.equal(row.retryBlocked,true);
  const state=JSON.parse(await readFile(join(dir,'comment-interact-state.json'),'utf8'));
  assert.equal(state.seen['comment:400001'],'uncertain');
  assert.equal(state.sendAttempts.at(-1).generatedReply,'哦哦！原来是转转！');
  const rebooted=make(dir,()=>items,async()=>{throw Error('AI must not rerun')},async()=>{throw Error('must not send')});
  assert.equal(rebooted.status().replyDiagnostics[0].generatedReply,'哦哦！原来是转转！');
  await assert.rejects(()=>rebooted.forceReply({id:'comment:400001'}),/已发送或曾尝试发送/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('手动回复：AI 成功但 B站发送超时，显示草稿和错误，刷新后保持禁用',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2464-manual-'));try{
  let items=[],force=false;
  const engine=make(dir,()=>items,async()=>force?'还真是转转啊！':'SKIP',async()=>{throw Error('B站接口 ETIMEDOUT，回执未返回')});
  await engine.poll({notifications:true,top:false,mentions:false});
  items=[reply('400002')];await engine.poll({notifications:true,top:false,mentions:false});
  assert.equal(engine.status().replyDiagnostics[0].reason,'ai_skipped');
  force=true;
  await assert.rejects(()=>engine.forceReply({id:'comment:400002'}),/发送结果不确定/);
  const row=engine.status().replyDiagnostics[0];
  assert.equal(row.reason,'manual_send_uncertain');
  assert.equal(row.generatedReply,'还真是转转啊！');
  assert.match(row.errorDetail,/ETIMEDOUT/);
  assert.equal(row.retryBlocked,true);
  assert.equal(make(dir,()=>items,async()=> 'never',async()=>({ok:true})).status().replyDiagnostics[0].retryBlocked,true);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('AI 自己生成失败时没有虚构草稿，但记录 AI 侧真实错误',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2464-ai-error-'));try{
  let items=[];const engine=make(dir,()=>items,async()=>{throw Error('AI gateway 503')},async()=>{throw Error('must not send')});
  await engine.poll({notifications:true,top:false,mentions:false});
  items=[reply('400003')];await engine.poll({notifications:true,top:false,mentions:false});
  const row=engine.status().replyDiagnostics[0];
  assert.equal(row.reason,'ai_generation_error');assert.equal(row.generatedReply,'');
  assert.match(row.errorDetail,/AI gateway 503/);assert.equal(row.retryBlocked,false);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('发送错误诊断脱敏，不泄露常见登录凭证',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2464-secret-'));try{
  let items=[];const engine=make(dir,()=>items,async()=> '我看到了',async()=>{throw Error('B站接口失败 SESSDATA=PRIVATECOOKIE token=a')});
  await engine.poll({notifications:true,top:false,mentions:false});
  items=[reply('400004')];await engine.poll({notifications:true,top:false,mentions:false});
  const row=engine.status().replyDiagnostics[0];
  assert.doesNotMatch(row.errorDetail,/PRIVATECOOKIE/);assert.match(row.errorDetail,/凭证已隐藏/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('管理中心只为可重发的记录显示手动按钮，显示草稿和旧记录说明',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
 assert.match(js,/retryBlocked===true/);
 assert.match(js,/AI 已生成（仅本地草稿，未必发送成功）/);
 assert.match(js,/详细原因：旧版本未保存/);
 assert.match(js,/await loadDiagnostics\(\)\.catch/);
});
