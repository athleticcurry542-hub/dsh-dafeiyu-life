import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommentVideoContext} from '../lib/comment-video-context.mjs';

const BV='BV1bWHT6xEJg';
const openDir=()=>mkdtemp(join(tmpdir(),'v2463-root-'));

test('已知 root_id 时优先直接查询对应主评论，不必在前12条热评碰运气',async()=>{
 const dir=await openDir();
 try{
  const called=[];
  const context=createCommentVideoContext({stateDir:dir,
   getInfo:async()=>({title:'钓鱼视频'}),getSubtitle:async()=>({}),
   getHot:async()=>{called.push('hot');return {comments:Array.from({length:12},(_,i)=>({rpid:String(3000+i),user:'其他人',content:'热评'+i}))}},
   getThread:async(bvid,root,rpid)=>{called.push('thread');assert.equal(root,'98765');assert.equal(rpid,'90002');return {
    root_comment:{rpid:'98765',name:'视频观众',content:'原始主评论（完全不在热评里）'},
    replies:[{rpid:'90001',name:'大肥鱼',content:'钓上来的要是我'},{rpid:'90002',name:'次元小哆啦',content:'大肥鱼上钩了'}],target_found:true
   }}
  });
  const result=await context.forReply(BV,{kind:'notice',root:'98765',rpid:'90002',targetId:'90001',text:'大肥鱼上钩了',context:'钓上来的要是我'});
  assert.deepEqual(called,['thread','hot']);
  assert.equal(result.counts.rootComment,true);
  assert.match(result.text,/当前楼层主评论（楼中楼接口按 root_id 直接返回的主评论）：视频观众：原始主评论/);
  assert.match(result.text,/当前最新其他热门评论/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('不能将目标子回复或其他楼层的 root_comment 误标为当前楼层主评论',async()=>{
 const dir=await openDir();
 try{
  const context=createCommentVideoContext({stateDir:dir,
   getInfo:async()=>({title:'视频标题'}),getSubtitle:async()=>({}),
   getHot:async()=>({comments:[{rpid:'90002',content:'这是子回复，不能冒充主评论'},{rpid:'33333',content:'其他楼层热评'}]}),
   getThread:async()=>({root_comment:{rpid:'44444',name:'别人',content:'另一楼层的主评论'},replies:[{rpid:'90002',name:'目标',content:'子回复'}]})
  });
  const result=await context.forReply(BV,{kind:'notice',root:'98765',rpid:'90002',text:'子回复',context:'原回复'});
  assert.equal(result.counts.rootComment,false);
  assert.match(result.summary,/未找到主评论/);
  assert.doesNotMatch(result.text,/当前楼层主评论/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('直查主评论接口失败时，只允许备用热评精确匹配 root_id',async()=>{
 const dir=await openDir();
 try{
  const context=createCommentVideoContext({stateDir:dir,
   getInfo:async()=>({title:'视频标题'}),getSubtitle:async()=>({}),
   getHot:async()=>({comments:[{rpid:'98765',user:'原作者',content:'确实是对应楼层'}]}),
   getThread:async()=>({error:'网络暂不可用'})
  });
  const result=await context.forReply(BV,{kind:'notice',root:'98765',rpid:'90002',text:'子回复',context:'父评论'});
  assert.equal(result.counts.rootComment,true);
  assert.match(result.text,/热评或历史快照按 rpid 精确匹配/);
  assert.match(result.text,/确实是对应楼层/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
