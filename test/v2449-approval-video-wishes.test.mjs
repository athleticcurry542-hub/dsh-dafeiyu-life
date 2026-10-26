import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDmAutoReply,removeRepeatedApprovalInvitation} from '../lib/dm-autoreply.mjs';
import {parseVideoWishes,updateVideoWishes} from '../lib/video-wishes.mjs';

test('自然表达的双主题视频@请求：美食和颜值分别登记',()=>{
  const text='有那种美食视频，美女视频多艾特我一下';
  assert.deepEqual(parseVideoWishes(text),{topics:['美食','颜值']});
  const person={approval:{status:'approved'}};
  const r=updateVideoWishes(person,text,{uid:'485221842',messageId:'x1',now:1800000000000,limit:3});
  assert.deepEqual(r.topics,['美食','颜值']);
  assert.equal(person.videoWishes.length,2);
  assert.equal(updateVideoWishes(person,text,{uid:'485221842',messageId:'x1',now:1800000001000}).existing,true);
  assert.equal(person.videoWishes.length,2);
  assert.equal(parseVideoWishes('看见美女视频了'),null);
  assert.equal(parseVideoWishes('随便吧'),null);
});

test('获批身份过滤重复投喂要求，普通白饭玩笑仍能正常回复',()=>{
  const text='艾特这事本鱼要看心情啦，先别催啦！美女视频就是不保证了（＾へ＾）想让本鱼上心的话，先投喂一口🍚嘛～';
  const result=removeRepeatedApprovalInvitation(text,'🍚');
  assert.match(result,/艾特这事/);
  assert.doesNotMatch(result,/投喂一口/);
  assert.equal(removeRepeatedApprovalInvitation('先投喂一口🍚嘛～','🍚'),'SKIP');
  assert.equal(removeRepeatedApprovalInvitation('白饭真香，好想吃🍚','🍚'),'白饭真香，好想吃🍚');
});

test('获批私信先记心愿，即便模型失败；历史补录可恢复已处理记录',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'dm-v2449-'));let now=1800000000000;
  const sent=[];const msgs=[];
  let generation=(req)=>'大肥鱼来啦';
  const dm=createDmAutoReply({dataDir,selfUid:'999',now:()=>now,logger:{warn(){},info(){},error(){}},
    getConfig:()=>({enabled:true,strangerEnabled:true,approvalEnabled:true,approvalPhrase:'🍚',
      strangerFirstFixed:true,strangerMaxReplies:1,whitelist:[],whitelistCooldownSeconds:0,wishMentionLimit:3}),
    reviewWish:async()=>({decision:'approve',reason:'正常的娱乐视频偏好'}),fetchIncoming:async()=>msgs,send:async x=>{sent.push(x);return {ok:true}},generateReply:async req=>generation(req)});
  const message=(id,text)=>({incoming:true,senderUid:'485221842',messageId:id,timestampMs:now,text});
  await dm.poll();msgs.push(message('m1','你好'));assert.equal((await dm.poll()).sent,1);
  now+=1000;msgs.push(message('m2','🍚'));await dm.poll();
  assert.equal((await dm.reviewApproval('485221842','approve')).ok,true);
  now+=1000;await dm.poll();
  generation=async req=> { assert.equal(req.authorization,'approved');return '先投喂一口🍚嘛～'; };
  now+=1000;msgs.push(message('m3','有那种美食视频，美女视频多艾特我一下'));
  assert.equal((await dm.poll()).sent,0); // 单纯重复索要暗号，静默
  const wish=await dm.listVideoWishes();
  assert.deepEqual(wish.map(x=>x.topic),['美食','颜值']);
  assert.equal(wish.length,2);
  assert.equal(sent.length,2);
  // 补录历史操作可重复执行，不会产生额外重复记录
  const backfill=await dm.backfillVideoWishes('485221842');
  assert.equal(backfill.ok,true);
  assert.equal((await dm.listVideoWishes()).length,2);
  const state=JSON.parse(await readFile(join(dataDir,'dm-autoreply-state.json'),'utf8'));
  assert.equal(state.people['485221842'].approval.status,'approved');
});

test('已记录在历史中的请求可人工补录，无须重新发送消息',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'dm-old-wishes-'));
  const dm=createDmAutoReply({dataDir,selfUid:'999',now:()=>1800000000000,
    getConfig:()=>({enabled:true,approvalEnabled:true,strangerEnabled:true,whitelistCooldownSeconds:0}),
    reviewWish:async()=>({decision:'approve',reason:'正常的娱乐视频偏好'}),fetchIncoming:async()=>[],send:async()=>({ok:true}),generateReply:async()=> 'OK',logger:{warn(){},error(){}}});
  await dm.poll();
  const {writeFile}=await import('node:fs/promises');
  await writeFile(join(dataDir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,sentAt:[],people:{'123':{seen:[],history:[{role:'user',text:'有那种美食视频，美女视频多艾特我一下'}],approval:{status:'approved'}}}}));
  const result=await dm.backfillVideoWishes('123');
  assert.equal(result.ok,true);assert.deepEqual(result.topics,['美食','颜值']);
  assert.equal((await dm.listVideoWishes()).length,2);
});
