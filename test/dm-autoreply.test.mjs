import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDmAutoReply } from '../lib/dm-autoreply.mjs';
const mk = async (args = {}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'plus-dm-test-'));
  const inbox = [];
  const sent = [];
  let clock = 1_790_000_000_000;
  const config = { enabled:true, strangerEnabled:true, whitelist:['200'], whitelistCooldownSeconds:0, ...args.config };
  const historyCalls = [];
  const params = {dataDir, selfUid:'999', now:()=>clock, logger:{warn(){}, error(){}},
    getConfig:()=>config, fetchIncoming:async()=>inbox,
    send: async (item) => { sent.push(item); return {ok:true}; },
    generateReply: async (req) => { historyCalls.push(req); return 'AI:' + req.text; },
  };
  return { inbox, sent, config, params, historyCalls,
    make: (override={})=>createDmAutoReply({...params,...override}),
    clockForward:(ms)=>{clock+=ms},
    path:dataDir };
};
const msg = (senderUid, messageId, text, extra={}) => ({senderUid, messageId, text, timestampMs:1_790_000_000_000, incoming:true, ...extra});

test('first poll baselines history; stranger receives only once, persisted across restart', async()=>{
  const m=await mk(); const agent=m.make();
  m.inbox.push(msg('100','old','之前发的'));
  assert.deepEqual(await agent.poll(), {initialized:true,baselined:1,sent:0});
  m.inbox.push(msg('100','2','你好'));
  assert.equal((await agent.poll()).sent,1);
  m.inbox.push(msg('100','3','在吗'));
  assert.equal((await m.make().poll()).sent,0);
  assert.equal(m.sent.length,1);
  const state=JSON.parse(await readFile(join(m.path,'dm-autoreply-state.json'),'utf8'));
  assert.equal(state.people['100'].stranger.status,'sent');
});

test('whitelist receives ongoing AI replies with persistent context', async()=>{
  const m=await mk(); const agent=m.make(); await agent.poll();
  m.inbox.push(msg('200','1','第一句'));
  assert.equal((await agent.poll()).sent,1);
  m.inbox.push(msg('200','2','第二句'));
  assert.equal((await m.make().poll()).sent,1);
  assert.equal(m.sent.length,2);
  assert.deepEqual(m.historyCalls[1].history.map(x=>x.text), ['第一句','AI:第一句']);
});

test('ignores outgoing / self messages / system and does not loop', async()=>{
  const m=await mk(); await m.make().poll();
  m.inbox.push(msg('200','1','我自己的', {incoming:false}),msg('999','2','自己', {incoming:true}),msg('300','3','系统',{system:true}));
  assert.equal((await m.make().poll()).sent,0);
  assert.equal(m.sent.length,0);
});

test('stranger failed send is reserved; no automatic repeat', async()=>{
  const m=await mk(); await m.make().poll(); m.inbox.push(msg('101','1','hi'));
  const failing=m.make({send:async()=>{throw new Error('timeout');}});
  assert.equal((await failing.poll()).failed,1);
  assert.equal((await m.make().poll()).sent,0);
  const state=JSON.parse(await readFile(join(m.path,'dm-autoreply-state.json'),'utf8'));
  assert.equal(state.people['101'].stranger.status,'uncertain');
});

test('disabled mode sends nothing, first enable establishes baseline', async()=>{
  const m=await mk({config:{enabled:false}}); m.inbox.push(msg('100','1','老消息'));
  assert.equal((await m.make().poll()).skipped,'disabled');
  m.config.enabled=true;
  assert.equal((await m.make().poll()).baselined,1);
  assert.equal(m.sent.length,0);
});

test('lock prevents a second instance from replying concurrently', async()=>{
  const m=await mk(); await m.make().poll(); m.inbox.push(msg('100','1','hi'));
  let release; let entered;
  const waiting=new Promise(r=>{release=r});
  const gotIn=new Promise(r=>{entered=r});
  const one=m.make({send:async(item)=>{entered(); await waiting; m.sent.push(item); return true;}});
  const pending=one.poll(); await gotIn;
  assert.equal((await m.make().poll()).skipped,'locked');
  release(); await pending;
  assert.equal(m.sent.length,1);
});

test('rate limit defers whitelist without consuming incoming message',async()=>{
  const m=await mk({config:{maxPerPoll:1}}); await m.make().poll();
  m.inbox.push(msg('200','1','a'),msg('201','1','b'));
  m.config.whitelist=['200','201'];
  assert.equal((await m.make().poll()).sent,1);
  assert.equal((await m.make().poll()).sent,1);
  assert.deepEqual(m.sent.map(x=>x.uid),['200','201']);
});

test('legacy daily limit is respected, without consuming deferred messages', async()=>{
  const m=await mk({config:{maxPerDay:1,whitelist:['200','201']}})
  await m.make().poll()
  m.inbox.push(msg('200','1','A'),msg('201','1','B'))
  assert.equal((await m.make().poll()).sent,1)
  assert.equal((await m.make().poll()).sent,0)
  m.clockForward(86400_001)
  assert.equal((await m.make().poll()).sent,1)
})

test('newly received stranger messages get a single acknowledgment even after many polls', async()=>{
  const m=await mk({config:{whitelist:[]}})
  await m.make().poll()
  m.inbox.push(msg('300','2','你好'))
  assert.equal((await m.make().poll()).sent,1)
  m.inbox.push(msg('300','3','还在吗'),msg('300','4','ping'))
  for(let i=0;i<3;i++) assert.equal((await m.make().poll()).sent,0)
  assert.equal(m.sent.length,1)
})
