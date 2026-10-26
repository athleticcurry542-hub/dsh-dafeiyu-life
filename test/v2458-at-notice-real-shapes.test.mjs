import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bvToAv,avToBv} from '../lib/bv-to-av.mjs';
import {normalizeAtNotifications} from '../lib/comment-inbox.mjs';
import {createCommentVideoContext} from '../lib/comment-video-context.mjs';
import {createCommentInteract} from '../lib/comment-interact.mjs';
const bv='BV1ignA6REjB',aid=bvToAv(bv),self='123456',uid='1217526350';
function msg(id,{root='0',timestamp=Date.now(),uri=`https://www.bilibili.com/video/av${aid}`,from=uid}={}){
 return {id,at_time:Math.trunc(timestamp/1000),user:{mid:from,nickname:'来token来'},item:{business_id:1,business:'评论',subject_id:aid,
  source_id:String(id+5000),root_id:root,target_id:'0',source_content:'@大肥鱼 来看看这个视频！',uri,at_details:[{mid:self}]}};
}
const wrap=items=>({at:{code:0,data:{items}}});
test('AID/BV 双向转换精确，不能从不可信的 AID 猜出来',()=>{
 assert.equal(avToBv(aid),bv);
 assert.equal(avToBv('170001'),'BV17x411w7KC');
 assert.equal(avToBv('not-an-id'),'');
 assert.equal(avToBv('99999999999999999999'),'');
});
test('@ 通知只带 AID/av 链接也能识别；顶层评论没有 root_id 是合法的',()=>{
 const one=normalizeAtNotifications(wrap([msg(101)]),self);
 assert.equal(one.length,1);assert.equal(one[0].bvid,bv);assert.equal(one[0].aid,aid);
 assert.equal(one[0].root,'');assert.equal(one[0].rpid,'5101');
 const two=normalizeAtNotifications(wrap([msg(102,{uri:''})]),self);
 assert.equal(two.length,1);assert.equal(two[0].bvid,bv);
 const three=normalizeAtNotifications({at:[{code:0,data:{items:[msg(103)]}}]},self);
 assert.equal(three.length,1);
});
test('无真实视频定位、非视频@和@了其他账号都拒绝，诊断保留原因',()=>{
 const rejected=[];
 const invalid=msg(20);invalid.item.subject_id='0';invalid.item.uri='';
 const dynamic=msg(21);dynamic.item.business_id=11;
 const other=msg(22);other.item.at_details=[{mid:'9999'}];
 const rows=normalizeAtNotifications(wrap([invalid,dynamic,other]),self,{onIgnored:x=>rejected.push(x)});
 assert.equal(rows.length,0);
 assert.deepEqual(rejected.map(x=>x.reason),['video_reference_missing','not_video_comment','mention_not_for_account']);
});
test('顶层 @ 只有真实视频标题+最新热评+通知原评论即可生成上下文，不错误要求楼中楼',async()=>{
 let getThread=0;
 const dir=await mkdtemp(join(tmpdir(),'v2458-top-at-'));
 try{
  const ctx=createCommentVideoContext({stateDir:dir,getInfo:async()=>({title:'真实视频名',description:'真实简介'}),
   getHot:async()=>({comments:[{rpid:'123',content:'最新热评'}]}),getThread:async()=>{getThread++;throw Error('不应查询父楼层')}});
  const result=await ctx.forReply(bv,{kind:'at',root:'',rpid:'5101',text:'@大肥鱼 来看看'});
  assert.equal(getThread,0);assert.equal(result.usable,true);assert.match(result.text,/真实视频名/);assert.match(result.text,/最新热评/);
  const negative=createCommentVideoContext({stateDir:dir,getInfo:async()=>({title:'视频标题'}),getHot:async()=>({error:'bad'})});
  assert.equal((await negative.forReply(bv,{kind:'at',root:'',rpid:'5101',text:'来看看'})).usable,false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('第一次轮询基线后，下一条只有 AID 的新 @ 白名单用户成功回复；原因在状态页可查',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2458-at-poll-'));
 let notices=[msg(1)],sent=[],generated=[];
 try{
  const ctx=createCommentVideoContext({stateDir:dir,getInfo:async()=>({title:'实际视频标题'}),getHot:async()=>({comments:[{rpid:'7',content:'真实热门评论'}]})});
  const engine=createCommentInteract({dataDir:dir,selfUid:async()=>self,getConfig:()=>({watchAt:true,atMode:'whitelist',atWhitelist:uid+'|来token来',replyPerPoll:2,replyPerDay:20,globalDailyLimit:100}),
   getAtNotifications:async()=>wrap(notices),getVideoContext:(bv,d)=>ctx.forReply(bv,d),getOwnComments:async()=>({top:[],nested:[]}),
   generateReply:async p=>{generated.push(p);return '叫我干嘛呀'},send:async p=>{sent.push(p);return {ok:true,rpid:'123456'}}});
  await engine.poll({notifications:false,top:false,mentions:true});assert.equal(sent.length,0);
  assert.equal(engine.status().atDiagnostics[0].reason,'first_poll_baseline');
  notices=[...notices,msg(2)];const result=await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(result.sent,1);assert.equal(sent.length,1);assert.equal(sent[0].bvid,bv);
  assert.equal(sent[0].root,'');assert.equal(generated[0].mode,'at');
  assert.equal(engine.status().atDiagnostics[0].reason,'sent');
  const db=JSON.parse(await readFile(join(dir,'comment-interact-state.json'),'utf8'));
  assert.equal(db.seen['at:2'],'sent');
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('旧解析器升级时将已存在的@基线化，不把历史未识别通知批量补发',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2458-migration-'));
 let notices=[msg(33)],sent=0;
 try{
  const {writeFile}=await import('node:fs/promises');
  await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify({version:1,atBootstrapped:true,
   notificationBootstrapped:true,seen:{},sent:[],replyRecords:[]}));
  const engine=createCommentInteract({dataDir:dir,selfUid:async()=>self,getConfig:()=>({watchAt:true,atMode:'all',replyPerPoll:2,replyPerDay:10,globalDailyLimit:100}),
   getAtNotifications:async()=>wrap(notices),getOwnComments:async()=>({top:[],nested:[]}),getVideoContext:async()=>({usable:true,text:'视频标题和热评'}),
   generateReply:async()=> '我来啦',send:async()=>{sent++;return {ok:true,rpid:'9'}}});
  await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(sent,0);assert.equal(engine.status().atDiagnostics[0].reason,'parser_upgrade_baseline');
  notices=[...notices,msg(34)];await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(sent,1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
