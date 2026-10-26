import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createCommentVideoContext} from '../lib/comment-video-context.mjs';
import {createCommentInteract} from '../lib/comment-interact.mjs';

const BV='BV1bWHT6xEJg';

test('普通楼中楼回复获取视频资料、字幕、主评论、目标附近的回复和多条热评',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2462-context-'));
 let subtitles=0,hot=0,threads=0,targetSeen='';
 try{
  const comments=[{rpid:'700',user:'原作者',content:'主评论：大肥鱼有那么多' }];
  for(let i=1;i<=8;i++)comments.push({rpid:String(700+i),user:'热评用户'+i,content:'热门评论内容'+i});
  const ctx=createCommentVideoContext({stateDir:dir,
   getInfo:async()=>({title:'真实视频标题',description:'真实视频简介'}),
   getSubtitle:async()=>{subtitles++;return {text:'实际从视频取得的字幕内容'}},
   getHot:async()=>{hot++;return {comments}},
   getThread:async(bvid,root,target)=>{threads++;targetSeen=String(target);return {replies:[
    {rpid:'701',name:'大肥鱼',content:'钓上来的要是我，可别一拉竿就想跑哦'},
    {rpid:'702',name:'次元小哆啦',content:'大肥鱼上钩了'},
    {rpid:'703',name:'大肥鱼',content:'谁上钩还不一定呢'},
    {rpid:'704',name:'另一位观众',content:'继续拉扯'}],target_found:true}}
  });
  const result=await ctx.forReply(BV,{kind:'notice',root:'700',rpid:'702',targetId:'701',text:'大肥鱼上钩了',context:'钓上来的要是我，可别一拉竿就想跑哦'});
  assert.equal(result.usable,true);
  assert.equal(targetSeen,'702');
  assert.equal(subtitles,1);assert.equal(hot,1);assert.equal(threads,1);
  for(const text of ['真实视频标题','真实视频简介','实际从视频取得的字幕内容','主评论：大肥鱼有那么多','钓上来的要是我','大肥鱼上钩了','谁上钩还不一定呢','继续拉扯','热门评论内容3','热门评论内容8'])assert.match(result.text,new RegExp(text));
  assert.match(result.summary,/最新热评取回 9 条 \/ 额外提供 6 条（设置 12）/);assert.match(result.summary,/楼中楼 4 条/);assert.match(result.summary,/有字幕/);
  await ctx.forReply(BV,{kind:'notice',root:'700',rpid:'702',targetId:'701',text:'大肥鱼上钩了',context:'上一层'});
  assert.equal(subtitles,1);assert.equal(hot,1);assert.equal(threads,1);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('手动要求回复返回回执与上下文摘要，并把上下文摘要保存到诊断',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2462-manual-'));
 const record={id:'comment:1112759450',uid:'1112759450',name:'次元小哆啦',aid:'117500977089472',bvid:BV,rpid:'1112759450',root:'321',targetId:'654',scope:'self-nested',text:'回复 @大肥鱼：大肥鱼上钩了',context:'钓上来的要是我，可别一拉竿就想跑哦',reason:'ai_generation_error',at:Date.now()};
 try{
  await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify({version:1,notificationBootstrapped:true,seen:{},sent:[],replyRecords:[],replyDiagnostics:[record],atDiagnostics:[],sendAttempts:[],ownReplies:{},threadHistory:{}}));
  let detailsSeen=null,sentPayload=null;
  const engine=createCommentInteract({dataDir:dir,selfUid:async()=>'900',getConfig:()=>({watchReplies:true,replyPerDay:20,globalDailyLimit:100,ownNestedPerUser:5}),
   getNotifications:async()=>({code:0,data:{items:[]}}),getOwnComments:async()=>({top:['321'],nested:['654']}),
   getVideoContext:async(bvid,details)=>{detailsSeen=details;return {usable:true,text:'视频标题、字幕、主评论、楼中楼和热门评论',summary:'视频标题/简介 · 有字幕 · 已取得主评论 · 最新热评 9 条 · 楼中楼 4 条'}},
   generateReply:async req=>{assert.equal(req.forceReply,true);assert.equal(req.canSkip,false);assert.match(req.context,/视频标题、字幕/);return '谁上钩还不一定呢！'},
   send:async req=>{sentPayload=req;return {ok:true,rpid:'888888'}},logger:{warn(){},error(){}}});
  const result=await engine.forceReply({id:'comment:1112759450'});
  assert.equal(detailsSeen.targetId,'654');assert.equal(detailsSeen.rpid,'1112759450');
  assert.equal(result.ok,true);assert.equal(result.reply,'谁上钩还不一定呢！');assert.match(result.contextSummary,/楼中楼 4 条/);
  assert.equal(sentPayload.manual,true);
  const status=engine.status();assert.equal(status.replyDiagnostics[0].reason,'sent');assert.match(status.replyDiagnostics[0].contextSummary,/最新热评 9 条/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('手动回复按钮在等待、成功和失败时都有卡片内回执',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
 assert.match(js,/请求已提交：正在重新读取视频、字幕、主评论、楼中楼和热门评论/);
 assert.match(js,/发送回执已确认：/);
 assert.match(js,/本次未确认成功：/);
 assert.match(js,/manual-reply-status/);
});

test('热门评论中没有主评论时，从楼中楼接口返回的根评论补足',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2462-root-fallback-'));
 try{
  const ctx=createCommentVideoContext({stateDir:dir,getInfo:async()=>({title:'视频标题'}),getSubtitle:async()=>({}),
   getHot:async()=>({comments:[{rpid:'900',content:'别的热评'}]}),
   getThread:async()=>({root_comment:{rpid:'321',name:'原作者',content:'楼层根评论正文'},replies:[{rpid:'654',name:'回复者',content:'目标回复'}]})});
  const result=await ctx.forReply(BV,{kind:'notice',root:'321',rpid:'654',text:'目标回复',context:'父评论'});
  assert.match(result.text,/楼层根评论正文/);assert.match(result.summary,/已取得主评论/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
