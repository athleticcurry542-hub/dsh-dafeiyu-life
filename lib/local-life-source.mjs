/** Watch/comment facts feed long-term reflection whether or not a DSH main Session exists. */
import {watchedEvent,commentEvent} from './main-session-bridge.mjs'
export function collectLocalLifeEvents({watched=[],comments=[],days=14,now=Date.now()}={}){
  const cutoff=new Date(now-days*86400_000).toISOString().slice(0,10),out=[]
  for(const row of watched.slice(-400)){const e=watchedEvent(row);if(e&&e.day>=cutoff)out.push(e)}
  for(const row of comments.slice(-200)){const e=commentEvent(row);if(e&&e.day>=cutoff)out.push(e)}
  return out.sort((a,b)=>String(a.time||a.day).localeCompare(String(b.time||b.day))).slice(-550)
}
