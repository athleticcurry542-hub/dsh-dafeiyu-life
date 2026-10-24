/**
 * B站评论互动：通知回复 + 最近视频热评。默认全部关闭；AI 可以拒绝回复。
 * 发送前持久化占位，网络结果不确定时不自动重试，避免重复刷屏。
 */
import {mkdir, open, stat, readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {normalizeReplyNotifications, normalizeTopComments, isFishBait, validBv} from './comment-inbox.mjs';
const cap = (n,lo,hi,def) => Number.isFinite(Number(n)) ? Math.max(lo,Math.min(hi,Math.floor(Number(n)))) : def;
export function createCommentInteract({dataDir,getConfig,selfUid,getNotifications,getVideos,getComments,generateReply,send,logger=console,now=Date.now}) {
  const stateFile = join(dataDir,'comment-interact-state.json');
  const lockPath = join(dataDir,'comment-interact.lock');
  let busy=false, lastError='',lastPollAt=0;
  const fresh=()=>({version:1,notificationBootstrapped:false,seen:{}, sent:[]});
  async function load() {try {const x=JSON.parse(await readFile(stateFile,'utf8')); if(x?.version===1&&x.seen&&Array.isArray(x.sent)) return x; throw new Error('invalid comment state');}catch(e){if(e.code==='ENOENT')return fresh();throw e;}}
  async function save(db) { const tmp=stateFile+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(db,null,2)+'\n',{mode:0o600});await rename(tmp,stateFile); }
  async function lock() {
    try {const handle=await open(lockPath,'wx',0o600);await handle.writeFile(String(process.pid));return handle;}
    catch(e) {
      if(e.code!=='EEXIST')throw e;
      const age=await stat(lockPath).then(x=>now()-x.mtimeMs).catch(()=>0);
      const pid=Number(await readFile(lockPath,'utf8').catch(()=>'0'));
      let alive=true; if(pid>0)try{process.kill(pid,0)}catch(err){alive=err.code!=='ESRCH'}
      if(age>600_000 && pid>0&&!alive){await unlink(lockPath).catch(()=>{});return lock();}
      return null;
    }
  }
  async function poll({notifications=true,top=true}={}) {
    if(busy)return {skipped:'busy'};
    const cfg=getConfig();
    if(!cfg.watchReplies && !cfg.watchTop) return {skipped:'disabled'};
    busy=true;let handle;
    try {
      await mkdir(dataDir,{recursive:true});handle=await lock();if(!handle)return {skipped:'locked'};
      const db=await load();const self=String(await selfUid());if(!/^\d+$/.test(self)||self==='0')throw new Error('没有登录 UID，停止评论回复');
      const candidates=[];let baselined=0;
      if(cfg.watchReplies && notifications) {
        const received=normalizeReplyNotifications(await getNotifications(),self);
        if(!db.notificationBootstrapped) {
          for(const x of received) db.seen[x.id]='baseline';
          db.notificationBootstrapped=true;baselined=received.length;await save(db);
        } else candidates.push(...received);
      }
      if(cfg.watchTop && top) {
        const videos=(await getVideos()).filter(validBv).slice(0,cap(cfg.topVideoCount,1,6,3));
        for(const bv of videos){
          try {
            const comments=normalizeTopComments(await getComments(bv,cap(cfg.topCount,1,20,5)),bv,self);
            // 优先明确叫大肥鱼/投喂的评论；通常不搭讪不认识的观众。
            candidates.push(...comments.sort((a,b)=>Number(isFishBait(b.text))-Number(isFishBait(a.text))));
          } catch(e){logger.warn?.(`读取 ${bv} 评论失败：${String(e.message||e)}`);}
        }
      }
      db.sent=db.sent.filter(t=>t>now()-86400_000);
      const maxPoll=cap(cfg.replyPerPoll,1,5,1),maxDay=cap(cfg.replyPerDay,1,30,5);
      let sent=0,ignored=0,failed=0;
      const unique=new Set();
      const ordered=[...candidates.filter(x=>x.kind==='notice'),...candidates.filter(x=>x.kind==='top'&&isFishBait(x.text)),...candidates.filter(x=>x.kind==='top'&&!isFishBait(x.text))];
      for(const x of ordered){
        if(unique.has(x.id)||db.seen[x.id])continue;unique.add(x.id);
        if(sent>=maxPoll||db.sent.length>=maxDay)break; // 未处理消息留待下次
        if(x.kind==='top'&&!cfg.allowGeneralTop&&!isFishBait(x.text)){
          db.seen[x.id]='irrelevant';ignored++;continue;
        }
        let result;
        try {result=await generateReply({kind:'comment',mode:x.kind,text:x.text,uid:x.uid,context:x.context,bvid:x.bvid});}
        catch(e){logger.warn?.('生成评论失败：'+String(e.message||e));failed++;continue;}
        const reply=String(result||'').trim().slice(0,130);
        if(!reply || reply==='SKIP'){db.seen[x.id]='skipped';ignored++;continue;}
        // 先记录为 pending，再发出；发生超时等不确定投递时，严禁重复发送。
        db.seen[x.id]='pending';await save(db);
        try {
          const ack=await send({bvid:x.bvid,aid:x.aid,rpid:x.rpid,root:x.root,text:reply});
          if(ack!==true && ack?.ok!==true)throw new Error(ack?.error||'评论未收到成功回执');
          db.seen[x.id]='sent';db.sent.push(now());sent++;
        }catch(e){db.seen[x.id]='uncertain';failed++;logger.warn?.('评论发送结果不确定，不自动重试：'+String(e.message||e));}
        await save(db);
      }
      // 控制状态文件体积，保留最近5000个已处理ID。
      const keys=Object.keys(db.seen);if(keys.length>5000){for(const k of keys.slice(0,keys.length-5000))delete db.seen[k];}
      await save(db);lastPollAt=now();lastError='';
      return {sent,failed,ignored,baselined};
    }catch(e){lastError=String(e.message||e);logger.error?.('评论监听失败：'+lastError);return {error:lastError};}
    finally {busy=false;if(handle){await handle.close().catch(()=>{});await unlink(lockPath).catch(()=>{});}}
  }
  return {poll,status:()=>({busy,lastError,lastPollAt}),stateFile};
}
