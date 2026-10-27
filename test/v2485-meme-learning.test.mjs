import test from 'node:test'
import assert from 'node:assert/strict'
import {createMemeLearning} from '../lib/meme-learning.mjs'
const row=(id,bvid,name='奶蛙')=>({id,bvid,name,evidence:'真实评论文字',evidence_type:'评论'})
test('跨视频反思至少两个真实 BV，使用已有 observation ID 才能提交',async()=>{
  let captured=[],calls=0
  const engine=createMemeLearning({getConfig:()=>({masterEnabled:true,memeMemoryEnabled:true}),read:async()=>({ok:true,rows:[row(1,'BV1ab2345678'),row(2,'BV1cd2345678'),row(3,'BV1ef2345678','无关名称')]}),invokeModel:async()=>{calls++;return JSON.stringify({entries:[{name:'奶蛙',kind:'角色',meaning:'来自不同视频的角色形象线索，出处仍待核实',observation_ids:[1,2]},{name:'奶蛙',kind:'梗',meaning:'伪造的不可验证引用内容',observation_ids:[2,999]}]})},commit:async p=>{captured=p.entries;return {ok:true,created:p.entries.length}}})
  const x=await engine.reflect({force:true})
  assert.equal(x.created,1)
  assert.equal(calls,1)
  assert.equal(captured[0].kind,'角色')
  assert.deepEqual(captured[0].observation_ids,[1,2])
})
test('不足两个不同 BV 的线索不会调用语义模型，关闭时不调用',async()=>{
  let calls=0,active=true
  const engine=createMemeLearning({getConfig:()=>({masterEnabled:true,memeMemoryEnabled:active}),read:async()=>({ok:true,rows:[row(1,'BV1ab2345678'),row(2,'BV1ab2345678')]}),invokeModel:async()=>{calls++;return '{}'},commit:async()=>({ok:true})})
  assert.equal((await engine.reflect()).skipped,'insufficient-cross-video-evidence')
  active=false
  assert.equal((await engine.reflect()).skipped,'disabled')
  assert.equal(calls,0)
})
