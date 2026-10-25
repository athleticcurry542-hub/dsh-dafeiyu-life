import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
const silent={warn(){},error(){}};
async function runConfig(historyLimit){
 const dataDir=await mkdtemp(join(tmpdir(),'v2437-dmctx-'));
 const inbox=[],calls=[],sent=[];
 let n=0,time=1800000000000;
 const ctrl=createDmAutoReply({dataDir,selfUid:'900',logger:silent,now:()=>time,
   getConfig:()=>({enabled:true,whitelist:['100'],historyLimit,whitelistCooldownSeconds:0}),
   fetchIncoming:async()=>inbox,send:async r=>(sent.push(r),true),generateReply:async r=>(calls.push(r),'收到')});
 await ctrl.poll();
 for(let i=0;i<5;i++){inbox.push({senderUid:'100',messageId:'m'+i,timestampMs:time+ ++n,text:'消息'+i,incoming:true});await ctrl.poll();time+=5000;}
 return {calls,sent};
}
test('私信上下文大小可设为0并禁用旧摘要注入',async()=>{
 const d=await runConfig(0);assert.equal(d.sent.length,5);
 for(const c of d.calls){assert.deepEqual(c.history,[]);assert.equal(c.olderContext,'');}
});
test('私信上下文设置2条时只传最近2条与更早摘要',async()=>{
 const d=await runConfig(2);
 assert.equal(d.calls.at(-1).history.length,2);
 assert.match(d.calls.at(-1).olderContext,/消息0/);
});
