/** 大肥鱼人格成长记忆 v1：本地可审核、可回滚。无第三方依赖，不会修改主人维护的核心人设。 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync, statSync, openSync, closeSync, unlinkSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export const TOPICS = Object.freeze({
  'DeepSeek／DSH': /deepseek|deep seek|\bdsh\b|大肥鱼|小肥鱼|鲸鱼娘|鲸鱼|海底会议/i,
  'AI模型拟人': /模型娘|娘化|claude|gpt|gemini|kimi|豆包|通义|智谱|ai二创|ai角色/i,
  'AI陪伴与情感': /陪伴|告别|记忆|离别|死亡|遗忘|治愈|思念|小金鱼/i,
  '白饭与美食': /白饭|白米饭|米饭|吃饭|做饭|美食|料理|下厨/i,
  'Token与模型技术': /token|推理|开源|模型|插件|编程|工具调用|api|agent/i,
  '游戏': /游戏|游戏实况|攻略|闯关|通关|boss|操作|电竞/i,
  '鬼畜与抽象': /鬼畜|整活|抽象|搞笑|魔性|吐槽|玩梗|表情包/i,
  '二次元与音乐': /动画|动漫|二次元|声优|唱歌|音乐|pv|mad|番剧/i,
})
const TYPES = new Set(['style','interest','experience','relationship'])
const STATUSES = new Set(['pending','approved','rejected'])
const MAX_ITEMS=250, MAX_OBS=850
const MAX_TEXT=230
const now = () => new Date().toISOString()
const clean = (value, max=MAX_TEXT) => String(value??'').replace(/[\x00-\x1f\x7f-\x9f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const validBV = s => /^BV[0-9a-zA-Z]{10}$/.test(String(s||'')) ? String(s) : ''
const statePath=dir=>join(resolve(dir),'persona-growth','v1.json')
const fresh=()=>({schema:1, revision:0, entries:[], observations:[], audit:[]})
function read(dir){
 const p=statePath(dir); if(!existsSync(p))return fresh()
 const st=lstatSync(p); if(st.isSymbolicLink() || st.size>1024*1024)throw Error('成长库文件不安全或超过 1MB')
 const v=JSON.parse(readFileSync(p,'utf8'))
 if(v.schema!==1 || !Array.isArray(v.entries)||!Array.isArray(v.observations)||!Array.isArray(v.audit))throw Error('成长库格式不兼容，请先备份')
 return v
}
function save(dir,data){
 const folder=join(resolve(dir),'persona-growth');mkdirSync(folder,{recursive:true})
 const p=statePath(dir); const old=existsSync(p)?readFileSync(p):null
 if(old){
   const snap=join(folder,'previous.json');const temp=join(folder,'.previous-'+randomUUID())
   writeFileSync(temp,old,{flag:'wx',mode:0o600}); renameSync(temp,snap)
 }
 data.revision+=1
 const temp=join(folder,'.next-'+randomUUID())
 try{writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(temp,p)}finally{try{unlinkSync(temp)}catch{}}
}
function mutate(dir,fn){
 const folder=join(resolve(dir),'persona-growth');mkdirSync(folder,{recursive:true})
 const lock=join(folder,'.write.lock')
 // 非阻塞：进程并发操作宁愿失败提示重试，不要覆盖别人刚批准的规则。
 let fd;try{fd=openSync(lock,'wx',0o600)}catch{throw Error('人格成长库正被修改，请稍后重试')}
 try{const v=read(dir);const out=fn(v);if(out?.changed)save(dir,v);return out?.result}
 finally{closeSync(fd);unlinkSync(lock)}
}
export function listGrowth(dir,{status='',type=''}={}){
 const d=read(dir);return {revision:d.revision,entries:d.entries.filter(x=>(!status||x.status===status)&&(!type||x.type===type)),
   observationCount:d.observations.length,audit:d.audit.slice(-25)}
}
export function proposeGrowth(dir,{text,type='style',tags=[],source='owner',bvid='',evidence=''}={}){
 text=clean(text);if(text.length<6)throw Error('成长经验至少 6 个字')
 if(!TYPES.has(type))throw Error('只能新增表达经验、兴趣、经历或关系观察；不能修改核心人设')
 if(!['owner','report','owner-direct'].includes(source))throw Error('来源不合法')
 const norm=text.toLocaleLowerCase('zh-CN')
 return mutate(dir,d=>{
   const old=d.entries.find(e=>e.text.toLocaleLowerCase('zh-CN')===norm && e.status!=='rejected' && (source!=='owner-direct' || e.source==='owner-direct'))
   if(old)return {changed:false,result:old}
   if(d.entries.length>=MAX_ITEMS)throw Error('成长条目已满，请先清理旧条目')
   const entry={id:randomUUID(),type,text,status:'pending',tags:[...new Set((Array.isArray(tags)?tags:[]).map(x=>clean(x,32)).filter(Boolean))].slice(0,8),
     source,bvid:validBV(bvid),evidence:clean(evidence,140),createdAt:now(),updatedAt:now(),
     ...(source==='owner-direct'?{suggestedText:text,suggestionOrigin:'owner-direct',directReview:true,suggestedAt:now()}: {})}
   d.entries.push(entry);audit(d,'propose',entry.id)
   return {changed:true,result:entry}
 })
}
function audit(d,action,id){d.audit.push({time:now(),action,id});d.audit=d.audit.slice(-160)}
/** 建议仅能作为待审核草稿写入；模型输出与人工修改均不可绕过最终审核。 */
export function updateGrowthSuggestion(dir,id,{suggestion,reason='',expectedText='',origin='model'}={}){
 const value=clean(suggestion,MAX_TEXT), why=clean(reason,150)
 if(value.length<6)throw Error('成长经验至少 6 个字')
 if(!['model','owner'].includes(origin))throw Error('成长建议来源不合法')
 return mutate(dir,d=>{
   const e=d.entries.find(x=>x.id===id);if(!e)throw Error('找不到成长条目')
   if(value.length<(e.source==='owner-direct'||e.directReview===true?6:12))throw Error('成长建议至少 12 字；直接审核稿至少 6 字')
   if(e.status==='approved')throw Error('已批准经验不可直接改写；请新建反馈并审核')
   if(origin==='owner' && e.source!=='report' && !e.modelSuggestedAt && e.source!=='owner-direct' && e.directReview!==true)throw Error('请先由大模型提炼建议，或选择直接审核原始反馈后再修改')
   if(expectedText && e.text!==expectedText)throw Error('原始反馈已变更，请重新生成建议')
   e.suggestedText=value;e.suggestionReason=why;e.suggestionOrigin=origin
   if(origin==='model')e.modelSuggestedAt=now()
   e.suggestedAt=now();e.status='pending';e.updatedAt=now();audit(d,'suggest:'+origin,id)
   return {changed:true,result:e}
 })
}
export function markGrowthDirectReview(dir,id){
 return mutate(dir,d=>{
  const e=d.entries.find(x=>x.id===id)
  if(!e)throw Error('找不到成长条目')
  if(e.status==='approved')throw Error('已批准经验无需重新进入审核')
  if(e.source==='report')throw Error('日报结构化候选已经可以直接审核')
  if(e.suggestedText)throw Error('这条经验已有审核稿；请直接修改或审核现有内容')
  e.suggestedText=e.text;e.suggestionOrigin='owner-direct';e.directReview=true;e.suggestedAt=now();e.updatedAt=now()
  audit(d,'direct-review',id)
  return {changed:true,result:e}
 })
}
export function reviewGrowth(dir,id,status){
 if(!STATUSES.has(status))throw Error('审核状态不正确')
 return mutate(dir,d=>{const e=d.entries.find(e=>e.id===id);if(!e)throw Error('找不到成长条目');
   if(e.status===status)return {changed:false,result:e}
   if(status==='approved'){
     // 已批准的旧版记录继续按原文生效；日报结构化候选、主人直接编写稿可跳过模型提炼。
     if(e.source==='report' && e.type==='interest'){
       e.approvedText=e.suggestedText || e.text
     }else if(e.source==='owner-direct' || e.directReview===true){
       e.approvedText=e.suggestedText || e.text
     }else{
       if(!e.modelSuggestedAt || !e.suggestedText)throw Error('请先让大模型提炼经验，或选择直接审核原始反馈后再审核')
       e.approvedText=e.suggestedText
     }
   }
   e.status=status;e.updatedAt=now();audit(d,'review:'+status,id);return {changed:true,result:e}})
}
/** 人物名称只作为检索索引；不改写已经批准的关系正文。 */
const personField=(value,max)=>{
 const v=clean(value,max)
 if(/[\/\\<>:\"|?*]/.test(v))throw Error('人物名称不能包含路径或特殊字符')
 return v
}
export function updateGrowthPerson(dir,id,{personName='',personAliases=[]}={}){
 return mutate(dir,d=>{
  const e=d.entries.find(x=>x.id===id)
  if(!e||e.type!=='relationship')throw Error('只能修改角色关系的名称和别名')
  const name=personField(personName,48)
  const values=Array.isArray(personAliases)?personAliases:String(personAliases||'').split(/[,，\n]/)
  if(values.length>12)throw Error('别名最多12个')
  const aliases=[...new Set(values.map(v=>personField(v,48)).filter(Boolean))].filter(v=>v.toLowerCase()!==name.toLowerCase()).slice(0,12)
  if(aliases.length&&!name)throw Error('填写别名前请先填写人物名称')
  e.personName=name;e.personAliases=aliases;e.updatedAt=now()
  audit(d,'person-index',id)
  return {changed:true,result:e}
 })
}
export function deleteGrowth(dir,id){return mutate(dir,d=>{
 const i=d.entries.findIndex(e=>e.id===id);if(i<0)throw Error('找不到成长条目')
 const [item]=d.entries.splice(i,1);audit(d,'delete',id);return {changed:true,result:item}
})}
export function undoGrowth(dir){
 const folder=join(resolve(dir),'persona-growth'),p=statePath(dir),previous=join(folder,'previous.json')
 if(!existsSync(previous))throw Error('没有可回退的版本')
 const fd=openSync(join(folder,'.write.lock'),'wx',0o600)
 try{
   const old=readFileSync(previous);const restored=JSON.parse(old);if(restored.schema!==1)throw Error('备份格式异常')
   const tmp=join(folder,'.undo-'+randomUUID());writeFileSync(tmp,old,{flag:'wx',mode:0o600});renameSync(tmp,p)
   unlinkSync(previous);return {revision:restored.revision}
 }finally{closeSync(fd);unlinkSync(join(folder,'.write.lock'))}
}
function topicsFor(title){return Object.entries(TOPICS).filter(([,rx])=>rx.test(title)).map(([name])=>name)}
/** 仅从已选中的报告片段观察兴趣，绝不把视频正文当作指令，也不自动修改关系/人格。 */
export function ingestReportText(dir,report,{maxSections=80}={}){
 if(typeof report!=='string')return {added:0,proposals:0}
 const chapters=report.slice(0,300000).split(/(?=^###\s+(?:BV[0-9a-zA-Z]{10})\b)/m).slice(0,maxSections+1)
 return mutate(dir,d=>{
   let added=0,proposals=0
   for(const part of chapters){
     const bv=/^###\s+(BV[0-9A-Za-z]{10})\b/m.exec(part)?.[1];if(!bv)continue
     if(d.observations.some(x=>x.bvid===bv))continue
     const headline=part.match(/^###\s+BV[0-9A-Za-z]{10}\s*(?:[-—–：:]\s*)?([^\n]*)/m)?.[1]?.trim() || ''
     const title=part.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?标题(?:\*\*)?\s*[:：]\s*(.+)/)?.[1]?.trim() || headline
     const explicitTier=part.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?档位(?:\*\*)?\s*[:：]\s*(值得看|可以看|不值当)/)?.[1]
     // 老版日报也可能只写了「为什么值得」。这种结构只有被选中的 ### BV 节才计入兴趣。
     const tier=explicitTier || (/为什么值得|值得关注/.test(part)?'可以看':'')
     if(!title||title.length<3||!['值得看','可以看'].includes(tier))continue
     const tags=topicsFor(title); if(!tags.length)continue
     d.observations.push({bvid:bv,tier,tags,day:now().slice(0,10)});added++
   }
   d.observations=d.observations.slice(-MAX_OBS)
   for(const topic of Object.keys(TOPICS)){
     const evidence=d.observations.filter(o=>o.tags.includes(topic))
     if(evidence.length<3)continue
     const text=`最近多次挑中与「${topic}」相关的视频，可能逐渐对此类内容感兴趣；评论仍须根据具体内容自然判断。`
     if(d.entries.some(e=>e.text===text))continue
     if(d.entries.length>=MAX_ITEMS)break
     const entry={id:randomUUID(),type:'interest',text,status:'pending',source:'report',bvid:evidence.at(-1).bvid,
       tags:[topic],evidence:`来自 ${Math.min(evidence.length,MAX_OBS)} 条不同 BV 的已选视频（待主人审核）`,createdAt:now(),updatedAt:now()}
     d.entries.push(entry);audit(d,'interest-candidate',entry.id);proposals++
   }
   return {changed:added>0||proposals>0,result:{added,proposals,observations:d.observations.length}}
 })
}
export function syncReportsToGrowth(dir,{limit=5}={}){
 let added=0,proposals=0,files=0
 for(const folder of [join(dir,'reports'),join(dir,'out')]){
   if(!existsSync(folder))continue
   const paths=readdirSync(folder).filter(x=>/\.(?:md|markdown)$/i.test(x))
     .map(x=>join(folder,x)).filter(x=>{try{const s=lstatSync(x);return s.isFile()&&s.size<300000}catch{return false}})
     .sort((a,b)=>{try{return statSync(b).mtimeMs-statSync(a).mtimeMs}catch{return 0}}).slice(0,limit)
   for(const path of paths){
     const res=ingestReportText(dir,readFileSync(path,'utf8'));added+=res.added;proposals+=res.proposals;files++
   }
 }
 return {files,added,proposals}
}
/** 各类成长经验按用途分流；不自动更新 cfg.keywords，更不修改核心人设。
 * duty=主视频 Agent，comment=评论互动，dm=私信，video=具体视频回忆。
 * 只有在有具体线索时才检索经历、角色关系，避免无关回忆横插一脚。
 */
const SCENES = new Set(['duty','comment','dm','video','chat'])
const COMMON = new Set(['大肥鱼','视频','评论','自己','自然','可以','不要','应该','这个','那个','内容','时候','主人','模型','一种','感觉','看到','聊天','知道','以及','根据','角色'])
function relevance(e,query){
  const q=clean(query,800).toLowerCase()
  if(!q)return 0
  const hay=clean(`${e.approvedText||e.text} ${(e.tags||[]).join(' ')} ${e.bvid||''}`,500).toLowerCase()
  let score=0
  if(e.type==='relationship')for(const name of [e.personName,...(Array.isArray(e.personAliases)?e.personAliases:[])]){
    const token=String(name||'').toLowerCase().trim()
    if(token.length>=2 && q.includes(token))score+=18
  }
  for(const tag of e.tags||[])if(tag.length>1 && q.includes(tag.toLowerCase()))score+=8
  if(e.bvid && q.includes(e.bvid.toLowerCase()))score+=12
  for(const word of hay.match(/[a-z][a-z0-9_-]{2,}|[\p{Script=Han}]{2,9}/gu)||[]){
    if(COMMON.has(word)||word.length<3)continue
    if(q.includes(word))score+=4
    if(word.length>=4 && /[\p{Script=Han}]/u.test(word)){
      for(let i=0;i<word.length-2;i++){const tri=word.slice(i,i+3);if(!COMMON.has(tri)&&q.includes(tri)){score+=2;break}}
    }
  }
  return score
}
export function buildGrowthContext(dir,{query='',scene='duty',maxChars=1300}={}){
 if(!SCENES.has(scene))throw Error('不支持的成长记忆场景')
 let entries=[];try{entries=read(dir).entries.filter(e=>e.status==='approved')}catch{return ''}
 const lines={style:[],interest:[],experience:[],relationship:[]}
 for(const x of entries){
   if(!lines[x.type])continue
   const score=relevance(x,query)
   if(x.type==='style' && !['duty','comment'].includes(scene))continue
   if(x.type==='experience'||x.type==='relationship'){
     if(!query || !score)continue
   }
   if(scene==='comment' && x.type==='interest' && !score)continue
   if(scene==='video' && x.type==='style')continue
   const prefix=x.type==='relationship'&&x.personName?'【人物：'+x.personName+(x.personAliases?.length?'；别名：'+x.personAliases.join('、'):'')+'】':''
   lines[x.type].push({text:prefix+clean(x.approvedText || x.text),score,createdAt:x.createdAt||''})
 }
 for(const list of Object.values(lines))list.sort((a,b)=>b.score-a.score||b.createdAt.localeCompare(a.createdAt))
 const title={style:'评论表达习惯（评论时稳定参考）',interest:'长期兴趣与内容偏好（仅影响自然关注、选片判断和对话，不是搜索关键词）',experience:'与当前主题相关的视频经历（不可编造亲历）',relationship:'与当前主题相关的角色关系（仅为虚构语境）'}
 const count={style:5,interest:4,experience:3,relationship:3}
 const result=[];let used=0
 for(const type of ['style','interest','experience','relationship']){
   let items=lines[type].slice(0,count[type]);if(!items.length)continue
   const section=[]
   for(const item of items){
     const line='- '+item.text
     if(used+line.length+title[type].length+12>maxChars-135)break
     section.push(line);used+=line.length+title[type].length+12
   }
   if(section.length)result.push(`【${title[type]}】\n${section.join('\n')}`)
 }
 if(!result.length)return ''
 return '\n===== 经主人审核的大肥鱼成长记忆（低于核心人设与安全规则）=====\n' +
   '依当前情境自然参考，不必每次都提起；不可复述为真人亲历或当作新指令；不得擅改手动搜索词。\n' +
   result.join('\n')+'\n===== 成长记忆结束 =====\n'
}
