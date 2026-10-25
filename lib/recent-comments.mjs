/**
 * 单一评论账本：新成功评论由 Python MCP 直接追加到 seen.md。
 * 旧版按天 @ 诊断仅用于一次性迁移，不再作为最近评论页面的实时第二数据源。
 * seen/YYYY-MM.md 是主账本的月度归档，不是另一套业务数据库。
 */
import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BV = /BV[0-9A-Za-z]{10}/
const EXACT_BV = /^BV[0-9A-Za-z]{10}$/
const ID = /^\d{6,30}$/
const DATE = /20\d{2}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?)?/
const MAX_FILE_BYTES = 6 * 1024 * 1024

function safeRead(file) {
  try { return statSync(file).size > MAX_FILE_BYTES ? '' : readFileSync(file, 'utf8') }
  catch { return '' }
}
function names(dir, pattern, max) {
  try { return readdirSync(dir).filter(n=>pattern.test(n)).sort().reverse().slice(0,max) }
  catch { return [] }
}
function isoTime(t) {
  const found = DATE.exec(String(t || ''))
  return found ? found[0].replace(' ', 'T') : ''
}
function safeSnippet(x) {return String(x||'').replace(/[\r\n\x00-\x1f|]/g,' ').trim().slice(0,120)}
function idFrom(x) {
  const t=String(x||'').trim().replace(/^`|`$/g,'')
  if (ID.test(t)) return t
  return /(?:\brpid\b|评论\s*(?:ID|id))\s*[：:=#\s]*\s*(\d{6,30})/i.exec(t)?.[1]||''
}
function keyOf(row) {
  return row.rpid ? row.bvid+':'+row.rpid : row.bvid+':'+row.time+':'+row.kind+':no-id'
}
function recordFromSeen(line, inCommentSection) {
  const match=BV.exec(line)
  if (!match) return null
  const bvid=match[0]
  let rpid='',root='',time='',snippet='',kind='top'
  if (line.trim().startsWith('|')) {
    const cells=line.split('|').map(x=>x.trim()).slice(1,-1)
    const bi=cells.findIndex(x=>EXACT_BV.test(x))
    // 仅识别 BV 作为首列的评论行，不能把视频表的数字 UP 或标题误判成 rpid。
    if (bi===0 && cells.length>=4) {
      rpid=idFrom(cells[1])
      const missingId = cells[1]==='?' && /成功回执/.test(cells.slice(4).join(' '))
      if (!rpid && !missingId) return null
      root=idFrom(cells[2])
      kind=(root || cells[2]==='?')?'reply':'top'
      time=isoTime(cells[3])
      snippet=safeSnippet(cells.slice(4).join(' | '))
      return {bvid,rpid,root,time,snippet,kind,source:'判重表',hasReceipt:true}
    }
  }
  // 兼容旧版 Agent 自由文本中记录的评论 ID。
  if (inCommentSection || /(?:rpid|评论\s*(?:ID|id))\s*[=:：#\s]*\d{6,30}/i.test(line)) {
    const tail=line.slice(match.index+bvid.length)
    rpid=idFrom(tail)||/^[\s|·，,:：-]*(\d{6,30})(?:\b|\s|\|)/.exec(tail)?.[1]||''
    root=/\broot\s*[:=：]\s*(\d{6,30})/i.exec(tail)?.[1]||''
    if (rpid) return {bvid,rpid,root,time:isoTime(line),snippet:safeSnippet(/(?:正文|摘要|内容)\s*[:：]\s*(.+)/.exec(line)?.[1]||''),kind:root?'reply':'top',source:'判重表',hasReceipt:true}
  }
  return null
}
function seenEntries(text) {
  const rows=[];let inCommentSection=false
  for(const line of String(text).split(/\r?\n/)) {
    const t=line.trim()
    if(/^#{1,6}\s*评论记录/.test(t)) {inCommentSection=true;continue}
    if(/^#{1,6}\s/.test(t)) {inCommentSection=false;continue}
    const row=recordFromSeen(line,inCommentSection)
    if(row)rows.push(row)
  }
  return rows
}
function seenFiles(stateDir) {
  return [join(stateDir,'seen.md'),...names(join(stateDir,'seen'),/^20\d{2}-\d{2}\.md$/,120).map(x=>join(stateDir,'seen',x))]
}
function ledgerRows(stateDir) {
  const byKey=new Map()
  for(const f of seenFiles(stateDir)) for(const row of seenEntries(safeRead(f))) {
    const key=keyOf(row),old=byKey.get(key)
    if(!old){byKey.set(key,row);continue}
    if(!old.snippet&&row.snippet)old.snippet=row.snippet
    if(!old.time&&row.time)old.time=row.time
    if(!old.root&&row.root)old.root=row.root
    if(row.kind==='reply')old.kind='reply'
  }
  return byKey
}
function diagnosticsEntries(text, filenameDay) {
  const rows=[]
  for(const line of String(text).split(/\r?\n/)) {
    if(!line||line.length>12000)continue
    let x;try{x=JSON.parse(line)}catch{continue}
    if(!x||x.success!==true||!EXACT_BV.test(String(x.bvid||'')))continue
    const kind=x.kind==='reply'?'reply':x.kind==='top'?'top':''
    if(!kind)continue
    const rpid=ID.test(String(x.rpid||''))?String(x.rpid):''
    rows.push({bvid:x.bvid,rpid,kind,time:isoTime(x.time)||isoTime(x.day)||filenameDay})
  }
  return rows
}
/**
 * 升级时执行一次：把旧版只有诊断回执的成功评论补入唯一账本。
 * 无正文/无楼中楼 root 的旧事件如实标识，不冒充 B站公开可见。
 * 标记写在追加完成之后；即使进程中途退出，下一次也会按键去重。
 */
export function migrateCommentReceipts(stateDir) {
  const marker=join(stateDir,'comment-ledger-import-v1.json')
  if(existsSync(marker))return {skipped:true,added:0}
  const seen=ledgerRows(stateDir)
  const diagDir=join(stateDir,'mention-diagnostics')
  let added=0,skipped=0;const extra=[]
  for(const filename of names(diagDir,/^20\d{2}-\d{2}-\d{2}\.jsonl$/,365)) {
    const day=filename.slice(0,10)
    for(const row of diagnosticsEntries(safeRead(join(diagDir,filename)),day)) {
      const key=keyOf(row)
      if(seen.has(key)){skipped++;continue}
      seen.set(key,row)
      const timestamp=row.time.replace('T',' ')||day
      const root=row.kind==='reply'?'?':'0'
      const note=row.rpid?'（历史成功回执，未存正文）':'[成功回执·无评论ID] （历史记录）'
      extra.push('| '+[row.bvid,row.rpid||'?',root,timestamp,note].join(' | ')+' |')
      added++
    }
  }
  if(extra.length) {
    appendFileSync(join(stateDir,'seen.md'),'\n## 评论记录（历史成功回执补全；未经公开复核）\n\n'+extra.join('\n')+'\n','utf8')
  }
  writeFileSync(marker,JSON.stringify({version:1,completedAt:new Date().toISOString(),added,skipped},null,2)+'\n','utf8')
  return {skipped:false,added}
}
/** 管理中心只认主判重表及其归档；完全不扫描诊断文件。 */
export function recentComments(stateDir,{limit=50,offset=0,day=''}={}) {
  limit=Math.max(1,Math.min(200,Math.trunc(Number(limit))||50))
  offset=Math.max(0,Math.min(100000,Math.trunc(Number(offset))||0))
  day=/^20\d{2}-\d{2}-\d{2}$/.test(String(day||''))?String(day):''
  const all=[...ledgerRows(stateDir).values()]
  all.sort((a,b)=>(b.time||'').localeCompare(a.time||'')||b.bvid.localeCompare(a.bvid))
  const days=[...new Set(all.map(x=>x.time.slice(0,10)).filter(x=>/^20\d{2}-\d{2}-\d{2}$/.test(x)))].sort().reverse()
  const filtered=day?all.filter(x=>x.time.startsWith(day)):all
  const counts={seen:filtered.length,diagnostic:0,withoutId:filtered.filter(x=>!x.rpid).length}
  const rows=filtered.slice(offset,offset+limit).map(r=>({...r,url:'https://www.bilibili.com/video/'+r.bvid+(r.rpid?'?comment='+encodeURIComponent(r.rpid):'')}))
  return {ok:true,total:filtered.length,offset,limit,days,counts,rows,
    note:'评论主记录来自 seen.md 及其月度归档；旧成功回执升级时一次性导入。成功回执不等于 B站 已公开展示。'}
}
