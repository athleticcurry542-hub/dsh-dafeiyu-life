import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {proposeGrowth,updateGrowthSuggestion,reviewGrowth,ingestReportText,buildGrowthContext,listGrowth} from '../lib/persona-growth.mjs'
import {apply} from '../index.js'

const withDir=fn=>{const dir=mkdtempSync(join(tmpdir(),'growth-category-'));try{return fn(dir)}finally{rmSync(dir,{force:true,recursive:true})}}
const addApproved=(dir,type,text,tags=[])=>{
 const x=proposeGrowth(dir,{type,text,tags})
 updateGrowthSuggestion(dir,x.id,{origin:'model',suggestion:text})
 return reviewGrowth(dir,x.id,'approved')
}

test('owner feedback cannot bypass model: model suggestion -> owner revision -> approval',()=>withDir(dir=>{
 const x=proposeGrowth(dir,{type:'style',text:'评论不要直接复述原视频台词然后机械评价。'})
 assert.throws(()=>reviewGrowth(dir,x.id,'approved'),/模型/)
 assert.throws(()=>updateGrowthSuggestion(dir,x.id,{origin:'owner',suggestion:'评论要表达自己的感受，不机械复述台词。'}),/先由大模型提炼/)
 updateGrowthSuggestion(dir,x.id,{origin:'model',suggestion:'评论先理解笑点，再表达本鱼自己的情绪，不原样复述视频台词。'})
 updateGrowthSuggestion(dir,x.id,{origin:'owner',suggestion:'评论时要用自己的视角接话，不重复台词后附上一句套话。'})
 reviewGrowth(dir,x.id,'approved')
 assert.match(buildGrowthContext(dir,{scene:'comment'}),/用自己的视角/)
 assert.doesNotMatch(buildGrowthContext(dir,{scene:'dm'}),/用自己的视角/)
 assert.doesNotMatch(buildGrowthContext(dir),/原视频台词然后机械评价/)
}))

test('report interest approved without model as an optional preference, never added to configured search terms',()=>withDir(dir=>{
 const reports=['BV1aBcD2eF3G','BV1xYzA2bC3D','BV1lMnO2pQ3R'].map(bv=>`### ${bv}\n标题：AI模型拟人：Claude小姐的故事\n档位：值得看\n`).join('\n')
 const result=ingestReportText(dir,reports)
 assert.ok(result.proposals>=1)
 const interest=listGrowth(dir).entries.find(e=>e.type==='interest'&&e.tags.includes('AI模型拟人'))
 assert.equal(interest.source,'report')
 assert.equal(interest.status,'pending')
 assert.doesNotMatch(buildGrowthContext(dir,{scene:'duty'}),/AI模型拟人/)
 reviewGrowth(dir,interest.id,'approved')
 const context=buildGrowthContext(dir,{scene:'duty'})
 assert.match(context,/AI模型拟人/)
 assert.match(context,/不是搜索关键词/)
 assert.doesNotMatch(buildGrowthContext(dir,{scene:'comment',query:'数学分析'}),/AI模型拟人/)
 const original=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(original,/不能把它们自动追加成搜索关键词/)
 assert.match(original,/kws\.join/)
}))

test('likes rice is a personality preference, not a forced search topic; experiences and relationships require context',()=>withDir(dir=>{
 addApproved(dir,'interest','大肥鱼喜欢吃饭，遇到美食时会更容易被打动，但不用特地搜美食视频。',['白饭与美食'])
 addApproved(dir,'experience','曾在 BV1aBcD2eF3G 视频里看到 Claude小姐大谈 Token 趣事。')
 addApproved(dir,'relationship','Claude小姐是大肥鱼虚构角色背景里的亲密朋友。',['Claude小姐'])
 assert.match(buildGrowthContext(dir,{scene:'duty'}),/喜欢吃饭/)
 assert.doesNotMatch(buildGrowthContext(dir,{scene:'duty'}),/大谈 Token/)
 assert.doesNotMatch(buildGrowthContext(dir,{scene:'duty'}),/亲密朋友/)
 assert.doesNotMatch(buildGrowthContext(dir,{scene:'video',query:'下雨天的数学题'}),/亲密朋友/)
 assert.match(buildGrowthContext(dir,{scene:'video',query:'Claude小姐的故事'}),/亲密朋友/)
 assert.match(buildGrowthContext(dir,{scene:'video',query:'BV1aBcD2eF3G'}),/大谈 Token/)
}))

test('video recall MCP is read-only and never edits the manually configured keywords',()=>withDir(dir=>{
 const home=mkdtempSync(join(tmpdir(),'growth-tool-host-'))
 try{
  const all=new Map()
  const ctx={get:key=>key==='dshHomePath'?(...parts)=>join(home,...parts):undefined,
   logger:{info(){},warn(){}},tools:{register(spec){all.set(spec.name,spec)}},
   webServer:{register(){return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
  apply(ctx,{keywords:['手动设置的搜索词']})
  const recall=all.get('bili_growth_recall')
  assert.ok(recall,'工具已注册')
  assert.equal(recall.parameters.query.type,'string')
  const before=recall.execute({query:''})
  return Promise.resolve(before).then(x=>assert.equal(x.ok,false))
 }finally{rmSync(home,{recursive:true,force:true})}
}))
