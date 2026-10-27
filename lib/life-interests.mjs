/**
 * 大肥鱼人生记忆的兴趣档案。由已经选择的真实 BV 作为证据，
 * 不把单条观看提升为长期偏好，也不自动改写主人配置的人设和搜索关键词。
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOPICS } from './persona-growth.mjs'

const FILE = 'life-memory/interests.json'
const DAY = 86400000
const clean=(x,n=180)=>String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n)
const bvValid = s=>/^BV[0-9A-Za-z]{10}$/.test(String(s||''))
const blank=()=>({schema:1,entries:[],updatedAt:''})
const pathOf=dir=>join(dir,'life-memory','interests.json')
function read(dir){
  const path=pathOf(dir)
  if(!existsSync(path))return blank()
  const st=lstatSync(path)
  if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024*1024)throw Error('兴趣档案文件不安全或过大')
  const data=JSON.parse(readFileSync(path,'utf8'))
  if(data?.schema!==1||!Array.isArray(data.entries))throw Error('兴趣档案格式不兼容')
  return data
}
function save(dir,data){
  const path=pathOf(dir);mkdirSync(join(dir,'life-memory'),{recursive:true})
  if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('兴趣档案不能写入符号链接')
  const tmp=path+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp'
  writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600})
  renameSync(tmp,path)
}
function stageOf(e,now=Date.now()){
  const ev=(e.evidence||[]).filter(x=>{
    const at=Date.parse(x.at||x.day||'')
    return Number.isFinite(at) && now-at>=-DAY && now-at<=90*DAY
  })
  const dates=new Set(ev.map(x=>clean(x.day,10)))
  const count=ev.length
  // 至少三条不同 BV、横跨两天才确认“开始有兴趣”。
  const stage=count>=12&&dates.size>=5?'stable':count>=6&&dates.size>=3?'growing':count>=3&&dates.size>=2?'emerging':'insufficient'
  const ever=String(e.peakStage||'')
  const visible=stage==='insufficient'&&['emerging','growing','stable'].includes(ever)?'quiet':stage
  return {stage:visible,rolling90:count,days90:dates.size}
}
function quality(e){return ['值得看','可以看','selected'].includes(clean(e.tier,50))}
export function recordInterestEvents(dir,events=[],now=Date.now()){
  if(!Array.isArray(events)||!events.length)return {added:0}
  const state=read(dir);let added=0
  const map=new Map((state.entries||[]).map(x=>[x.topic,x]))
  for(const e of events){
    if(e?.kind!=='watch'||!bvValid(e.bvid)||!clean(e.title)||!quality(e))continue
    const text=clean(e.title,240)
    const hits=Object.entries(TOPICS).filter(([,rx])=>rx.test(text)).map(([topic])=>topic)
    for(const topic of hits){
      let row=map.get(topic)
      if(!row){row={topic,firstSeen:new Date(now).toISOString(),lastSeen:'',peakStage:'',evidence:[],history:[]};map.set(topic,row)}
      if(row.evidence.some(x=>x.bvid===e.bvid))continue
      const at=Date.parse(e.time||e.day||'')||now
      // 历史证据最多 90 条，避免兴趣记录无限增长
      row.evidence.push({bvid:String(e.bvid),at:new Date(at).toISOString(),day:new Date(at).toISOString().slice(0,10)})
      row.evidence=row.evidence.slice(-90)
      row.lastSeen=new Date(at).toISOString()
      const next=stageOf(row,now)
      const prev=row.peakStage||'insufficient'
      if(next.stage!==prev&&next.stage!=='insufficient'&&next.stage!=='quiet'){
        row.history.push({at:new Date(now).toISOString(),from:prev,to:next.stage,evidenceCount:row.evidence.length})
        row.history=row.history.slice(-20)
        row.peakStage=next.stage
      }
      added++
    }
  }
  if(added){state.entries=[...map.values()].slice(0,30);state.updatedAt=new Date(now).toISOString();save(dir,state)}
  return {added}
}
const LABEL={stable:'较稳定的后天兴趣',growing:'兴趣持续增强',emerging:'最近开始关注',quiet:'最近关注减少',insufficient:'证据不足'}
export function listLifeInterests(dir,now=Date.now()){
  const data=read(dir)
  return (data.entries||[]).map(e=>({...e,...stageOf(e,now),label:LABEL[stageOf(e,now).stage]}))
    .filter(e=>e.stage!=='insufficient')
    .sort((a,b)=>Date.parse(b.lastSeen||'')-Date.parse(a.lastSeen||''))
}
export function interestMemoryRows(dir,now=Date.now()){
  return listLifeInterests(dir,now).map(e=>({
    id:'interest:'+e.topic,
    text:`大肥鱼对「${e.topic}」${e.label}。过去90天有 ${e.rolling90} 个不同视频证据，分布在 ${e.days90} 天；这不是主人写死的人设，也不是必须继续观看的命令。`,
    memoryKind:'interest',
    category:'interest_profile',
    tags:[e.topic,'兴趣','关注'],
    source:'life-interest',
    importance:e.stage==='stable'?.82:e.stage==='growing'?.74:.6,
    createdAt:e.lastSeen||'',
    evidenceKeys:(e.evidence||[]).slice(-12).map(x=>x.bvid),
  }))
}
export const __test={stageOf,pathOf,quality}
