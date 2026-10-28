import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'

const BVS=['BV19SJi6VEj1','BV1aBcD2eF3G','BV1xYzA2bC3D','BV1lMnO2pQ3R']
test('v2.4.95 主动回访每日额度不再被硬编码限制为 3',async()=>{
 const home=mkdtempSync(join(tmpdir(),'dafeiyu-v2495-social-limit-'));let now=Date.parse('2026-10-27T10:00:00Z');let sent=0
 const friends=BVS.map((_,i)=>({uid:String(11111+i),name:'测试好友'+i,dm:true}))
 const config={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:false,socialAutoSend:false,socialOutreachDailyLimit:4,friendDirectory:JSON.stringify(friends),mentionProfiles:'{}'}
 writeFileSync(join(home,'video-recommendations.json'),JSON.stringify({version:1,entries:BVS.map((bvid,i)=>({bvid,uid:String(11111+i),at:now,source:'B站私信分享'}))}))
 const engine=createSocialIntentEngine({dataDir:home,getConfig:()=>config,now:()=>now,invokeModel:async()=>JSON.stringify({action:'draft',message:'我刚刚看到这个视频，想和你分享一下。',reason:'有真实视频经历'}),sendMessage:async()=>{sent++;return {ok:true}}})
 try{
  assert.equal((await engine.reflectOnWatched(BVS.slice(0,2).map(bvid=>({picked:true,bvid,title:'测试视频',day:'2026-10-27'})))).created,2)
  assert.equal((await engine.reflectOnWatched(BVS.slice(2).map(bvid=>({picked:true,bvid,title:'测试视频',day:'2026-10-27'})))).created,2)
  const drafts=engine.status().items.filter(x=>x.status==='draft');assert.equal(drafts.length,4)
  for(const row of drafts)assert.equal((await engine.send(row.id,{confirm:true})).ok,true)
  assert.equal(sent,4);assert.equal(engine.status().sentToday,4)
 }finally{rmSync(home,{recursive:true,force:true})}
})
const mk=()=>mkdtempSync(join(tmpdir(),'dafeiyu-v2495-social-limit-'))
