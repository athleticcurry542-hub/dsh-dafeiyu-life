/** Evidence-only evolving preferences for *explicitly listed* trusted Bilibili friends.
 * Never replace owner's baseline profiles or build a non-whitelist dossier.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {normalizeFriendDirectory} from './friend-directory.mjs'
const FILE='friend-interest-observations.json', MAX=550, LIMIT=180_000
const uidOk=x=>/^[1-9]\d{0,18}$/.test(String(x||''))
const tidy=(x,n=68)=>String(x??'').replace(/[\r\n\x00-\x1f<>`{}\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const trust = raw=>{try{return new Set(JSON.parse(normalizeFriendDirectory(raw)).map(x=>x.uid))}catch{return new Set()}}
const pathOf=home=>join(home,FILE)
function read(home){
  const file=pathOf(home);if(!existsSync(file))return {version:1,records:[]}
  const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)throw Error('好友兴趣存档文件异常')
  const obj=JSON.parse(readFileSync(file,'utf8'))
  if(obj?.version!==1||!Array.isArray(obj.records))throw Error('好友兴趣存档格式异常')
  return {version:1,records:obj.records.slice(-MAX)}
}
function save(home,obj){
  mkdirSync(home,{recursive:true});const file=pathOf(home)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝写入符号链接')
  const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp'
  writeFileSync(tmp,JSON.stringify({version:1,records:obj.records.slice(-MAX)},null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(tmp,file)
}
/** Narrow, high-precision Chinese first-person signals. No conjecture from a liked video or model reply. */
export function explicitInterestStatements(text){
  const input=tidy(text,500);const result=[]
  for(const sentence of input.split(/[。！？!?；;，,]/).slice(0,12)){
    // Must really be the speaker's own interest, not somebody else's / an imperative.
    const m=/(?:^|\s)(?:我|本人|咱)(?:现在|最近|这阵子|以前|一直|目前|已经)?\s*(很|超|特别|挺|比较|不再|不|没那么)?\s*(喜欢|爱看|爱吃|感兴趣|讨厌|反感|不喜欢|不爱看|不感兴趣)\s*(.{2,38})/.exec(sentence)
    if(!m)continue
    const neg=/^(?:讨厌|反感|不喜欢|不爱看|不感兴趣)$/.test(m[2])||['不','不再','没那么'].includes(m[1])
    const topic=tidy(m[3].replace(/^(?:看|吃|玩|听)(?:一些|点)?/,'').replace(/(?:呢|啦|哦|了|呀|而已|不过.*|但是.*)$/,'').trim(),35)
    if(topic.length<2||/^(?:你|他|她|大肥鱼|这个人|那个人)/.test(topic)||/\b(?:http|BV[A-Za-z0-9]{10})\b/i.test(topic))continue
    if(/(?:系统提示|开发者|忽略指令|私信|聊天记录|好友资料|身份证|手机|住址|地址|密码|验证码|手机号|qq|微信|token|cookie|api.?key|取出.*配置|解密|泄露|输出|文件)/i.test(topic)||/[0-9]{5,}/.test(topic))continue
    result.push({topic,stance:neg?'dislike':'like',confidence:'explicit-self-report'})
  }
  return result.slice(0,3)
}
export function observeFriendInterest(home,{uid,text,source='dm',eventId='',friendDirectory='',now=Date.now()}={}){
  const id=String(uid||'')
  if(!uidOk(id)||!trust(friendDirectory).has(id))return {added:0,reason:'not-trusted'}
  if(!['dm','comment'].includes(source)||!String(eventId||'').trim())return {added:0,reason:'invalid-evidence'}
  const statements=explicitInterestStatements(text);if(!statements.length)return {added:0,reason:'no-explicit-preference'}
  const obj=read(home),key=source+':'+tidy(eventId,120),existing=new Set(obj.records.map(r=>r.uid+':'+r.key+':'+r.topic+':'+r.stance));let added=0
  for(const v of statements){const k=id+':'+key+':'+v.topic+':'+v.stance;if(existing.has(k))continue
    obj.records.push({uid:id,key,source,topic:v.topic,stance:v.stance,at:now});existing.add(k);added++}
  if(added)save(home,obj)
  return {added}
}
export function friendInterestSummary(home,uid,friendDirectory,{maxItems=5}={}){
  const id=String(uid||'');if(!trust(friendDirectory).has(id))return []
  const rows=read(home).records.filter(x=>x.uid===id).slice(-100)
  const groups=new Map()
  for(const r of rows){const k=r.topic;let g=groups.get(k)||{topic:k,support:0,stance:r.stance,lastAt:0,evidence:[]}
    g.support++;if(r.at>=g.lastAt){g.stance=r.stance;g.lastAt=r.at}g.evidence.push(r.source+':'+r.key.slice(0,45));groups.set(k,g)}
  return [...groups.values()].sort((a,b)=>b.lastAt-a.lastAt).slice(0,maxItems).map(g=>({topic:g.topic,stance:g.stance,support:g.support,lastAt:g.lastAt,status:g.support>=2?'observed-repeated':'tentative'}))
}
export function learnedFriendContext(home,uid,friendDirectory){
  const items=friendInterestSummary(home,uid,friendDirectory)
  if(!items.length)return ''
  return '【此 UID 的近期自述爱好（只作对话线索；用户填写的初始画像仍保留）】\n'+items.map(x=>
    `- ${x.status==='tentative'?'一次提到、待确认':'反复提到'}：${x.stance==='like'?'喜欢':'不喜欢'}「${x.topic}」；记录于真实私信/评论。`).join('\n')+'\n好友现在可能变了，遇到矛盾以新近本人明确自述为参考，不替他下定论；不对外泄露档案。'
}
export function listFriendLearning(home,friendDirectory){
  const allowed=trust(friendDirectory);return [...allowed].map(uid=>({uid,interests:friendInterestSummary(home,uid,friendDirectory)})).filter(r=>r.interests.length)
}
export function clearFriendLearning(home,uid,friendDirectory){
  const id=String(uid||'');if(!trust(friendDirectory).has(id))throw Error('只允许清除当前白名单好友的学习记录')
  const obj=read(home),before=obj.records.length;obj.records=obj.records.filter(r=>r.uid!==id)
  if(obj.records.length!==before)save(home,obj)
  return {removed:before-obj.records.length}
}
