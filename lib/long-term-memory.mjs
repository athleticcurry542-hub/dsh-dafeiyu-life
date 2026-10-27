/**
 * DaFeiYu integrated long-term memory.
 *
 * Derived from the design and portions of the MIT-licensed project:
 *   Yuuyuko-uu/dsh-fish-memory
 *   https://github.com/Yuuyuko-uu/dsh-fish-memory
 *   Copyright (c) 2026 Yuuyuko
 *
 * Upstream concepts retained here include per-session stores, time-stamped fading
 * memories, stable facts, fact keys, replacement semantics, scoped remember tools,
 * and per-turn recall injection. This integration intentionally keeps a much smaller
 * surface: DaFeiYu's selected main Session only, deterministic local recall, and no
 * extra model call for Bilibili experience ingestion.
 *
 * Compatibility difference: model-facing tool argument names are ASCII-only
 * (`supersedes`, `fact_key`) so Claude/Anthropic strict tool schemas are supported.
 * Stored data may keep the upstream Chinese field `事实键` for import compatibility.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STORE_VERSION = 2
const MAX_FILE = 8 * 1024 * 1024
const MAX_MEMORIES = 5000
const MAX_DELETED = 1500
const MAX_TRACES = 100
const DAY = 86400000
const TOOL_KEY = /^[a-zA-Z0-9_-]{1,64}$/

export const DEFAULT_MEMORY_POLICY = Object.freeze({
  baseHalfLifeDays: 30,
  emotionHalfLifeDays: 7,
  baselineWeight: 0.55,
  activationWeight: 0.25,
  importanceWeight: 0.15,
  emotionWeight: 0.05,
  threshold: 0.35,
  maxItems: 6,
  maxChars: 800,
  dailyQuota: 8,
  rarityK: 1,
  queryGate: 0.8,
  factsMax: 2,
  unknownActivation: 0.5,
})

const clean = (v, n=1000) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0,n)
const cleanId = v => clean(v,180).replace(/^session-/, '').replace(/[^a-zA-Z0-9_-]/g,'_')
const clamp = (v, lo, hi, d) => { const n=Number(v); return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):d }
const iso = t => new Date(Number(t)||Date.now()).toISOString()
const dayKey = t => iso(t).slice(0,10)
const normalized = s => clean(s,2000).toLowerCase().replace(/[\s，。、！？；：,.!?;:'"“”‘’（）()【】\[\]{}<>《》·~`!@#$%^&*+=|\\/-]+/g,'')

function policyOf(c={}) {
  return {
    ...DEFAULT_MEMORY_POLICY,
    baseHalfLifeDays:clamp(c.mainSessionMemoryHalfLifeDays,15,120,30),
    threshold:clamp(c.mainSessionMemoryThreshold,0.1,0.8,0.35),
    maxItems:Math.round(clamp(c.mainSessionMemoryMaxItems,1,12,6)),
    maxChars:Math.round(clamp(c.mainSessionMemoryMaxChars,200,3000,800)),
    dailyQuota:Math.round(clamp(c.mainSessionMemoryDailyQuota,1,30,8)),
    factsMax:Math.round(clamp(c.mainSessionMemoryFactsMax,0,6,2)),
  }
}

function blank(policy=DEFAULT_MEMORY_POLICY) { return {version:STORE_VERSION,policy:{...policy},memories:[],traces:[],deleted:[]} }
function storePath(storeDir,sid){return join(storeDir,cleanId(sid)+'.json')}
function safeReadJson(file){
  if(!existsSync(file))return null
  const st=lstatSync(file)
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_FILE)throw Error('长期记忆文件不安全或过大')
  return JSON.parse(readFileSync(file,'utf8'))
}
function readStore(storeDir,sid,policy){
  try{
    const raw=safeReadJson(storePath(storeDir,sid));if(!raw)return blank(policy)
    return {version:STORE_VERSION,policy:{...policy,...(raw.policy||{})},memories:Array.isArray(raw.memories)?raw.memories.slice(-MAX_MEMORIES):[],traces:Array.isArray(raw.traces)?raw.traces.slice(-MAX_TRACES):[],deleted:Array.isArray(raw.deleted)?raw.deleted.slice(-MAX_DELETED):[]}
  }catch{return blank(policy)}
}
function writeStore(storeDir,sid,data){
  mkdirSync(storeDir,{recursive:true});const file=storePath(storeDir,sid)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('长期记忆目标是符号链接，拒绝写入')
  const tmp=file+`.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  const out={version:STORE_VERSION,policy:{...data.policy},memories:(data.memories||[]).slice(-MAX_MEMORIES),traces:(data.traces||[]).slice(-MAX_TRACES),deleted:(data.deleted||[]).slice(-MAX_DELETED)}
  writeFileSync(tmp,JSON.stringify(out,null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(tmp,file);return out
}

function tokenSet(text){
  const out=new Set(),s=clean(text,2000).toLowerCase()
  for(const m of s.matchAll(/[a-z0-9][a-z0-9_.+-]{1,31}/g))out.add(m[0])
  for(const m of s.matchAll(/[\u3400-\u9fff]{2,20}/g)){
    const r=m[0];if(r.length<=8)out.add(r)
    for(let n=2;n<=Math.min(4,r.length);n++)for(let i=0;i+n<=r.length;i++)out.add(r.slice(i,i+n))
  }
  // Small deterministic intent bridges improve natural owner questions without another AI call.
  if(/怎么叫|叫你|叫我|称呼|外号|名字/.test(s))out.add('称呼')
  if(/喜欢|爱好|偏好|最爱/.test(s))out.add('喜欢')
  if(/约定|答应|说好|承诺/.test(s))out.add('约定')
  return out
}
function evidence(memories,queryTokens,memTokens,rarityK=1){
  if(!queryTokens.size||!memTokens.size)return 0
  const N=Math.max(1,memories.length);let sum=0
  for(const t of queryTokens){if(!memTokens.has(t))continue;let df=0;for(const m of memories)if(tokenSet(m.text).has(t))df++;sum+=Math.log((N+1)/(df+1))+0.5}
  return 1-Math.exp(-sum/Math.max(.2,rarityK))
}
function activation(m,p,now){
  if(m.category==='stable_profile')return 1
  if(!m.at&&!m.activationAnchor)return clamp(p.unknownActivation,0,1,.5)
  const anchor=Date.parse(m.activationAnchor||m.at||m.createdAt||'')||now
  const I=clamp(m.importance,0,1,.5),half=Math.max(1,p.baseHalfLifeDays*(1+2*I)),a0=clamp(m.activation0,0,1,1)
  return a0*Math.pow(2,-Math.max(0,now-anchor)/DAY/half)
}
function queryInfo(tokens){let n=0;for(const t of tokens)n+=Math.min(1.5,Math.max(.15,t.length/4));return n}
function recall(data,query,now=Date.now()){
  const p={...DEFAULT_MEMORY_POLICY,...(data.policy||{})},q=tokenSet(query)
  if(queryInfo(q)<p.queryGate)return {selected:[],scored:[],gate:'query'}
  const active=(data.memories||[]).filter(m=>m&&!m.已被取代&&clean(m.text))
  const scored=[]
  for(const m of active){
    const C=evidence(active,q,tokenSet([m.text,...(m.tags||[]),m.事实键||''].join(' ')),p.rarityK),A=activation(m,p,now),I=clamp(m.importance,0,1,.5),E=clamp(m.emotion,0,1,0)
    const P=C*(p.baselineWeight+p.activationWeight*A+p.importanceWeight*I+p.emotionWeight*E)
    if(C>=p.threshold)scored.push({m,C,P,A})
  }
  scored.sort((a,b)=>b.P-a.P||b.C-a.C||String(b.m.at||'').localeCompare(String(a.m.at||'')))
  const selected=[];let facts=0,chars=0
  for(const row of scored){
    if(selected.length>=p.maxItems)break
    if(row.m.category==='stable_profile'&&facts>=p.factsMax)continue
    const n=String(row.m.text||'').length;if(selected.length&&chars+n>p.maxChars)continue
    selected.push(row);chars+=n;if(row.m.category==='stable_profile')facts++
  }
  return {selected,scored,gate:null}
}
function relative(at,now=Date.now()){
  const t=Date.parse(at||'');if(!Number.isFinite(t))return ''
  const d=Math.max(0,Math.floor((now-t)/DAY));if(d===0)return '今天';if(d===1)return '昨天';if(d<30)return `${d} 天前`;return String(at).slice(0,10)
}
function renderRecall(rows,now=Date.now()){
  if(!rows.length)return ''
  return ['【大肥鱼的长期记忆】','下面是过去真实留下的记忆。把它们当作背景事实/经历；不确定的细节不要自行补全。',...rows.map(({m})=>`- ${m.at?relative(m.at,now)+'：':m.category==='stable_profile'?'一直：':''}${clean(m.text,900)}`)].join('\n')
}
function factKey(v){return clean(v,100).replace(/[\s\/\\]+/g,'').slice(0,80)}
function similarity(a,b){const A=tokenSet(a),B=tokenSet(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.max(A.size,B.size)}
function markReplaced(m,newId,reason){if(!m||m.已被取代)return false;m.已被取代={by:newId,reason:clean(reason,100),at:new Date().toISOString()};return true}
function normalizeImported(m){
  if(!m||typeof m!=='object')return null;const text=clean(m.text,1500);if(!text)return null
  return {...m,id:clean(m.id,120)||('m'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)),text,importance:clamp(m.importance,0,1,.5),category:m.category==='stable_profile'?'stable_profile':'event',tags:Array.isArray(m.tags)?m.tags.slice(0,10).map(x=>clean(x,50)).filter(Boolean):[],...(factKey(m.事实键)?{事实键:factKey(m.事实键)}:{})}
}
function addMemoryToStore(data,{text,importance=.5,tags=[],supersedes='',fact_key='',source='session',sourceKey='',at=Date.now(),bypassQuota=false}){
  text=clean(text,1500);if(!text)return {ok:false,message:'内容是空的'}
  const now=Date.now(),today=dayKey(now)
  if(!bypassQuota){const count=(data.memories||[]).filter(m=>m.createdAt&&dayKey(Date.parse(m.createdAt))===today&&m.source!=='bilibili-experience').length;if(count>=data.policy.dailyQuota)return {ok:false,message:`今天记满了（${data.policy.dailyQuota} 条）`}}
  if(sourceKey){const old=(data.memories||[]).find(m=>m.sourceKey===sourceKey);if(old)return {ok:true,duplicate:true,id:old.id,message:'这条经历已经在长期记忆里'} }
  const n=normalized(text)
  for(const m of data.memories||[]){if(m.已被取代)continue;const a=normalized(m.text);if(a&&n&&(a===n||(a.length>10&&n.length>10&&(a.includes(n)||n.includes(a))))){m.activation0=Math.min(1,clamp(m.activation0,0,1,1)+0.2*(1-clamp(m.activation0,0,1,1)));m.activationAnchor=iso(now);m.reinforceCount=(Number(m.reinforceCount)||0)+1;return {ok:true,duplicate:true,id:m.id,message:'这件事以前记过，已强化'}}}
  const id='m'+now.toString(36)+Math.random().toString(36).slice(2,7),replaced=[]
  if(supersedes){let best=null,score=0;for(const m of data.memories||[]){if(m.已被取代)continue;const s=(String(m.id)===String(supersedes))?1:similarity(String(supersedes),m.text);if(s>score){score=s;best=m}}if(best&&score>=.5&&markReplaced(best,id,'新记忆明确取代'))replaced.push(best.id)}
  const key=factKey(fact_key)
  const mem={id,text,at:iso(at),createdAt:iso(now),category:importance>=.95?'stable_profile':'event',importance:clamp(importance,0,1,.5),emotion:null,tags:Array.isArray(tags)?tags.slice(0,8).map(x=>clean(x,50)).filter(Boolean):[],source:clean(source,80)||'session',sourceKey:clean(sourceKey,220),activation0:1,activationAnchor:iso(at),reinforceCount:0,...(key?{事实键:key}:{})}
  data.memories.push(mem)
  if(key){for(const m of data.memories){if(m===mem||m.已被取代||factKey(m.事实键)!==key)continue;if(markReplaced(m,id,'同一事实键已有更新'))replaced.push(m.id)}}
  return {ok:true,id,replaced,message:'记下了'}
}
function textOfMessage(msg){
  try{const c=msg?.content;if(typeof c==='string')return clean(c,2000);if(Array.isArray(c))return clean(c.map(x=>x?.type==='text'?x.text:'').filter(Boolean).join('\n'),2000);return clean(msg?.text||msg?.message||'',2000)}catch{return ''}
}
function lastUserTextOf(session){
  try{const ev=session?.snapshotEvents?.()||[];for(let i=ev.length-1;i>=0;i--){const e=ev[i];if(e?.type==='user/message'){const t=textOfMessage(e?.data?.message||e?.data||e);if(t)return t}}}catch{}return ''
}
function sessionIdOf(agent){
  try{const s=agent?.session;for(const v of [agent?.sessionId,agent?.id,s?.id,s?.sessionId,s?.header?.id])if(typeof v==='string'&&v)return cleanId(v)}catch{}return ''
}
function eventMemory(e){
  if(!e||typeof e!=='object')return null
  if(e.kind==='watch')return {text:`我在 B站刷到并挑中了 ${e.bvid}${e.title?`《${clean(e.title,160)}》`:''}${e.note?`，当时我的判断是「${clean(e.note,220)}」`:''}。`,importance:.55,tags:['B站','刷视频',e.bvid].filter(Boolean),sourceKey:`bili:watch:${e.day||''}:${e.bvid}`,at:Date.parse(e.time||e.day||'')||Date.now()}
  if(e.kind==='comment')return {text:`我在 B站 ${e.bvid} ${e.reply?'回复过一条评论':'发过一条顶层评论'}${e.recipientName?`，对象是 ${clean(e.recipientName,60)}`:''}${e.text?`，我当时说：「${clean(e.text,260)}」`:''}。`,importance:.62,tags:['B站','评论',e.bvid].filter(Boolean),sourceKey:`bili:comment:${e.bvid}:${e.rpid||e.time||e.text||''}`,at:Date.parse(e.time||'')||Date.now()}
  return null
}

export function createLongTermMemory({dataDir,dshHome,agents={},getConfig,defineTool,getIdentityPrompt=()=>'',getGrowthPrompt=()=>'',logger=console}){
  if(!dataDir||typeof getConfig!=='function'||typeof defineTool!=='function')throw TypeError('long-term memory dependencies missing')
  const storeDir=join(dataDir,'long-term-memory');let timer=null,mounted=null
  const cfg=()=>{const c=getConfig()||{};return {enabled:c.mainSessionMemoryEnabled===true,id:cleanId(c.mainSessionId),autoBili:c.mainSessionMemoryAutoBili!==false,policy:policyOf(c)}}
  const agentById=id=>{if(!id)return null;try{const a=agents.get?.(id)||agents.get?.('session-'+id);if(a)return a}catch{};try{return (agents.list?.()||[]).find(a=>sessionIdOf(a)===id)||null}catch{return null}}
  const save=(sid,data)=>writeStore(storeDir,sid,data)
  const mountFor=(agent,sid,memoryEnabled)=>{
    let lastText='';const disposers=[]
    try{const off=agent.ctx.on?.('agent/inbox/inserted',payload=>{const t=textOfMessage(payload?.message||payload);if(t)lastText=t});if(typeof off==='function')disposers.push(off)}catch{}
    // The selected main Session is DaFeiYu herself even when long-term memory is disabled.
    // Identity/persona therefore mounts independently from the memory switch.
    try{const off=agent.ctx.systemPrompt?.section?.({name:'dafeiyu-main-identity',order:120,text:()=>{try{return clean(getIdentityPrompt({sessionId:sid}),12000)}catch{return ''}}});if(typeof off==='function')disposers.push(off)}catch(e){logger.warn?.('大肥鱼主 Session 人格挂载失败：'+String(e?.message||e))}
    if(memoryEnabled){
      try{const off=agent.ctx.systemPrompt?.section?.({name:'dafeiyu-memory-hint',order:89990,text:()=> '【大肥鱼长期记忆】这一轮如果主人说了值得长期记住的事（重要的话、约定、偏好、长期状态、你们之间的重要经历），可调用 dafeiyu_remember。日常琐事不用记；人称写成“我”和“主人”；时间由系统保存。'});if(typeof off==='function')disposers.push(off)}catch(e){logger.warn?.('长期记忆提示挂载失败：'+String(e?.message||e))}
      try{const off=agent.ctx.systemPrompt?.context?.({name:'dafeiyu-memory',order:900,text:()=>{try{const query=lastText||lastUserTextOf(agent.session);if(!query)return '';const c=cfg(),data=readStore(storeDir,sid,c.policy),r=recall(data,query,Date.now());data.traces.push({at:Date.now(),query:clean(query,200),picked:r.selected.map(x=>x.m.id),scores:r.scored.slice(0,24).map(x=>({id:x.m.id,C:Number(x.C.toFixed(3)),P:Number(x.P.toFixed(3))}))});save(sid,data);return renderRecall(r.selected)}catch{return ''}}});if(typeof off==='function')disposers.push(off)}catch(e){logger.warn?.('长期记忆召回挂载失败：'+String(e?.message||e))}
      try{
        const spec=defineTool({name:'dafeiyu_remember',description:'把主人和大肥鱼之间值得长期记住的一件事写入大肥鱼长期记忆。一条只记一件事；日常琐事不要记。',parameters:{text:{type:'string',required:true,description:'要记住的一件事。你自己写“我”，用户写“主人”。'},importance:{type:'number',description:'0~1，约定、关系、长期偏好可接近1；普通重要经历约0.5。'},tags:{type:'array',items:{type:'string'},description:'少量检索关键词。'},supersedes:{type:'string',description:'可选：如果本条明确更新了旧记忆，填旧记忆的大意或 id。'},fact_key:{type:'string',description:'可选：会变化的同一事实用稳定键，如 主人.称呼、约定.旅行；不要把具体值写进键。'}},output:{schema:{type:'object',additionalProperties:false,properties:{ok:{type:'boolean'},message:{type:'string'}}},render(_a,v){return [{type:'text',text:v?.ok?'✓':'✗ '+String(v?.message||'没记住')}] }},async execute(args){const c=cfg();if(!c.enabled||c.id!==sid)return {ok:false,message:'这个会话没有开启大肥鱼长期记忆'};const data=readStore(storeDir,sid,c.policy);data.policy=c.policy;const r=addMemoryToStore(data,{text:args?.text,importance:args?.importance,tags:args?.tags,supersedes:args?.supersedes,fact_key:args?.fact_key,source:'main-session'});if(r.ok)save(sid,data);return r}})
        for(const k of Object.keys(spec?.parameters||{}))if(!TOOL_KEY.test(k))throw Error('长期记忆工具 schema 参数名不兼容：'+k)
        const off=agent.ctx.tools?.register?.(spec);if(typeof off==='function')disposers.push(off)
      }catch(e){logger.warn?.('长期记忆工具挂载失败：'+String(e?.message||e))}
    }
    // Reviewed growth belongs to DaFeiYu's identity continuity, not to the long-term-memory switch.
    try{const off=agent.ctx.systemPrompt?.context?.({name:'dafeiyu-growth',order:880,text:()=>{try{const query=lastText||lastUserTextOf(agent.session);return clean(getGrowthPrompt({sessionId:sid,query}),4000)}catch{return ''}}});if(typeof off==='function')disposers.push(off)}catch(e){logger.warn?.('大肥鱼成长记忆挂载失败：'+String(e?.message||e))}
    return ()=>{for(const d of disposers.reverse())try{d()}catch{}}
  }
  const tick=()=>{try{const c=cfg();const a=c.id?agentById(c.id):null;if(!a){if(mounted){mounted.off();mounted=null}return}if(mounted?.agent===a&&mounted.sid===c.id&&mounted.memoryEnabled===c.enabled)return;if(mounted)mounted.off();mounted={agent:a,sid:c.id,memoryEnabled:c.enabled,off:mountFor(a,c.id,c.enabled)}}catch(e){logger.warn?.('长期记忆挂载检查失败：'+String(e?.message||e))}}
  const start=()=>{if(timer)return;tick();timer=setInterval(tick,750);timer.unref?.()}
  const stop=()=>{if(timer)clearInterval(timer);timer=null;if(mounted){mounted.off();mounted=null}}
  const status=()=>{const c=cfg(),data=c.id?readStore(storeDir,c.id,c.policy):blank(c.policy);const ext=c.id?join(dshHome||'', 'fish-memory',cleanId(c.id)+'.json'):'';return {ok:true,enabled:c.enabled,sessionId:c.id,identityMounted:Boolean(mounted&&mounted.sid===c.id),mounted:Boolean(mounted&&mounted.sid===c.id&&mounted.memoryEnabled===true),count:data.memories.filter(m=>!m.已被取代).length,total:data.memories.length,deleted:data.deleted.length,externalFishMemoryAvailable:Boolean(ext&&existsSync(ext)),policy:c.policy}}
  const list=(query='',limit=100)=>{const c=cfg();if(!c.id)return [];const data=readStore(storeDir,c.id,c.policy),q=clean(query,120).toLowerCase();let rows=data.memories.slice().reverse();if(q)rows=rows.filter(m=>[m.text,(m.tags||[]).join(' '),m.事实键,m.source].some(x=>String(x||'').toLowerCase().includes(q)));return rows.slice(0,Math.max(1,Math.min(300,Number(limit)||100)))}
  const remove=id=>{const c=cfg();if(!c.id)throw Error('还没有选择主 Session');const data=readStore(storeDir,c.id,c.policy),i=data.memories.findIndex(m=>String(m.id)===String(id));if(i<0)return false;const [m]=data.memories.splice(i,1);data.deleted.push({...m,deletedAt:new Date().toISOString()});save(c.id,data);return true}
  const addManual=(text,importance=.7,tags=[])=>{const c=cfg();if(!c.id)throw Error('还没有选择主 Session');const data=readStore(storeDir,c.id,c.policy);data.policy=c.policy;const r=addMemoryToStore(data,{text,importance,tags,source:'owner-manual',bypassQuota:true});if(r.ok)save(c.id,data);return r}
  const importBiliEvents=(sid,events=[])=>{const c=cfg();sid=cleanId(sid);if(!c.enabled||!c.autoBili||!sid||sid!==c.id)return {added:0};const data=readStore(storeDir,sid,c.policy);data.policy=c.policy;let added=0;for(const e of events){const m=eventMemory(e);if(!m)continue;const r=addMemoryToStore(data,{...m,source:'bilibili-experience',bypassQuota:true});if(r.ok&&!r.duplicate)added++}if(added)save(sid,data);return {added}}
  const importExternal=()=>{const c=cfg();if(!c.id)throw Error('还没有选择主 Session');const file=join(dshHome||'', 'fish-memory',cleanId(c.id)+'.json');if(!existsSync(file))return {ok:false,error:'没有找到这个 Session 的旧 fish-memory 数据'};const raw=safeReadJson(file);if(!raw||!Array.isArray(raw.memories))throw Error('旧 fish-memory 文件格式不兼容');const data=readStore(storeDir,c.id,c.policy),keys=new Set(data.memories.map(m=>String(m.id)+'|'+normalized(m.text)));let added=0;for(const row of raw.memories){const m=normalizeImported(row);if(!m)continue;let id=m.id,key=id+'|'+normalized(m.text);if(keys.has(key))continue;while(data.memories.some(x=>String(x.id)===id))id=m.id+'-import-'+Math.random().toString(36).slice(2,6);m.id=id;key=id+'|'+normalized(m.text);keys.add(key);data.memories.push({...m,source:m.source||'dsh-fish-memory-import'});added++}data.policy={...c.policy};save(c.id,data);return {ok:true,added,total:data.memories.length,source:file}}
  const clear=()=>{const c=cfg();if(!c.id)return false;const f=storePath(storeDir,c.id);if(existsSync(f)){if(lstatSync(f).isSymbolicLink())throw Error('长期记忆文件是符号链接，拒绝操作');const bak=f+'.clear-'+Date.now()+'.bak';renameSync(f,bak);return true}return false}
  return {start,stop,status,list,remove,addManual,importBiliEvents,importExternal,clear,storeDir}
}

export const __test={tokenSet,recall,renderRecall,addMemoryToStore,eventMemory,policyOf,cleanId,TOOL_KEY}
