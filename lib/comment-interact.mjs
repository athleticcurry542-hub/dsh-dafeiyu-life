/**
 * B站后台公开评论互动。只对经本地发送账本证实归属我的评论启用优先回复。
 * 顶层评论/楼中楼各自按 UID 近24小时限额；全局仍受每轮、近24小时、Python 每日硬闸约束。
 * 回复前持久化 pending；网络结果未知时不自动重发。
 */
import {mkdir,open,stat,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {normalizeReplyNotifications,normalizeTopComments,isFishBait,validBv} from './comment-inbox.mjs';
const cap=(n,lo,hi,def)=>Number.isFinite(Number(n))?Math.max(lo,Math.min(hi,Math.floor(Number(n)))):def;
const validId=v=>/^\d{1,30}$/.test(String(v||''))?String(v):'';
const WINDOW=86400_000;
const fresh=()=>({version:1,notificationBootstrapped:false,seen:{},sent:[],replyRecords:[],sendAttempts:[],sendAttemptHistoryStartedAt:0,globalQuotaBlocked:null,ownReplies:{},threadHistory:{}});
const localDayKey=ms=>{const d=new Date(ms);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const hardQuotaError=message=>/(?:已达到硬上限|每日硬上限禁用|额度已满|达到全局评论上限)/i.test(String(message||''));
const quotaStoreError=message=>/(?:配额记录不可用|database is locked|sqlite|数据库.*(?:锁|不可用))/i.test(String(message||''));
const errorClass=message=>{
  const s=String(message||'');
  if(hardQuotaError(s))return 'blocked_quota';
  if(quotaStoreError(s))return 'blocked_quota_store';
  if(/评论配额|评论额度|评论上限|额度.*(?:禁用|已满)|配额.*(?:不可用|已满)/i.test(s))return 'blocked_quota_store';
  if(/后台评论回复已关闭|总开关已关闭|插件已暂停|发送已暂停|开关关闭/i.test(s))return 'blocked';
  if(/结果不确定|超时|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|网络|连接重置|回执未包含|未收到成功回执|fetch failed/i.test(s))return 'uncertain';
  return 'failed';
};
function scopeOf(row,owned,ownReplies){
  if(row.kind!=='notice')return 'top';
  const target=validId(row.targetId),root=validId(row.root);
  // 直接回复我的楼中楼 A，走独立额度；在我顶层评论下直接留言则走主评论额度。
  if(target&&(owned.nested.has(target)||ownReplies[target]))return 'self-nested';
  if((root&&owned.top.has(root))||(target&&owned.top.has(target)))return 'self-top';
  return 'notice'; // 归属不能确认时沿用普通通知的可跳过回复，不冒充强制回复
}
export function createCommentInteract({dataDir,getConfig,selfUid,getNotifications,getVideos,getComments,getOwnComments=()=>({top:new Set(),nested:new Set()}),generateReply,send,logger=console,now=Date.now}){
  const stateFile=join(dataDir,'comment-interact-state.json');
  const lockPath=join(dataDir,'comment-interact.lock');
  let busy=false,lastError='',lastPollAt=0;
  async function load(){try{const x=JSON.parse(await readFile(stateFile,'utf8'));if(x?.version===1&&x.seen&&Array.isArray(x.sent)){
    x.replyRecords=Array.isArray(x.replyRecords)?x.replyRecords:[];
    if(!Array.isArray(x.sendAttempts)){
      x.sendAttempts=[];
      x.sendAttemptHistoryStartedAt=now();
    }else if(!Number.isFinite(Number(x.sendAttemptHistoryStartedAt))||Number(x.sendAttemptHistoryStartedAt)<=0){
      x.sendAttemptHistoryStartedAt=Number(x.sendAttempts[0]?.at)||now();
    }
    x.globalQuotaBlocked=x.globalQuotaBlocked&&typeof x.globalQuotaBlocked==='object'?x.globalQuotaBlocked:null;
    x.ownReplies=x.ownReplies&&typeof x.ownReplies==='object'?x.ownReplies:{};
    x.threadHistory=x.threadHistory&&typeof x.threadHistory==='object'?x.threadHistory:{};
    return x;
  }throw Error('invalid comment state');}catch(e){if(e.code==='ENOENT'){const x=fresh();x.sendAttemptHistoryStartedAt=now();return x;}throw e;}}
  async function save(db){const tmp=stateFile+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(db,null,2)+'\n',{mode:0o600});await rename(tmp,stateFile);}
  async function lock(){
    try{const handle=await open(lockPath,'wx',0o600);await handle.writeFile(String(process.pid));return handle;}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      const age=await stat(lockPath).then(x=>now()-x.mtimeMs).catch(()=>0);
      const pid=Number(await readFile(lockPath,'utf8').catch(()=>'0'));
      let alive=true;if(pid>0)try{process.kill(pid,0)}catch(err){alive=err.code!=='ESRCH'}
      if(age>600_000&&pid>0&&!alive){await unlink(lockPath).catch(()=>{});return lock();}
      return null;
    }
  }
  const windowRecords=db=>(db.replyRecords||[]).filter(r=>Number(r.at)>now()-WINDOW);
  function status(){
    let sentLast24Hours=0,sentOnOwnTop24h=0,sentOnOwnNested24h=0;
    let sendAttemptHistoryAvailable=false,sendAttemptHistoryStartedAt=0,sendFailedLast24Hours=0,sendUncertainLast24Hours=0,
      sendBlockedByGlobalQuotaLast24Hours=0,sendBlockedOtherLast24Hours=0,sendPendingLast24Hours=0;
    let globalQuotaBlocked=null;
    try{
      const db=JSON.parse(readFileSync(stateFile,'utf8'));
      const since=now()-WINDOW;
      sentLast24Hours=(db.sent||[]).filter(t=>Number(t)>since).length;
      sendAttemptHistoryAvailable=Array.isArray(db.sendAttempts);
      sendAttemptHistoryStartedAt=Number(db.sendAttemptHistoryStartedAt)||0;
      const attempts=(db.sendAttempts||[]).filter(a=>Number(a.at)>since);
      sendFailedLast24Hours=attempts.filter(a=>a.outcome==='failed').length;
      sendUncertainLast24Hours=attempts.filter(a=>a.outcome==='uncertain').length;
      sendBlockedByGlobalQuotaLast24Hours=attempts.filter(a=>a.outcome==='blocked_quota').length;
      sendBlockedByGlobalQuotaLast24Hours+=attempts.filter(a=>a.outcome==='blocked_quota_store').length;
      sendBlockedOtherLast24Hours=attempts.filter(a=>a.outcome==='blocked').length;
      sendPendingLast24Hours=attempts.filter(a=>a.outcome==='pending').length;
      globalQuotaBlocked=db.globalQuotaBlocked&&typeof db.globalQuotaBlocked==='object'?db.globalQuotaBlocked:null;
      for(const x of db.replyRecords||[]){if(Number(x.at)<=since)continue;
        if(x.scope==='self-top')sentOnOwnTop24h++;
        if(x.scope==='self-nested')sentOnOwnNested24h++;
      }
    }catch{/* 首次安装时暂无统计文件 */}
    const c=getConfig();
    const quotaBlockMatches=!!(globalQuotaBlocked&&globalQuotaBlocked.day===localDayKey(now())&&Number(globalQuotaBlocked.limit)===cap(c.globalDailyLimit,0,1000,10));
    const quotaBlockActive=quotaBlockMatches&&(globalQuotaBlocked.reason!=='store-error'||Number(globalQuotaBlocked.retryAfter)>now());
    return {busy,lastError,lastPollAt,sentLast24Hours,sentOnOwnTop24h,sentOnOwnNested24h,
      sendAttemptHistoryAvailable,
      sendAttemptHistoryStartedAt,
      sendAttemptsLast24Hours:sentLast24Hours+sendFailedLast24Hours+sendUncertainLast24Hours+sendBlockedByGlobalQuotaLast24Hours+sendBlockedOtherLast24Hours+sendPendingLast24Hours,
      sendFailedLast24Hours,sendUncertainLast24Hours,sendBlockedByGlobalQuotaLast24Hours,sendBlockedOtherLast24Hours,sendPendingLast24Hours,
      globalQuotaBlocked:!!quotaBlockActive,
      globalQuotaBlockReason:quotaBlockActive?String(globalQuotaBlocked.reason||'limit'):'',
      replyPerDay:cap(c.replyPerDay,1,1000,5),ownTopPerUser:cap(c.ownTopPerUser,1,1000,5),ownNestedPerUser:cap(c.ownNestedPerUser,1,1000,3)};
  }
  async function poll({notifications=true,top=true}={}){
    if(busy)return {skipped:'busy'};
    const cfg=getConfig();if(!cfg.watchReplies&&!cfg.watchTop)return {skipped:'disabled'};
    busy=true;let handle;
    try{
      await mkdir(dataDir,{recursive:true});handle=await lock();if(!handle)return {skipped:'locked'};
      const db=await load();
      const today=localDayKey(now()),globalLimit=cap(cfg.globalDailyLimit,0,1000,10);
      // 全局公开评论额度已经耗尽时，整轮停止，不让每分钟的后台轮询反复生成回复、反复调用 MCP。
      // 新自然日或用户修改全局上限后会重新检查；旧通知不会被永久标成已回复。
      const sameQuotaBlock=!!(db.globalQuotaBlocked&&db.globalQuotaBlocked.day===today&&Number(db.globalQuotaBlocked.limit)===globalLimit);
      if(sameQuotaBlock&&db.globalQuotaBlocked.reason!=='store-error'){
        lastPollAt=now();lastError='';return {sent:0,failed:0,ignored:0,limitSkipped:0,quotaBlocked:0,skipped:'global-quota-exhausted'};
      }
      if(sameQuotaBlock&&db.globalQuotaBlocked.reason==='store-error'&&Number(db.globalQuotaBlocked.retryAfter)>now()){
        lastPollAt=now();lastError='';return {sent:0,failed:0,ignored:0,limitSkipped:0,quotaBlocked:0,skipped:'quota-store-cooldown'};
      }
      if(db.globalQuotaBlocked){
        const retryingStoreError=db.globalQuotaBlocked.reason==='store-error';
        db.globalQuotaBlocked=null;
        for(const [id,value] of Object.entries(db.seen)){
          if(typeof value==='string'&&value.startsWith('quota-blocked:')){
            const [,blockedDay,blockedLimit]=value.split(':');
            if(retryingStoreError||blockedDay!==today||Number(blockedLimit)!==globalLimit)delete db.seen[id];
          }
        }
        await save(db);
      }
      const self=String(await selfUid());if(!/^\d+$/.test(self)||self==='0')throw Error('没有登录 UID，停止评论回复');
      const ownedRaw=await getOwnComments();
      const owned={top:new Set(ownedRaw?.top||[]),nested:new Set(ownedRaw?.nested||[])};
      const candidates=[];let baselined=0;
      if(cfg.watchReplies&&notifications){
        const received=normalizeReplyNotifications(await getNotifications(),self);
        if(!db.notificationBootstrapped){
          // 首次启动仅恢复有明确近24小时日期且能证明回复了我自己的评论的通知。
          // 无时间/无归属的不补发，避免重装插件后对陈年通知群发回复。
          for(const x of received) {
            const scope=scopeOf(x,owned,db.ownReplies);
            if((scope==='self-top'||scope==='self-nested') &&
              x.timestampMs>now()-WINDOW && x.timestampMs<=now()+60_000) candidates.push(x);
            else { db.seen[x.id]='baseline';baselined++; }
          }
          db.notificationBootstrapped=true;await save(db);
        }else candidates.push(...received);
      }
      if(cfg.watchTop&&top){
        const videos=(await getVideos()).filter(validBv).slice(0,cap(cfg.topVideoCount,1,6,3));
        for(const bv of videos){try{
          const comments=normalizeTopComments(await getComments(bv,cap(cfg.topCount,1,20,5)),bv,self);
          candidates.push(...comments.sort((a,b)=>Number(isFishBait(b.text))-Number(isFishBait(a.text))));
        }catch(e){logger.warn?.(`读取 ${bv} 评论失败：${String(e.message||e)}`);}}
      }
      const since=now()-WINDOW;
      db.sent=db.sent.filter(t=>Number(t)>since);
      db.replyRecords=windowRecords(db);
      const maxPoll=cap(cfg.replyPerPoll,1,5,1),maxDay=cap(cfg.replyPerDay,1,1000,5);
      const topCap=cap(cfg.ownTopPerUser,1,1000,5),nestedCap=cap(cfg.ownNestedPerUser,1,1000,3);
      let sent=0,ignored=0,failed=0,limitSkipped=0,quotaBlocked=0;
      const unique=new Set();
      const tagged=candidates.map(x=>({...x,scope:scopeOf(x,owned,db.ownReplies)}));
      // 我的顶层评论下 > 我的楼中楼回复下 > 其他回复通知 > 热门评论
      const order={'self-top':0,'self-nested':1,'notice':2,'top':3};
      tagged.sort((a,b)=>order[a.scope]-order[b.scope]||(a.kind==='top'?Number(isFishBait(b.text))-Number(isFishBait(a.text)):0));
      for(const x of tagged){
        if(unique.has(x.id))continue;
        const prior=db.seen[x.id];
        if(typeof prior==='string'&&prior.startsWith('quota-blocked:')){
          const [,blockedDay,blockedLimit]=prior.split(':');
          if(blockedDay===today&&Number(blockedLimit)===globalLimit)continue;
          delete db.seen[x.id];
        }
        if(db.seen[x.id])continue;unique.add(x.id);
        if(sent>=maxPoll||db.sent.length>=maxDay)break;
        if(x.kind==='top'&&!cfg.allowGeneralTop&&!isFishBait(x.text)){db.seen[x.id]='irrelevant';ignored++;continue;}
        const capFor=x.scope==='self-top'?topCap:x.scope==='self-nested'?nestedCap:0;
        if(capFor&&db.replyRecords.filter(r=>r.uid===x.uid&&r.scope===x.scope).length>=capFor){
          db.seen[x.id]='per-user-limit';limitSkipped++;continue;
        }
        const root=validId(x.root)||validId(x.rpid);
        const threadKey=`${validId(x.aid)||x.bvid||'unknown'}:${root}`;
        const contextHistory=(db.threadHistory[threadKey]||[]).slice(-20);
        const history=contextHistory.map(h=>({role:h.role,text:String(h.text||'').slice(0,350)}));
        const context=[x.context?`被回复的内容：${x.context}`:'',history.length?'当前视频同一评论串的近况：'+history.map(h=>(h.role==='assistant'?'大肥鱼':'观众')+'：'+h.text).join('；'):''].filter(Boolean).join('\n').slice(0,1200);
        let result;
        try{result=await generateReply({kind:'comment',mode:x.scope,text:x.text,uid:x.uid,context,history,bvid:x.bvid,
          mustReply:x.scope==='self-top'||x.scope==='self-nested',canSkip:true});}
        catch(e){logger.warn?.('生成评论失败：'+String(e.message||e));failed++;continue;}
        const reply=String(result||'').trim().slice(0,130);
        if(!reply||reply==='SKIP'){
          db.seen[x.id]='skipped';ignored++;
          if(reply==='SKIP'){
            // 记下对方的收尾消息；以后同一评论串重新开始话题时仍能理解前情。
            const h=db.threadHistory[threadKey]??=[];
            h.push({role:'user',uid:x.uid,text:String(x.text).slice(0,350)});
            if(h.length>24)h.splice(0,h.length-24);
          }
          continue;
        }
        db.seen[x.id]='pending';
        const attempt={at:now(),outcome:'pending',scope:x.scope,bvid:validBv(x.bvid)?x.bvid:''};
        db.sendAttempts.push(attempt);
        db.sendAttempts=db.sendAttempts.filter(a=>Number(a.at)>now()-7*WINDOW).slice(-10000);
        await save(db);
        try{
          const ack=await send({bvid:x.bvid,aid:x.aid,rpid:x.rpid,root:x.root,text:reply});
          if(ack!==true&&ack?.ok!==true)throw Error(ack?.error||'评论未收到成功回执');
          attempt.outcome='success';attempt.completedAt=now();
          db.seen[x.id]='sent';db.sent.push(now());sent++;
          db.replyRecords.push({at:now(),uid:x.uid,scope:x.scope,threadKey,
            bvid:validBv(x.bvid)?x.bvid:'',aid:validId(x.aid),
            outboundRpid:validId(ack?.rpid||ack?.rpid_str),
            recipientName:String(x.name||'').trim().slice(0,60)});
          const outboundId=validId(ack?.rpid);
          if(outboundId)db.ownReplies[outboundId]={at:now(),root,aid:validId(x.aid),bvid:x.bvid||''};
          const h=db.threadHistory[threadKey]??=[];
          h.push({role:'user',uid:x.uid,text:String(x.text).slice(0,350)}, {role:'assistant',uid:self,text:reply});
          if(h.length>24)h.splice(0,h.length-24);
        }catch(e){
          const message=String(e?.message||e),outcome=errorClass(message);
          attempt.outcome=outcome;attempt.completedAt=now();
          if(outcome==='blocked_quota'||outcome==='blocked_quota_store'){
            // 明确知道未发起公开发布：硬上限耗尽时暂停到次日/改设置；账本暂不可用时冷却5分钟后再试。
            db.seen[x.id]=`quota-blocked:${today}:${globalLimit}`;
            const storeError=outcome==='blocked_quota_store';
            db.globalQuotaBlocked={day:today,limit:globalLimit,at:now(),reason:storeError?'store-error':'limit',retryAfter:storeError?now()+300_000:0};quotaBlocked++;
            logger.warn?.(storeError?'公开评论额度账本不可用，本轮停止并冷却5分钟':'公开评论全局额度已阻止发送，本轮停止并暂停后续重复调用');
          }else{
            db.seen[x.id]='uncertain';failed++;
            logger.warn?.('评论发送未确认，不自动重试：'+outcome);
          }
        }
        await save(db);
        if(quotaBlocked)break;
      }
      const keys=Object.keys(db.seen);if(keys.length>5000)for(const k of keys.slice(0,keys.length-5000))delete db.seen[k];
      // 避免长期增长：自发评论 ID 保留90天，评论串最多500条。
      for(const [id,r] of Object.entries(db.ownReplies))if(Number(r.at)<now()-90*WINDOW)delete db.ownReplies[id];
      const threads=Object.keys(db.threadHistory);if(threads.length>500)for(const k of threads.slice(0,threads.length-500))delete db.threadHistory[k];
      await save(db);lastPollAt=now();lastError='';
      return {sent,failed,ignored,limitSkipped,baselined,quotaBlocked};
    }catch(e){lastError=String(e.message||e);logger.error?.('评论监听失败：'+lastError);return {error:lastError};}
    finally{busy=false;if(handle){await handle.close().catch(()=>{});await unlink(lockPath).catch(()=>{});}}
  }
  return {poll,status,stateFile};
}
