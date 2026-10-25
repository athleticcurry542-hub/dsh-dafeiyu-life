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
const fresh=()=>({version:1,notificationBootstrapped:false,seen:{},sent:[],replyRecords:[],ownReplies:{},threadHistory:{}});
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
    x.ownReplies=x.ownReplies&&typeof x.ownReplies==='object'?x.ownReplies:{};
    x.threadHistory=x.threadHistory&&typeof x.threadHistory==='object'?x.threadHistory:{};
    return x;
  }throw Error('invalid comment state');}catch(e){if(e.code==='ENOENT')return fresh();throw e;}}
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
    try{
      const db=JSON.parse(readFileSync(stateFile,'utf8'));
      const since=now()-WINDOW;
      sentLast24Hours=(db.sent||[]).filter(t=>Number(t)>since).length;
      for(const x of db.replyRecords||[]){if(Number(x.at)<=since)continue;
        if(x.scope==='self-top')sentOnOwnTop24h++;
        if(x.scope==='self-nested')sentOnOwnNested24h++;
      }
    }catch{/* 首次安装时暂无统计文件 */}
    const c=getConfig();
    return {busy,lastError,lastPollAt,sentLast24Hours,sentOnOwnTop24h,sentOnOwnNested24h,
      replyPerDay:cap(c.replyPerDay,1,1000,5),ownTopPerUser:cap(c.ownTopPerUser,1,1000,5),ownNestedPerUser:cap(c.ownNestedPerUser,1,1000,3)};
  }
  async function poll({notifications=true,top=true}={}){
    if(busy)return {skipped:'busy'};
    const cfg=getConfig();if(!cfg.watchReplies&&!cfg.watchTop)return {skipped:'disabled'};
    busy=true;let handle;
    try{
      await mkdir(dataDir,{recursive:true});handle=await lock();if(!handle)return {skipped:'locked'};
      const db=await load();const self=String(await selfUid());if(!/^\d+$/.test(self)||self==='0')throw Error('没有登录 UID，停止评论回复');
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
      let sent=0,ignored=0,failed=0,limitSkipped=0;
      const unique=new Set();
      const tagged=candidates.map(x=>({...x,scope:scopeOf(x,owned,db.ownReplies)}));
      // 我的顶层评论下 > 我的楼中楼回复下 > 其他回复通知 > 热门评论
      const order={'self-top':0,'self-nested':1,'notice':2,'top':3};
      tagged.sort((a,b)=>order[a.scope]-order[b.scope]||(a.kind==='top'?Number(isFishBait(b.text))-Number(isFishBait(a.text)):0));
      for(const x of tagged){
        if(unique.has(x.id)||db.seen[x.id])continue;unique.add(x.id);
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
          mustReply:x.scope==='self-top'||x.scope==='self-nested'});}
        catch(e){logger.warn?.('生成评论失败：'+String(e.message||e));failed++;continue;}
        const reply=String(result||'').trim().slice(0,130);
        if(!reply||reply==='SKIP'){db.seen[x.id]='skipped';ignored++;continue;}
        db.seen[x.id]='pending';await save(db);
        try{
          const ack=await send({bvid:x.bvid,aid:x.aid,rpid:x.rpid,root:x.root,text:reply});
          if(ack!==true&&ack?.ok!==true)throw Error(ack?.error||'评论未收到成功回执');
          db.seen[x.id]='sent';db.sent.push(now());sent++;
          db.replyRecords.push({at:now(),uid:x.uid,scope:x.scope,threadKey});
          const outboundId=validId(ack?.rpid);
          if(outboundId)db.ownReplies[outboundId]={at:now(),root,aid:validId(x.aid),bvid:x.bvid||''};
          const h=db.threadHistory[threadKey]??=[];
          h.push({role:'user',uid:x.uid,text:String(x.text).slice(0,350)}, {role:'assistant',uid:self,text:reply});
          if(h.length>24)h.splice(0,h.length-24);
        }catch(e){db.seen[x.id]='uncertain';failed++;logger.warn?.('评论发送结果不确定，不自动重试：'+String(e.message||e));}
        await save(db);
      }
      const keys=Object.keys(db.seen);if(keys.length>5000)for(const k of keys.slice(0,keys.length-5000))delete db.seen[k];
      // 避免长期增长：自发评论 ID 保留90天，评论串最多500条。
      for(const [id,r] of Object.entries(db.ownReplies))if(Number(r.at)<now()-90*WINDOW)delete db.ownReplies[id];
      const threads=Object.keys(db.threadHistory);if(threads.length>500)for(const k of threads.slice(0,threads.length-500))delete db.threadHistory[k];
      await save(db);lastPollAt=now();lastError='';
      return {sent,failed,ignored,limitSkipped,baselined};
    }catch(e){lastError=String(e.message||e);logger.error?.('评论监听失败：'+lastError);return {error:lastError};}
    finally{busy=false;if(handle){await handle.close().catch(()=>{});await unlink(lockPath).catch(()=>{});}}
  }
  return {poll,status,stateFile};
}
