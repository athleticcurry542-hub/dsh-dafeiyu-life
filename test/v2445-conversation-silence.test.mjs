import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
import {createCommentInteract} from '../lib/comment-interact.mjs';
const silent={warn(){},error(){}};
const mk=prefix=>mkdtemp(join(tmpdir(),prefix));

test('模型按每条会话独立选择 reply/skip，跳过不泄露控制字，批量互不影响',async()=>{
  const seen=[];
  const model=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async prompt=>{
    seen.push(prompt);
    return JSON.stringify({items:[{id:'0',action:prompt.includes('新的问题')?'reply':'skip',reply:prompt.includes('新的问题')?'新问题当然可以继续聊':''}]});
  }});
  const [s,r]=await Promise.all([
    model.generate({kind:'comment',mode:'self-top',uid:'100',text:'那就先这样',canSkip:true}),
    model.generate({kind:'dm',uid:'200',text:'新的问题',canSkip:true}),
  ]);
  assert.equal(s,'SKIP');assert.equal(r,'新问题当然可以继续聊');
  assert.match(seen[0],/优先.*不等于必须回复/);
  assert.match(seen[0],/action="skip"/);
  model.stop();
});

test('禁止静默的审批恢复任务拒绝 skip 而不会发送控制字',async()=>{
  const model=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async()=>JSON.stringify({items:[{id:'0',action:'skip',reply:''}]})});
  await assert.rejects(model.generate({kind:'dm',mode:'approval-resume',canSkip:false,uid:'200',text:'🍚'}),/不允许静默/);
  model.stop();
});

test('白名单私信可以自然停聊：不发送、不扣次数、重启不重复；新话题重新回复',async()=>{
  const dir=await mk('dm-silence-'),inbox=[],sent=[],prompts=[];
  let id=0;const clock=1790000000000;
  const m=(text)=>inbox.push({incoming:true,senderUid:'200',messageId:String(++id),timestampMs:clock+id*1000,text});
  const make=()=>createDmAutoReply({dataDir:dir,selfUid:'900',now:()=>clock+id*1000,
    getConfig:()=>({enabled:true,strangerEnabled:false,whitelist:['200'],whitelistCooldownSeconds:0,historyLimit:40}),
    fetchIncoming:async()=>inbox,
    generateReply:async req=>{prompts.push(req);return req.text.includes('新问题')?'继续聊新问题': 'SKIP';},
    send:async req=>(sent.push(req),{ok:true}),logger:silent});
  await make().poll();
  m('那就先这样');
  const r=await make().poll();
  assert.equal(r.sent,0);assert.equal(r.ignored,1);assert.equal(sent.length,0);
  assert.equal((await make().poll()).sent,0);assert.equal(prompts.length,1);
  const db=JSON.parse(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'));
  assert.equal(db.sentAt.length,0);
  assert.equal(db.people['200'].lastRepliedAt,0);
  assert.equal(db.people['200'].history.at(-1).text,'那就先这样');
  m('新问题：在吗？');
  assert.equal((await make().poll()).sent,1);
  assert.equal(sent.length,1);
  assert.equal(prompts[1].history.at(-1).text,'那就先这样');
});

test('后台评论可对本人主评论下的收尾留言静默，下次开启新话题仍能接话',async()=>{
  const dir=await mk('comment-silence-'),items=[],sent=[],requested=[];
  const clock=1800000000000;
  const add=(n,text)=>items.push({user:{mid:123},item:{business_id:1,subject_id:123456789,source_id:n,target_id:55555,root_id:55555,source_time:Math.floor(clock/1000),source_content:text}});
  const make=()=>createCommentInteract({dataDir:dir,now:()=>clock,selfUid:()=> '900',logger:silent,
    getConfig:()=>({watchReplies:true,watchTop:false,replyPerDay:20,replyPerPoll:5,globalDailyLimit:100}),
    getOwnComments:()=>({top:new Set(['55555']),nested:new Set()}),
    getNotifications:async()=>({data:{items}}),getVideos:async()=>[],getComments:async()=>[],
    generateReply:async req=>(requested.push(req),req.text.includes('新话题')?'能聊聊新话题':'SKIP'),
    send:async req=>(sent.push(req),{ok:true,rpid:'56789'})});
  assert.equal((await make().poll()).sent,0);
  add(900001,'先这样了');
  const first=await make().poll();
  assert.equal(first.sent,0);assert.equal(first.ignored,1);
  assert.equal(requested[0].mode,'self-top');assert.equal(requested[0].mustReply,true);
  assert.equal(requested[0].canSkip,true);
  assert.equal((await make().poll()).sent,0);assert.equal(requested.length,1);
  let db=JSON.parse(await readFile(join(dir,'comment-interact-state.json'),'utf8'));
  assert.equal(db.seen['comment:900001'],'skipped');assert.equal(db.sent.length,0);
  assert.equal(db.sendAttempts.length,0);
  add(900002,'对了，还有新话题');
  assert.equal((await make().poll()).sent,1);
  assert.equal(sent.length,1);
  assert.match(requested.at(-1).context,/先这样了/);
  db=JSON.parse(await readFile(join(dir,'comment-interact-state.json'),'utf8'));
  assert.equal(db.sent.length,1);
});
