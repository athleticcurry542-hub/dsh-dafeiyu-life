import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommentVideoContext} from '../lib/comment-video-context.mjs';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';

const BV='BV1bWHT6xEJg';
const hotRows=Array.from({length:30},(_,i)=>({rpid:String(90000+i),user:'观众'+i,content:'这里是热评编号'+String(i).padStart(2,'0')+'的评论内容'}));

test('热评配置既控制接口请求数，也控制交给模型的样本数，无第二次AI筛选',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2463-hot-'));
 try{
  let limit=12;const calls=[];
  const context=createCommentVideoContext({stateDir:dir,getHotLimit:()=>limit,
    getInfo:async()=>({title:'真实视频标题',description:'说明'}),
    getHot:async(_bv,count)=>{calls.push(count);return {comments:hotRows.slice(0,count)}},
    getThread:async()=>({root_comment:{rpid:'777777',name:'原作者',content:'确实是主评论'},replies:[]})});
  const details={kind:'notice',root:'777777',rpid:'80000',text:'要不要看',context:'大肥鱼已经回复'};
  const a=await context.forReply(BV,details);
  assert.equal(a.counts.hotLimit,12);assert.equal(a.counts.hotProvided,12);
  assert.equal(calls[0],12);assert.match(a.text,/热评编号11/);
  assert.ok(a.text.includes('当前楼层主评论'));
  const b=await context.forReply(BV,details);
  assert.equal(calls.length,1,'相同数量在两分钟内复用缓存');
  assert.equal(b.counts.hotProvided,12);
  limit=30;const c=await context.forReply(BV,details);
  assert.deepEqual(calls,[12,30],'数量变化后不使用较少条数的缓存');
  assert.equal(c.counts.hotProvided,30);
  assert.match(c.text,/热评编号29/);
  let actualPrompt='';
  const batch=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async prompt=>{
    actualPrompt=prompt;return JSON.stringify({items:[{id:'0',action:'reply',reply:'好'}]});
  }});
  try{assert.equal(await batch.generate({kind:'comment',uid:'123',text:'试试',context:c.text}), '好')}
  finally{batch.stop()}
  const parsed=JSON.parse(actualPrompt.split('消息：').pop());
  assert.match(parsed[0].context,/热评编号00/);
  assert.match(parsed[0].context,/热评编号29/,'最末尾的热门评论必须真正进入AI提示');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('用户配置保存链路贯通默认值、白名单、数字限制和管理页',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
 assert.match(index,/commentReplyHotCount: z\.natural\(\)\.default\(12\)/);
 assert.match(index,/commentReplyHotCount',1,30,12/);
 assert.match(index,/getHotLimit: \(\)=>cfg\.commentReplyHotCount/);
 assert.match(js,/comment-reply-hot-count','commentReplyHotCount',1,30,12/);
 assert.match(html,/id="comment-reply-hot-count"/);
});
