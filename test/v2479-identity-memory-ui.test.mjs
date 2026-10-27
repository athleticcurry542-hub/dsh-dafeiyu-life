import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLongTermMemory,__test} from '../lib/long-term-memory.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-v2479-'))
const defineTool=x=>x
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
function fakeAgent(id){
  const handlers={},contexts=[],sections=[],tools=[]
  const ctx={on:(name,fn)=>{handlers[name]=fn;return()=>{delete handlers[name]}},systemPrompt:{section:spec=>{sections.push(spec);return()=>{}},context:spec=>{contexts.push(spec);return()=>{}}},tools:{register:spec=>{tools.push(spec);return()=>{}}}}
  return {agent:{id,session:{id,snapshotEvents:()=>[]},ctx},handlers,contexts,sections,tools}
}
function config(id='room-a'){
  return {mainSessionId:id,mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.35,mainSessionMemoryMaxItems:6,mainSessionMemoryMaxChars:800,mainSessionMemoryDailyQuota:8,mainSessionMemoryFactsMax:3}
}

test('高置信主人事实可本地确定性提取，并支持同 fact_key 更新',()=>{
  assert.equal(__test.extractDeterministicFacts('以后叫我浪哥')[0].fact_key,'主人.称呼')
  assert.equal(__test.extractDeterministicFacts('我现在最喜欢喝可乐。')[0].fact_key,'主人.偏好.饮料')
  assert.match(__test.extractDeterministicFacts('其实我最近不怎么喝可乐了，现在最喜欢冰美式。')[0].text,/冰美式/)
  assert.equal(__test.extractDeterministicFacts('我不喜欢你每句话都用表情包')[0].fact_key,'主人.互动偏好.表情包')
  assert.equal(__test.extractDeterministicFacts('今天天气不错').length,0)
})

test('主人明确事实在收到消息时直接落入身份记忆，不依赖模型主动调用工具',()=>{
  const dir=temp(),f=fakeAgent('room-a')
  try{
    const mem=createLongTermMemory({dataDir:dir,dshHome:dir,agents:{get:()=>f.agent,list:()=>[f.agent]},getConfig:()=>config(),defineTool})
    mem.start()
    f.handlers['agent/inbox/inserted']({message:{content:[{type:'text',text:'以后叫我浪哥'}]}})
    let rows=mem.list('称呼');assert.equal(rows.filter(x=>!x.已被取代).length,1);assert.match(rows.find(x=>!x.已被取代).text,/浪哥/)
    f.handlers['agent/inbox/inserted']({message:{content:[{type:'text',text:'以后还是叫我主人吧'}]}})
    rows=mem.list('称呼');assert.equal(rows.filter(x=>!x.已被取代).length,1);assert.match(rows.find(x=>!x.已被取代).text,/「主人」/)
    assert.equal(existsSync(join(dir,'long-term-memory','dafeiyu.json')),true)
    assert.equal(existsSync(join(dir,'long-term-memory','room-a.json')),false)
    mem.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('切换主 Session 后读取同一份大肥鱼身份记忆',async()=>{
  const dir=temp(),a=fakeAgent('room-a'),b=fakeAgent('room-b');let room='room-a'
  try{
    const mem=createLongTermMemory({dataDir:dir,dshHome:dir,agents:{get:id=>id.replace(/^session-/,'')==='room-a'?a.agent:b.agent,list:()=>[a.agent,b.agent]},getConfig:()=>config(room),defineTool})
    mem.start();a.handlers['agent/inbox/inserted']({message:{content:[{type:'text',text:'我现在最喜欢喝可乐'}]}})
    assert.match(mem.list('饮料').find(x=>!x.已被取代).text,/可乐/)
    room='room-b';await sleep(900)
    assert.equal(typeof b.handlers['agent/inbox/inserted'],'function')
    b.handlers['agent/inbox/inserted']({message:{content:[{type:'text',text:'我现在喜欢喝什么来着？'}]}})
    const recall=b.contexts.find(x=>x.name==='dafeiyu-memory')?.text?.()||''
    assert.match(recall,/可乐/)
    assert.equal(mem.status().sessionId,'room-b');assert.equal(mem.status().scope,'identity')
    mem.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('v2.4.78 的多个 Session 记忆文件首次升级自动合并，旧文件保留',()=>{
  const dir=temp(),memDir=join(dir,'long-term-memory');mkdirSync(memDir,{recursive:true})
  try{
    writeFileSync(join(memDir,'room-a.json'),JSON.stringify({version:2,policy:{},memories:[{id:'a1',text:'主人希望我叫他浪哥',importance:1,category:'stable_profile',事实键:'主人.称呼',createdAt:'2026-10-26T01:00:00.000Z'}],traces:[],deleted:[]}))
    writeFileSync(join(memDir,'room-b.json'),JSON.stringify({version:2,policy:{},memories:[{id:'b1',text:'主人后来希望我叫他主人',importance:1,category:'stable_profile',事实键:'主人.称呼',createdAt:'2026-10-27T01:00:00.000Z'},{id:'b2',text:'主人最近在研究 DSH',importance:.9,category:'event',createdAt:'2026-10-27T02:00:00.000Z'}],traces:[],deleted:[]}))
    const mem=createLongTermMemory({dataDir:dir,dshHome:dir,agents:{get:()=>null,list:()=>[]},getConfig:()=>config('room-b'),defineTool})
    const st=mem.status();assert.equal(st.scope,'identity');assert.deepEqual(st.legacySessionFiles.sort(),['room-a.json','room-b.json'])
    assert.equal(existsSync(join(memDir,'dafeiyu.json')),true);assert.equal(existsSync(join(memDir,'room-a.json')),true);assert.equal(existsSync(join(memDir,'room-b.json')),true)
    const rows=mem.list('称呼');assert.equal(rows.filter(x=>!x.已被取代).length,1);assert.match(rows.find(x=>!x.已被取代).text,/主人/)
    assert.match(mem.list('DSH')[0].text,/DSH/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('README 与管理中心明确展示三层记忆架构和表情包 AI 更新流程',()=>{
  const root=new URL('..',import.meta.url),html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8'),js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8'),readme=readFileSync(new URL('../README.md',import.meta.url),'utf8'),pkg=readFileSync(new URL('../package.json',import.meta.url),'utf8')
  assert.match(html,/大肥鱼的家 · 当前房间、身份记忆与经历档案/);assert.doesNotMatch(html,/把一个长期 DSH 会话当作“大肥鱼本人”/);assert.match(html,/大肥鱼长期记忆 · 跨 Session 共用/);assert.match(html,/当前主 Session · 短期上下文/);assert.match(html,/大肥鱼长期记忆 · 身份级/);assert.match(html,/精确经历档案/)
  assert.match(html,/导出最新表情包名称 TXT/);assert.match(html,/导出当前规则 JSON/);assert.match(html,/一起交给 AI/)
  assert.match(js,/sticker-workflow-export-names/);assert.match(js,/sticker-workflow-export-rules/);assert.match(js,/跨 Session 共用/);assert.match(js,/本地自动识别/);assert.match(js,/旧 Session 记忆迁移/)
  assert.match(readme,/三层记忆架构：换房间，不换脑子/);assert.match(readme,/dafeiyu\.json/);assert.match(readme,/当前全部表情包名称 TXT \+ 当前规则 JSON/)
  assert.match(pkg,/"version": "2\.4\.79"/)
})
