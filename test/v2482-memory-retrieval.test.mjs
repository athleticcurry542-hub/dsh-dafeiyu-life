import test from 'node:test'
import assert from 'node:assert/strict'
import {createMemoryRetriever,memoryIndex,validateMemorySelection} from '../lib/memory-retriever.mjs'
import {validateHeadlessOverlayText,HEADLESS_DENY_TOOLS} from '../lib/headless-security.mjs'
import {readFileSync} from 'node:fs'

const memory=[
  {id:'owner',text:'主人现在的称呼是浪哥',事实键:'主人.称呼',category:'stable_profile',importance:.99,source:'main-session-ai'},
  {id:'claude',text:'大肥鱼认识虚构角色 Claude 小姐，经常互相调侃',事实键:'关系.Claude',tags:['Claude','克劳德'],category:'stable_profile',importance:.98,source:'main-session-ai'},
  {id:'bili1',text:'我在 B站看到过模型娘的二创',tags:['模型娘','二创'],importance:.7,source:'life-reflection'},
  {id:'tea',text:'主人最喜欢喝冰美式',事实键:'主人.偏好.饮料',importance:.97,source:'main-session-ai'},
  {id:'old',text:'主人旧称呼',事实键:'主人.称呼',importance:.99,source:'main-session-ai',已被取代:{by:'owner'}}
]
const conf={mainSessionMemoryEnabled:true,mainSessionMemorySemanticEnabled:true,mainSessionMemoryMaxItems:6,mainSessionMemoryMaxChars:800,mainSessionMemoryCandidates:12,mainSessionMemorySearchDailyLimit:3}
test('常驻身份不依赖聊天关键词命中，已被取代的旧事实不会复活',()=>{
  const r=createMemoryRetriever({getMemories:()=>memory,getConfig:()=>({...conf,mainSessionMemorySemanticEnabled:false})})
  assert.match(r.localContext('今天怎么样','chat'),/浪哥/)
  assert.doesNotMatch(r.localContext('今天怎么样','chat'),/旧称呼/)
})
test('低成本模型只允许选择候选索引里的 ID，正文始终由本地可信记忆提供',async()=>{
  let calls=0
  const r=createMemoryRetriever({getMemories:()=>memory,getConfig:()=>conf,invokeModel:async text=>{
    calls++;assert.match(text,/<memory_index>/);assert.doesNotMatch(text,/shell.*允许/i)
    return '{"memory_ids":["claude"],"confidence":0.92}'
  }})
  const result=await r.retrieve('那个紫色模型小姐是谁','chat')
  assert.equal(result.usedModel,true);assert.equal(result.reason,'semantic');assert.match(result.context,/Claude/);assert.equal(calls,1)
})
test('模型编造不存在的记忆 ID 会被拒绝并退回本地检索',async()=>{
  const r=createMemoryRetriever({getMemories:()=>memory,getConfig:()=>conf,invokeModel:async()=>'{"memory_ids":["fabricated"]}',logger:{warn(){}}})
  const result=await r.retrieve('我过去有什么偏好','chat')
  assert.equal(result.reason,'fallback');assert.equal(result.usedModel,true);assert.match(result.context,/浪哥/)
  assert.throws(()=>validateMemorySelection('{"memory_ids":["missing"]}',['owner']),/候选之外/)
})
test('B站公开评论及其他用户私信不能取得主人的私人长期记忆',async()=>{
  const r=createMemoryRetriever({getMemories:()=>memory,getConfig:()=>({...conf,mainSessionMemorySemanticEnabled:false})})
  const comment=await r.retrieve('模型娘','comment');assert.equal(comment.context,'')
  assert.doesNotMatch(comment.context,/浪哥|冰美式|Claude/)
  const dm=await r.retrieve('主人喜欢什么','dm');assert.equal(dm.context,'')
})
test('禁用独立模型不会额外调用；每日次数硬限，0 表示禁用',async()=>{
  let calls=0
  const config={...conf,mainSessionMemorySearchDailyLimit:1}
  const r=createMemoryRetriever({getMemories:()=>memory,getConfig:()=>config,invokeModel:async()=>{calls++;return '{"memory_ids":[]}'}})
  await r.retrieve('紫色模型小姐','chat');await r.retrieve('某位 AI 朋友','chat')
  assert.equal(calls,1)
  const zero=createMemoryRetriever({getMemories:()=>memory,getConfig:()=>({...config,mainSessionMemorySearchDailyLimit:0}),invokeModel:async()=>{throw Error('must not call')}})
  assert.equal((await zero.retrieve('紫色模型小姐','chat')).usedModel,false)
})
test('内存检索索引不会包含废弃条目，且限定索引数',()=>{
  const result=memoryIndex(memory,'Claude',2)
  assert.ok(result.shortlist.length<=2)
  assert.ok(!result.shortlist.some(x=>x.m.id==='old'))
})
test('专用 headless-memory overlay 禁用所有工作站工具和 B站 MCP',()=>{
  const rows=[];for(const id of HEADLESS_DENY_TOOLS)rows.push('- id: '+id,'  disabled: true','')
  for(const id of ['credentials','authorization','deepseek-account'])rows.push('- id: '+id,'  disabled: false','')
  rows.push('- id: agent-default-model','  config:',"    provider: 'cheap-provider'","    model: 'cheap-model'")
  assert.equal(validateHeadlessOverlayText(rows.join('\n'),'memory').ok,true)
  assert.throws(()=>validateHeadlessOverlayText(rows.join('\n')+"\n- insert:\n    - id: mcp-bili-duty",'memory'),/非预期插件|不应挂载/)
})
test('管理中心有独立检索模型开关、模型输入框与手动召回诊断',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(html,/id="main-memory-model-provider"/);assert.match(html,/id="main-memory-test"/)
  assert.match(js,/mainSessionMemorySemanticEnabled/);assert.match(js,/main-session\/memory\/recall/)
})
