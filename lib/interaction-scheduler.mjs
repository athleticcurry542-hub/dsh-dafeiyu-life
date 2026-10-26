/**
 * 统一后台轮询：私信、收到的评论回复、被 @ 邀请、近期视频热评。
 * 4 个间隔独立配置；评论来源在同一个 tick 内合并执行，以保留同一通知的去重能力。
 * 状态仅表示本次 DSH 宿主进程中的检查；不把轮询成功等同于成功发送评论。
 */
const MINUTE = 60_000;
const SCHEDULE_TICK_MS = 15_000;
const definitions = Object.freeze({
  dm: {key:'dmWatch',minutes:'dmWatchMinutes',defaultMinutes:1},
  replies: {key:'commentWatchReplies',minutes:'commentReplyWatchMinutes',defaultMinutes:3},
  mentions: {key:'commentAtEnabled',minutes:'commentAtWatchMinutes',defaultMinutes:3},
  top: {key:'commentWatchTop',minutes:'commentTopWatchMinutes',defaultMinutes:5},
});
const interval = (value,fallback) => Number.isFinite(Number(value)) && Number(value)>=1
  ? Math.max(1,Math.min(120,Math.floor(Number(value)))) : fallback;
export function createInteractionScheduler({dm,comments,getConfig,logger=console,now=Date.now}) {
  let stopped=true,timer,working=false;
  const runs=Object.fromEntries(Object.keys(definitions).map(k=>[k,{
    lastStartedAt:0,lastFinishedAt:0,lastResult:'',lastError:'',lastDetails:null,polling:false,
  }]));
  const configFor=(cfg,key)=>{
    const d=definitions[key];return {
      enabled:cfg.masterEnabled!==false && cfg[d.key]===true,
      intervalMinutes:interval(cfg[d.minutes],d.defaultMinutes),
    };
  };
  async function execute(keys,task) {
    const started=now();
    for (const key of keys){runs[key].lastStartedAt=started;runs[key].polling=true;}
    let value,error='';
    try {value=await task();if(value?.error)error=String(value.error);}
    catch(e){error=String(e?.message||e);logger.error?.('后台轮询执行错误：'+error);}
    const finished=now();
    for(const key of keys){
      Object.assign(runs[key],{lastFinishedAt:finished,polling:false,
        lastResult:error?'error':value?.skipped?'skipped':'completed',lastError:error,
        lastDetails:value&&typeof value==='object'?{
          sent:Number(value.sent)||0,failed:Number(value.failed)||0,ignored:Number(value.ignored)||0,
          skipped:String(value.skipped||'').slice(0,80),
        }:null,
      });
    }
  }
  async function tick(){
    if(stopped||working)return;working=true;
    try{
      const cfg=getConfig();if(cfg.masterEnabled===false)return;
      const nowMs=now();
      const due=(key)=>{const opts=configFor(cfg,key),last=runs[key].lastStartedAt;
        return opts.enabled&&!runs[key].polling&&(!last||nowMs>=last+opts.intervalMinutes*MINUTE);
      };
      const dmDue=due('dm');
      const commentKeys=['replies','mentions','top'].filter(due);
      const jobs=[];
      if(dmDue)jobs.push(execute(['dm'],()=>dm.poll()));
      if(commentKeys.length)jobs.push(execute(commentKeys,()=>comments.poll({
        notifications:commentKeys.includes('replies'),mentions:commentKeys.includes('mentions'),top:commentKeys.includes('top'),
      })));
      await Promise.allSettled(jobs);
    }catch(e){logger.error?.('后台互动调度错误：'+String(e?.message||e));}
    finally{working=false;}
  }
  function start(){if(!stopped)return;stopped=false;void tick();timer=setInterval(()=>{void tick()},SCHEDULE_TICK_MS);timer.unref?.();}
  function stop(){stopped=true;clearInterval(timer);timer=undefined;}
  function status(){
    const cfg=getConfig(),current=now();
    return {running:!stopped,working,checkedAt:current,checks:Object.fromEntries(
      Object.keys(definitions).map(key=>{
        const opts=configFor(cfg,key),r=runs[key];
        return [key,{...opts,...r,nextAt:!stopped&&opts.enabled
          ? r.polling?null:r.lastStartedAt?Math.max(current,r.lastStartedAt+opts.intervalMinutes*MINUTE):current
          :null}];
      })
    )};
  }
  return {start,stop,tick,status};
}
