import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommentInteract} from '../lib/comment-interact.mjs';

const silent={warn(){},error(){}};
const notice=(id,text='大肥鱼来吃饭啦')=>({user:{mid:123},item:{business_id:1,subject_id:987654321,source_id:id,root_id:777,source_content:text,target_reply_content:'大肥鱼前面说过要吃饭'}});
async function rig({send,limit=100}={}){
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-comment-quota-v2440-'));
  const items=[],sent=[],generated=[];let time=1790000000000;
  const cfg={watchReplies:true,watchTop:false,replyPerPoll:5,replyPerDay:100,globalDailyLimit:limit,ownTopPerUser:5,ownNestedPerUser:5};
  const handler=createCommentInteract({dataDir,logger:silent,now:()=>time,selfUid:()=> '900',getConfig:()=>cfg,
    getOwnComments:async()=>({top:new Set(),nested:new Set()}),getNotifications:async()=>({data:{items}}),getVideos:async()=>[],getComments:async()=>({comments:[]}),
    generateReply:async req=>(generated.push(req),'来啦来啦！'),
    send:async req=>{sent.push(req);return send?send(req):{ok:true,rpid:String(456789100000+sent.length)};}});
  // First poll establishes a baseline, so only later notifications can be replied to.
  await handler.poll();
  return {dataDir,items,sent,generated,cfg,handler,add:(id,text)=>items.push(notice(id,text)),advance:ms=>time+=ms};
}

test('全局额度拦截后整轮暂停，不重复生成/调用；额度变化后可重试',async()=>{
  let block=true;
  const x=await rig({send:async()=>block?{ok:false,error:'本日公开评论/回复已达到硬上限 100'}:{ok:true,rpid:'456789123456'}});
  x.add(300001);
  const first=await x.handler.poll();
  assert.equal(first.quotaBlocked,1);
  assert.equal(x.sent.length,1);
  assert.equal(x.generated.length,1);
  const second=await x.handler.poll();
  assert.equal(second.skipped,'global-quota-exhausted');
  assert.equal(x.sent.length,1);
  assert.equal(x.generated.length,1);
  let status=x.handler.status();
  assert.equal(status.sentLast24Hours,0);
  assert.equal(status.sendBlockedByGlobalQuotaLast24Hours,1);
  assert.equal(status.sendFailedLast24Hours,0);
  assert.equal(status.globalQuotaBlocked,true);
  // 用户提高全局上限后重新检查，不会把之前被额度拦截的通知永久判重。
  x.cfg.globalDailyLimit=200;block=false;
  const third=await x.handler.poll();
  assert.equal(third.sent,1);
  status=x.handler.status();
  assert.equal(status.sentLast24Hours,1);
  assert.equal(status.sendBlockedByGlobalQuotaLast24Hours,1);
  assert.equal(status.globalQuotaBlocked,false);
  const db=JSON.parse(await readFile(join(x.dataDir,'comment-interact-state.json'),'utf8'));
  assert.equal(db.seen['comment:300001'],'sent');
});

test('后台回复状态区分成功回执与发送失败，失败不冒充成功',async()=>{
  const x=await rig({send:async()=>({ok:false,error:'B站评论接口拒绝请求'})});
  x.add(300002);
  const result=await x.handler.poll();
  assert.equal(result.failed,1);
  const status=x.handler.status();
  assert.equal(status.sentLast24Hours,0);
  assert.equal(status.sendFailedLast24Hours,1);
  assert.equal(status.sendAttemptsLast24Hours,1);
  assert.equal(status.sendAttemptHistoryAvailable,true);
});
