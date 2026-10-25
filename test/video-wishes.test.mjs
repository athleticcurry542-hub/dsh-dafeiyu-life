import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {parseVideoWish,updateVideoWishes,listActiveVideoWishes} from '../lib/video-wishes.mjs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
test('DM 0=unlimited and 21–1000 are not reduced to 20',()=>{
  assert.match(source,/dmReplyPerDay\s*=\s*Math\.max\(0,\s*Math\.min\(1000,/);
  assert.doesNotMatch(source,/dmReplyPerDay\s*=\s*Math\.max\(0,\s*Math\.min\(20,/);
  assert.match(source,/maxPerDay: cfg\.dmReplyPerDay/);
});
test('recognize explicit food request; do not subscribe random chat',()=>{
  assert.deepEqual(parseVideoWish('给我找点好吃的'),{topic:'美食'});
  assert.deepEqual(parseVideoWish('有啥萌宠视频推荐吗'),{topic:'宠物'});
  assert.equal(parseVideoWish('星星眼是在夸我还是夸这题'),null);
  assert.equal(parseVideoWish('好吃好吃'),null);
  assert.deepEqual(parseVideoWish('别@我了'),{cancel:true});
});
test('only approved UID may create wish and has bounded count and expiry',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'wish-'));
  const person={approval:{status:'pending'}};
  assert.equal(updateVideoWishes(person,'给我找点好吃的',{uid:'123',limit:100}),null);
  person.approval.status='approved';
  const wish=updateVideoWishes(person,'给我找点好吃的',{uid:'123',limit:100,now:1700000000000,messageId:'m1'});
  assert.equal(wish.record.limit,10);
  assert.equal(updateVideoWishes(person,'再找点美食',{uid:'123',limit:3}).existing,true);
  const state={people:{123:person}};
  assert.equal(listActiveVideoWishes(state,dir,1700000000001).length,1);
  await mkdir(join(dir,'video-wish-claims'));
  await writeFile(join(dir,'video-wish-claims',wish.record.id+'--video1.json'),JSON.stringify({id:wish.record.id,status:'accepted'}));
  assert.equal(listActiveVideoWishes(state,dir,1700000000001)[0].accepted,1);
  updateVideoWishes(person,'取消找视频',{uid:'123'});
  assert.equal(listActiveVideoWishes(state,dir,1700000000001).length,0);
});
test('approval -> queued answer -> explicit food request creates persistent cancellable wish',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'wish-dm-'));let at=1800000000000;
  const incoming=[],sent=[];const cfg={enabled:true,strangerEnabled:true,approvalEnabled:true,approvalPhrase:'🍚',
    strangerMaxReplies:1,whitelist:[],whitelistCooldownSeconds:0,wishMentionLimit:2};
  const dm=createDmAutoReply({dataDir,selfUid:'999',getConfig:()=>cfg,now:()=>at,
    fetchIncoming:async()=>incoming,send:async x=>{sent.push(x);return {ok:true}},generateReply:async()=> '本鱼吃饱啦🐳',
    logger:{warn(){},error(){}}});
  const msg=(id,text)=>({incoming:true,senderUid:'123',messageId:id,text,timestampMs:at});
  await dm.poll();incoming.push(msg('m1','嗨'));assert.equal((await dm.poll()).sent,1);
  at+=1000;incoming.push(msg('m2','🍚'));await dm.poll();
  assert.equal((await dm.reviewApproval('123','approve')).ok,true);
  at+=1000;assert.equal((await dm.poll()).sent,1);
  at+=1000;incoming.push(msg('m3','给我找点好吃的'));assert.equal((await dm.poll()).sent,1);
  const wishes=await dm.listVideoWishes();assert.equal(wishes.length,1);
  assert.equal(wishes[0].topic,'美食');assert.equal(wishes[0].limit,2);
  assert.equal((await dm.cancelVideoWish('123',wishes[0].id)).ok,true);
  assert.equal((await dm.listVideoWishes()).length,0);
  assert.equal(sent.length,3);
  assert.match(sent[1].text,/哪天本鱼刷到/);
  assert.doesNotMatch(sent[1].text,/审核|后台|申请/);
});

test('actual DM poll respects 21, 1000 and 0 caps for ordinary accounts',async()=>{
  for(const cap of [21,1000,0]) {
    const dataDir=await mkdtemp(join(tmpdir(),'dm-cap-'));
    let n=0;const inbox=[];const config={enabled:true,whitelist:[],
      strangerEnabled:true,whitelistCooldownSeconds:0,maxPerPoll:20,maxPerHour:120,maxPerDay:cap};
    const dm=createDmAutoReply({dataDir,selfUid:'999',getConfig:()=>config,now:()=>1800000000000,
      fetchIncoming:async()=>inbox,generateReply:async()=> '消息已收到',
      send:async()=>{n++;return {ok:true}},logger:{warn(){},error(){}}});
    await dm.poll();
    for(let i=0;i<30;i++)inbox.push({senderUid:String(500+i),messageId:'m'+i,incoming:true,timestampMs:1800000000000,text:'hello'});
    await dm.poll();await dm.poll();await dm.poll();
    assert.equal(n,cap===21?21:30);
  }
});
