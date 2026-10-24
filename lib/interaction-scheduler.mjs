/** 一个后台调度器：私信每N分钟，评论通知每3分钟，热门评论每5分钟。 */
export function createInteractionScheduler({dm,comments,getConfig,logger=console,now=Date.now}) {
  let stopped=true,timer,working=false;
  let dmAt=0,noticeAt=0,topAt=0;
  async function tick(){
    if(stopped||working)return;working=true;
    try {
      const cfg=getConfig();if(cfg.masterEnabled===false)return;const nowMs=now();const jobs=[];
      if(cfg.dmWatch && nowMs>=dmAt){dmAt=nowMs+Math.max(1,Number(cfg.dmWatchMinutes)||1)*60000;jobs.push(dm.poll());}
      const notification=cfg.commentWatchReplies && nowMs>=noticeAt;
      const top=cfg.commentWatchTop && nowMs>=topAt;
      if(notification)noticeAt=nowMs+3*60000;
      if(top)topAt=nowMs+5*60000;
      if(notification||top) jobs.push(comments.poll({notifications:notification,top}));
      await Promise.allSettled(jobs);
    }catch(e){logger.error?.('后台互动调度错误：'+String(e.message||e));}
    finally{working=false;}
  }
  function start(){if(!stopped)return;stopped=false;void tick();timer=setInterval(()=>{void tick()},60000);timer.unref?.();}
  function stop(){stopped=true;clearInterval(timer);}
  return {start,stop,tick,status:()=>({running:!stopped,working})};
}
