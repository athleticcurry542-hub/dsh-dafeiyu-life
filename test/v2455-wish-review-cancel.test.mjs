import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
import {parseVideoWishes, updateVideoWishes, listActiveVideoWishes} from '../lib/video-wishes.mjs';

const silent={info(){},warn(){},error(){}};
const original='有那种美食视频，美女视频多艾特我一下';
async function setup({reviewWish, enabled=false}={}) {
  const dataDir=await mkdtemp(join(tmpdir(),'v2455-wish-'));
  const inbox=[];
  const clock=1800000000000;
  const make=()=>createDmAutoReply({dataDir,now:()=>clock,selfUid:'999',logger:silent,
    getConfig:()=>({enabled,whitelist:['123'],whitelistCooldownSeconds:0}),
    fetchIncoming:async()=>inbox,send:async()=>true,generateReply:async()=> 'SKIP',reviewWish});
  const state=()=>readFile(join(dataDir,'dm-autoreply-state.json'),'utf8').then(JSON.parse);
  return {dataDir,inbox,clock,make,state};
}
const message=(text='有那种美食视频，美女视频多艾特我一下')=>({incoming:true,senderUid:'123',messageId:'bili-message-1',timestampMs:1800000000000,text});

test('同一条私信同时登记美食和颜值，只审一次并应用同一结论',async()=>{
  let calls=0;const seen=[];
  const m=await setup({enabled:true,reviewWish:async req=>{calls++;seen.push(req);return {decision:calls===1?'approve':'reject',reason:'普通内容'};}});
  await m.make().poll();
  await writeFile(join(m.dataDir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,sentAt:[],people:{123:{seen:[],history:[],approval:{status:'approved'}}}}));
  m.inbox.push(message());
  await m.make().poll();
  const rows=await m.make().listVideoWishes();
  assert.equal(calls,1,'不能对同一句原话调用两次审核');
  assert.deepEqual(seen[0].topics,['美食','颜值']);
  assert.deepEqual(new Set(rows.map(w=>w.topic)),new Set(['美食','颜值']));
  assert.deepEqual(new Set(rows.map(w=>w.status)),new Set(['active']));
  assert.equal(listActiveVideoWishes(await m.state(),m.dataDir,m.clock+1).length,2);
});

test('旧记录已经出现一条通过、一条拒绝：重新审核同步两个状态',async()=>{
  let reviews=0;const m=await setup({reviewWish:async req=>{reviews++;assert.equal(req.topics.length,2);return {decision:'approve',reason:'正常的美食和颜值偏好'};}});
  const p={approval:{status:'approved'}};
  const created=updateVideoWishes(p,original,{uid:'123',messageId:'old-one',now:m.clock,reviewRequired:true});
  created.records[0].status='rejected';created.records[0].reviewReason='旧审核误判';
  created.records[1].status='active';created.records[1].reviewedAt=m.clock;
  await writeFile(join(m.dataDir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,sentAt:[],people:{123:p}}));
  const result=await m.make().reviewVideoWish('123',created.records[0].id);
  assert.equal(result.ok,true);assert.equal(reviews,1);
  assert.deepEqual(result.results.map(x=>x.status),['active','active']);
  assert.equal(listActiveVideoWishes(await m.state(),m.dataDir,m.clock+1).length,2);
});

test('取消不应只允许 active：拒绝、待审核及已通过均可逐条移除',async()=>{
  const m=await setup();const p={approval:{status:'approved'}};
  const created=updateVideoWishes(p,original,{uid:'123',messageId:'old-one',now:m.clock,reviewRequired:true});
  created.records[0].status='rejected';created.records[1].status='active';created.records[1].reviewedAt=m.clock;
  const pending=updateVideoWishes(p,'给我找科技视频',{uid:'123',messageId:'old-two',now:m.clock,reviewRequired:true});
  assert.equal(pending.record.status,'pending_review');
  await writeFile(join(m.dataDir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,sentAt:[],people:{123:p}}));
  for(const record of [...created.records,...pending.records]){
    const out=await m.make().cancelVideoWish('123',record.id);
    assert.equal(out.ok,true,record.status);
    assert.equal((await m.make().listVideoWishes()).some(x=>x.id===record.id),false);
  }
  assert.equal((await m.make().listVideoWishes()).length,0);
  assert.equal((await m.make().cancelVideoWish('123',created.records[0].id)).ok,false);
  const raw=await m.state();assert.ok(raw.people['123'].videoWishes.every(x=>x.status==='cancelled'));
});

test('重新审核失败应保持待审核，不可将未明确批准的请求加入搜索',async()=>{
  const m=await setup({reviewWish:async()=>{throw Error('mock timeout');}});
  const p={approval:{status:'approved'}};const created=updateVideoWishes(p,original,{uid:'123',now:m.clock,reviewRequired:true});
  created.records[0].status='rejected';
  await writeFile(join(m.dataDir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,sentAt:[],people:{123:p}}));
  const result=await m.make().reviewVideoWish('123',created.records[0].id);
  assert.equal(result.status,'pending_review');
  assert.equal((await m.make().listVideoWishes()).every(x=>x.status==='pending_review'),true);
  assert.equal(listActiveVideoWishes(await m.state(),m.dataDir,m.clock+1).length,0);
});

test('敏感请求的硬拦截优先于多主题合并审核',async()=>{
  let calls=0;const m=await setup({enabled:true,reviewWish:async()=>{calls++;return {decision:'approve',reason:'假审批'};}});
  await m.make().poll();
  await writeFile(join(m.dataDir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,sentAt:[],people:{123:{seen:[],history:[],approval:{status:'approved'}}}}));
  m.inbox.push(message('有那种美食和色情美女视频多艾特我一下'));
  await m.make().poll();
  assert.equal(calls,0);
  assert.equal((await m.make().listVideoWishes()).every(x=>x.status==='rejected'),true);
});

test('AI 审核提示词要求不得根据“美女”臆测成人内容；界面允许拒绝心愿移除',()=>{
  const code=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
  assert.match(code,/不能仅因“美女”二字推测擦边或色情/);
  assert.match(ui,/移除这条心愿/);
  assert.match(ui,/同条私信的 /);
  assert.deepEqual(parseVideoWishes(original).topics,['美食','颜值']);
});
