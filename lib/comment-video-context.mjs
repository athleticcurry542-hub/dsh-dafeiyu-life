/** Background reply context. Reuse bounded evidence saved by the original video Agent;
 * refresh hot comments for the current conversation. Never infer unseen frames. */
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validBv,validId} from './comment-inbox.mjs';
const str=(v,n=450)=>String(v??'').replace(/[\x00-\x08\x0b-\x1f]/g,' ').slice(0,n);
function safeList(body){return Array.isArray(body?.comments)?body.comments:[];}
export function createCommentVideoContext({stateDir,getInfo,getHot,getSubtitle=async()=>({}),getThread=async()=>({error:"unavailable"}),logger=console,now=Date.now}){
  const live=new Map(),threads=new Map(),infos=new Map(),subtitles=new Map();
  async function snapshot(bvid){
    try { const file=join(stateDir,'comment-video-context',bvid+'.json');const data=JSON.parse(await readFile(file,'utf8'));return data?.version===1?data:{}; }
    catch{return {};}
  }
  async function report(bvid){
    const dir=join(stateDir,'out');let names=[];
    try{names=(await readdir(dir)).filter(x=>/^\d{4}-\d{2}-\d{2}\.md$/.test(x)).sort().reverse().slice(0,20)}catch{return '';}
    for(const name of names){
      let text='';try{text=await readFile(join(dir,name),'utf8')}catch{continue;}
      // This is an Agent-authored report, not independent proof of watching full frames.
      const marker=text.indexOf('### '+bvid);
      if(marker<0)continue;
      const section=text.slice(marker,marker+950).split(/\n(?=#{2,3}\s+BV[\da-zA-Z]{10}\b)/)[0];
      return str(section,600);
    }
    return '';
  }
  async function forReply(bvid,details={}){
    if(!validBv(bvid))return {usable:false,text:''};
    const old=await snapshot(bvid);
    let info=old.info&&typeof old.info==='object'?old.info:null;
    if(!info?.title){
      const memo=infos.get(bvid);
      if(memo&&now()-memo.at<120_000)info=memo.data;
      else try{const data=await getInfo(bvid);if(data?.title){info=data;infos.set(bvid,{data,at:now()});}}
      catch(e){logger.warn?.('视频详情读取失败 '+bvid+': '+str(e?.message,110));}
    }
    let subtitle=old.subtitle?.text?str(old.subtitle.text,1800):'';
    if(!subtitle && details.kind==='at'){
      const memo=subtitles.get(bvid);
      if(memo&&now()-memo.at<10*60_000)subtitle=memo.text;
      else {
        try{const result=await getSubtitle(bvid);if(result?.text)subtitle=str(result.text,1800);}
        catch(e){logger.warn?.('字幕读取失败 '+bvid+': '+str(e?.message,110));}
        subtitles.set(bvid,{at:now(),text:subtitle});
      }
    }
    const note=await report(bvid);
    // Short-lived hot-comment cache per process and BV: at most once / 2 minutes.
    let hot=live.get(bvid);
    if(!hot||now()-hot.at>120_000){
      try{const data=await getHot(bvid);if(!Array.isArray(data?.comments)||data?.error)throw Error(str(data?.error||'热门评论数据缺失',120));
        hot={at:now(),data};live.set(bvid,hot);
      }catch(e){logger.warn?.('最新热评不可用 '+bvid+': '+str(e?.message,110));hot=null;}
    }
    if(live.size>150)live.delete(live.keys().next().value);
    if(threads.size>200)threads.delete(threads.keys().next().value);
    if(infos.size>150)infos.delete(infos.keys().next().value);
    if(subtitles.size>150)subtitles.delete(subtitles.keys().next().value);
    const current=hot?safeList(hot.data):[];
    const earlier=Array.isArray(old.comments?.items)?old.comments.items:[];
    const snippets=[];
    if(info?.title)snippets.push('视频资料（接口读取/旧快照）：'+str(info.title,110)+'；简介：'+str(info.description,235));
    else if(note)snippets.push('此前本地报告（AI记录，未独立复核）：'+note.slice(0,360));
    // No need to repeat all hot comments, surface relevant root plus hot samples.
    const focus=new Set([validId(details.rpid),validId(details.root)].filter(Boolean));
    const selected=current.filter(c=>focus.has(validId(c?.rpid))).slice(0,2);
    const samples=current.filter(c=>!focus.has(validId(c?.rpid))).slice(0,4);
    if(selected.length)snippets.push('相关评论（最新热评列表内）：'+selected.map(c=>str(c.content,110)).join(' / '));
    if(samples.length)snippets.push('最新热门评论：'+samples.map(c=>str(c.content,85)).join(' / '));
    let threadAvailable=false;
    if(validId(details.root)){
      try{
        const key=bvid+':'+validId(details.root), cached=threads.get(key);
        let related;
        if(cached&&now()-cached.at<120_000)related=cached.data;
        else {related=await getThread(bvid,validId(details.root));threads.set(key,{at:now(),data:related});}
        if(Array.isArray(related?.replies)&&!related?.error){
          threadAvailable=true;
          const tail=related.replies.slice(-5).map(c=>str(c.content,105)).filter(Boolean);
          if(tail.length)snippets.push('该评论串最近回复：'+tail.join(' / '));
        }
      }catch(e){logger.warn?.('相关评论读取失败 '+bvid+': '+str(e?.message,110));}
    }
    if(subtitle)snippets.push('实际取得的字幕节选：'+str(subtitle,240));
    if(!hot&&earlier.length)snippets.push('历史热门评论快照（可能已变化）：'+earlier.slice(0,3).map(c=>str(c.content,80)).join(' / '));
    // B站顶层评论 @ 的 root_id 通常为 0，本来就没有需要读取的父楼层。
    // 若已取得真实视频信息和当下热门评论，结合通知中的原评论即可安全决策；
    // 不得因为一个不存在的楼中楼把整条邀请误判为不可用。
    const topLevelInvite=details.kind==='at' && !validId(details.root) && !!validId(details.rpid) && !!String(details.text||'').trim();
    if(topLevelInvite)snippets.push('本次 @ 位于视频顶层评论，邀请原文见当前通知；该评论没有父楼层，不要求取得楼中楼。');
    snippets.push('当前邀请／回复对象的原评论及其父评论以通知上下文为准；未获得的视频画面不能编造。');
    return {text:snippets.join('\n').slice(0,1100),usable:!!(info?.title||subtitle||note) && !!hot && (threadAvailable || topLevelInvite),
      fromCache:!!old.info||!!old.subtitle,hotFresh:!!hot};
  }
  return {forReply};
}
