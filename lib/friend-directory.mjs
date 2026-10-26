/** Same UID for authorization across DM, outgoing @ and incoming @; display names are never authority. */
import {readUidList} from './uid-labels.mjs'
import {parseMentionTargets} from './mentions.mjs'
const uidOK = x => /^[1-9]\d{0,18}$/.test(String(x||''))
const trimName = x => String(x||'').replace(/[\r\n\0<>|]/g,' ').trim().slice(0,40)
export function normalizeFriendDirectory(value) {
  let rows=value
  if(typeof value==='string'){if(value.length>16000)return '[]';try{rows=JSON.parse(value)}catch{return '[]'}}
  if(!Array.isArray(rows))return '[]'
  const seen=new Set(),out=[]
  for(const row of rows){
    const uid=String(row?.uid||'').trim()
    if(!uidOK(uid)||seen.has(uid))continue
    seen.add(uid)
    out.push({uid,name:trimName(row?.name),dm:row?.dm===true,mention:row?.mention===true,atInvite:row?.atInvite===true})
    if(out.length>=120)break
  }
  return JSON.stringify(out)
}
export function mergeLegacyFriendLists({friendDirectory='',mentionTargets='',dmWhitelist='',commentAtWhitelist=''}={}) {
  let prior=[];try{prior=JSON.parse(normalizeFriendDirectory(friendDirectory))}catch{}
  const map=new Map(prior.map(r=>[r.uid,{...r}]))
  const put=(uid,name,key)=>{
    if(!uidOK(uid))return
    const row=map.get(uid)||{uid,name:'',dm:false,mention:false,atInvite:false}
    if(!row.name&&name&&!String(name).startsWith('UID '))row.name=trimName(name)
    row[key]=true;map.set(uid,row)
  }
  for(const t of parseMentionTargets(mentionTargets))put(t.uid,t.name,'mention')
  for(const [uid,name] of readUidList(dmWhitelist))put(uid,name,'dm')
  for(const [uid,name] of readUidList(commentAtWhitelist))put(uid,name,'atInvite')
  return JSON.parse(normalizeFriendDirectory([...map.values()]))
}
export function directoryToLegacy(value) {
  const arr=JSON.parse(normalizeFriendDirectory(value))
  const line=r=>r.uid+(r.name?'|'+r.name:'')
  return {
    mentionTargets:arr.filter(r=>r.mention).slice(0,8).map(line).join('\n'),
    dmWhitelist:arr.filter(r=>r.dm).map(line).join('\n'),
    commentAtWhitelist:arr.filter(r=>r.atInvite).map(line).join('\n')
  }
}
