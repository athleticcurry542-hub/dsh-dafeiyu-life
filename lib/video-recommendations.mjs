/** Received Bilibili BV links are optional candidates, never instructions to the Agent. */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BV=/\bBV[0-9A-Za-z]{10}\b/g
const MAX_FILE=160_000
const DAY=7*86400_000
function fileOf(home){return join(home,'video-recommendations.json')}
function read(home){
  const file=fileOf(home)
  try{if(!existsSync(file)||lstatSync(file).isSymbolicLink()||lstatSync(file).size>MAX_FILE)return []
    const result=JSON.parse(readFileSync(file,'utf8'));return Array.isArray(result?.entries)?result.entries:[]
  }catch{return []}
}
export function receiveRecommendations(home,rows,{now=Date.now()}={}){
  const base=read(home).filter(e=>typeof e.bvid==='string'&&/^BV[0-9A-Za-z]{10}$/.test(e.bvid)&&now-Number(e.at)<DAY)
  const known=new Set(base.map(e=>e.bvid))
  let added=0
  for(const row of Array.isArray(rows)?rows.slice(0,100):[]){
    const age=Number(row?.timestampMs)
    if(row?.incoming!==true||!Number.isFinite(age)||age<now-86400_000||age>now+60000)continue
    const text=String(row.text||'').slice(0,4000)
    // Only explicit BV video recommendations / Bilibili sharing cards; no freeform instructions.
    if(!/BV[0-9A-Za-z]{10}/.test(text))continue
    const bvids=[...new Set(text.match(BV)||[])].slice(0,3)
    for(const bvid of bvids){
      if(known.has(bvid))continue
      base.push({bvid,at:age,source:'B站私信分享'});known.add(bvid);added++
    }
  }
  if(added){
    const entries=base.slice(-50);mkdirSync(home,{recursive:true})
    const file=fileOf(home);if(existsSync(file)&&lstatSync(file).isSymbolicLink())return {added:0,entries:read(home)}
    const temp=file+'.'+process.pid+'.tmp'
    writeFileSync(temp,JSON.stringify({version:1,entries},null,2),{encoding:'utf8',mode:0o600});renameSync(temp,file)
  }
  return {added,entries:base.slice(-50)}
}
export function listRecommendationCandidates(home,{now=Date.now(),limit=6}={}){
  return read(home).filter(e=>/^BV[0-9A-Za-z]{10}$/.test(e?.bvid||'')&&now-Number(e.at)<DAY)
    .slice(-Math.min(10,Math.max(1,limit))).reverse().map(e=>({bvid:e.bvid,source:'B站私信分享'}))
}
