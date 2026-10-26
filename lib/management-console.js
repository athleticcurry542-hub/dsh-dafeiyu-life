'use strict';
// No eval/innerHTML for user-supplied strings. Same-origin local console only.
(() => {
  const API='/api/bili-duty';
  const $=id=>document.getElementById(id);
  const node=(tag,text='',className='')=>{const e=document.createElement(tag);if(className)e.className=className;e.textContent=String(text??'');return e};
  const pill=(status)=>node('span',({pending:'待审核',approved:'已批准',rejected:'已拒绝'})[status]||status,'pill '+status);
  const add=(e,...items)=>{for(const x of items)if(x)e.appendChild(x);return e};
  const info=(x)=>node('p',x,'muted');
  const btn=(text,fn,kind='')=>{const b=node('button',text,kind);b.type='button';b.addEventListener('click',()=>run(fn));return b};
  const run=async(fn)=>{const before=$('message').textContent;try{await fn();if($('message').textContent===before)message('操作已完成')}catch(e){message(e?.message||'操作失败',true)}};
  const message=(m,bad=false)=>{const e=$('message');e.textContent=String(m||'');e.style.color=bad?'var(--bad)':'var(--action)'};
  const request=async(path,body)=>{
    const res=await fetch(API+path,body===undefined?{credentials:'same-origin'}:{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let data;try{data=await res.json()}catch{throw Error('服务器未返回 JSON（HTTP '+res.status+'）')}
    if(!res.ok||data?.ok===false)throw Error(String(data?.error||'请求失败').slice(0,180));
    return data;
  };
  const badge=(id,n)=>{const e=$(id);e.hidden=!n;e.textContent=String(n)};
  let active='persona';
  const refresh=()=>loaders[active]();
  const tabNames=['persona','comments','dm','growth','stickers','meme','quotas','polling','reports','diagnostics'];
  const switchTab=tab=>{
    if(!tabNames.includes(tab))return;
    active=tab; for(const t of tabNames){$('panel-'+t).hidden=t!==tab;document.querySelector(`[data-tab="${t}"]`).setAttribute('aria-selected',String(t===tab))}
    message('');run(refresh);
  };
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  $('refresh').addEventListener('click',()=>run(refresh));

  // v2.4.41: 所有数字输入都只在「次数与额度」提交。
  // 将旧评论/私信页的 DOM 控件物理搬迁，保留字段 ID 与原有验证规则，避免双入口覆盖设置。
  const quotaFields=[
    ['quota-per-day','perDay',0,1000000,50],['quota-pick-round','pickPerRound',1,50,5],
    ['quota-comment-daily','commentDailyLimit',0,1000,10],['quota-comment-round','commentPerRound',0,20,5],
    ['quota-dynamic-daily','dynamicDailyLimit',0,30,3],
    ['comment-top-count','commentTopCount',1,20,5],['comment-top-videos','commentTopVideoCount',1,6,3],
    ['comment-per-poll','commentReplyPerPoll',1,5,1],['comment-per-day','commentReplyPerDay',1,1000,5],
    ['comment-own-top-per-user','commentOwnTopPerUser',1,1000,5],['comment-own-nested-per-user','commentOwnNestedPerUser',1,1000,3],
    ['dm-reply-per-day','dmReplyPerDay',0,1000,0],
    ['dm-context-messages','dmContextMessages',0,80,40],['dm-stranger-max','dmStrangerMaxReplies',1,20,1],
    ['dm-total','dmApprovedTotalLimit',1,10000,50],['dm-daily','dmApprovedDailyLimit',1,1000,10],
    ['dm-wish-limit','dmWishMentionLimit',1,10,3],
    ['quota-meme-day','commentMemesPerDay',0,10000,2],['quota-meme-round','commentMemesPerRound',0,5,1],
    ['quota-meme-max','memeMemoryMaxEntries',10,2000,300],['quota-vision-frames','visionFrames',1,3,2],
    ['quota-min-views','minVideoViews',0,100000000,1000],['quota-min-likes','minVideoLikes',0,100000000,10],
    ['quota-min-replies','minVideoReplies',0,100000000,3]
  ];
  for (const [target,ids] of [
    ['quota-fields-comment',['comment-top-count','comment-top-videos','comment-per-poll','comment-per-day','comment-own-top-per-user','comment-own-nested-per-user']],
    ['quota-fields-dm',['dm-reply-per-day','dm-context-messages','dm-stranger-max','dm-total','dm-daily','dm-wish-limit']]
  ]) {
    for(const id of ids){const el=$(id);if(el?.parentElement)$(target).appendChild(el.parentElement)}
  }
  const quotaReadout=(id,text)=>{
    const input=$(id),wrap=input?.parentElement;if(!wrap)return;
    let out=wrap.querySelector('.quota-readout');if(!out){out=node('small','','quota-readout');wrap.appendChild(out)}
    out.textContent=text;
  };
  const quotaTile=(target,title,value,window)=>{
    const card=node('div','','quota-tile');add(card,node('span',title),node('strong',value),node('span',window));target.appendChild(card);
  };
  const loadQuotas=async()=>{
    const [config,quota,stat,dm]=await Promise.all([
      request('/config'),request('/comment-quota').catch(()=>({ok:false})),
      request('/status').catch(()=>({ok:false})),request('/dm-quota-usage').catch(()=>({ok:false}))
    ]);
    const c=config.config||{};
    for(const [id,key,,,fallback] of quotaFields)$(id).value=String(c[key]??fallback);
    const meter=(used,limit)=>used==null?'暂不可读':`${used} / ${limit}`;
    const daily=(used,limit)=>used==null?'今日已用：暂不可读':`今日已用 ${used} / ${limit}`;
    const commentUsed=quota.ok!==false && Number.isFinite(Number(quota.used))?Number(quota.used):null;
    const picked=stat.ok!==false&&Number.isFinite(Number(stat.pickedToday))?Number(stat.pickedToday):null;
    const dynamic=stat.ok!==false&&Number.isFinite(Number(stat.dynamicSyncUsage?.used))?Number(stat.dynamicSyncUsage.used):null;
    const reply=stat.ok!==false&&Number.isFinite(Number(stat.commentInteractStatus?.sentLast24Hours))?Number(stat.commentInteractStatus.sentLast24Hours):null;
    const dmUsed=dm.ok===true?Number(dm.sentToday):null;
    const dmRolling=dm.ok===true?Number(dm.sent24h):null;
    const memeUsed=quota.memeError||quota.memeUsed==null?null:Number(quota.memeUsed);
    const visionUsed=quota.visionError||quota.visionUsed==null?null:Number(quota.visionUsed);
    const dmCap=Number(c.dmReplyPerDay||0),approvedCap=Number(c.dmApprovedDailyLimit??10);
    $('quota-usage-summary').textContent=`本机日期 ${stat.today||quota.day||localDay()} · 设置值在下方修改；修改前显示当前真实使用量。`;
    const target=$('quota-usage-tiles');target.replaceChildren();
    quotaTile(target,'选片',meter(picked,c.perDay??50),'今日 · 已挑中的视频');
    quotaTile(target,'公开评论',meter(commentUsed,c.commentDailyLimit??10),'今日 · 发布接口尝试');
    quotaTile(target,'同步动态',meter(dynamic,c.dynamicDailyLimit??3),'今日 · 同步尝试');
    quotaTile(target,'后台评论回复',meter(reply,c.commentReplyPerDay??5),'滚动 24 小时 · 成功回执');
    quotaTile(target,'自动私信',meter(dmUsed,dmCap===0?'不限':dmCap),'今日 · 成功发送（额度闸门另按滚动24小时）');
    quotaTile(target,'附图',meter(memeUsed,c.commentMemesPerDay??2),'今日 · 占用的附图尝试');
    quotaTile(target,'独立视觉分析',meter(visionUsed,8),'今日 · 固定硬上限 8 次');
    quotaReadout('quota-per-day',daily(picked,c.perDay??50));
    quotaReadout('quota-comment-daily',daily(commentUsed,c.commentDailyLimit??10));
    quotaReadout('quota-dynamic-daily',daily(dynamic,c.dynamicDailyLimit??3));
    quotaReadout('comment-per-day',reply==null?'近24小时：暂不可读':`近24小时已成功 ${reply} / ${c.commentReplyPerDay??5}`);
    quotaReadout('dm-reply-per-day',dmRolling==null?'滚动24小时：暂不可读':`滚动24小时已发送 ${dmRolling} / ${dmCap===0?'不限制':dmCap}`);
    quotaReadout('dm-daily',dm.ok===true?`获批用户：今日最多单人已用 ${dm.approvedDailyMaxUsed} / ${approvedCap}（各 UID 独立）`:'获批用户用量：暂不可读');
    quotaReadout('dm-total',dm.ok===true?'这是每位获批用户的累计上限，非每天；详见后台私信用户记录':'这是每位用户的累计上限，非每天');
    quotaReadout('quota-meme-day',daily(memeUsed,c.commentMemesPerDay??2));
    if(visionUsed!==null)quotaReadout('quota-vision-frames',`独立分析今日 ${visionUsed} / 8 次（此项设置每视频帧数，不是日上限）`);
    else quotaReadout('quota-vision-frames','独立视觉分析今日用量暂不可读；此项只设置每视频帧数');
  };
  $('quota-refresh').addEventListener('click',()=>run(loadQuotas));
  $('quota-save').addEventListener('click',()=>run(async()=>{
    const payload={};
    for(const [id,key,min,max] of quotaFields)payload[key]=boundedInt(id,min,max,key);
    const saved=await request('/config',payload);
    await loadQuotas();
    message(saved.host?.ok===false?'已写插件配置，但同步到 DSH 失败：'+(saved.host.error||'未知原因'):'全部次数与额度已保存');
  }));

  // v2.4.53: 后台轮询设置单一入口，与每轮/每日额度分离；上次执行时间来自调度器实时状态。
  const pollingFields=[
    ['dm-interval','dmWatchMinutes'],
    ['poll-replies-minutes','commentReplyWatchMinutes'],
    ['poll-at-minutes','commentAtWatchMinutes'],
    ['poll-top-minutes','commentTopWatchMinutes'],
  ];
  const pollNames={dm:'自动私信',replies:'收到评论回复',mentions:'被 @ 邀请',top:'近期视频热评'};
  const pollClock=timestamp=>timestamp?new Date(timestamp).toLocaleString():'暂无';
  const loadPolling=async()=>{
    const data=await request('/status');const c=data.config||{},scheduler=data.interactionSchedulerStatus||{};
    const runs=scheduler.checks||{};
    for(const [id,key] of pollingFields){$(id).value=String(c[key]??({dmWatchMinutes:1,commentReplyWatchMinutes:3,commentAtWatchMinutes:3,commentTopWatchMinutes:5}[key]));}
    const target=$('polling-status-list');target.replaceChildren();
    for(const key of ['dm','replies','mentions','top']){
      const x=runs[key]||{},card=node('article','','settings-section');add(card,node('h4',pollNames[key]));
      const label=!scheduler.running?'宿主调度已停止':!x.enabled?'未启用':x.polling?'正在检查':x.lastResult==='error'?'最近检查失败':x.lastResult==='skipped'?'最近检查已跳过':x.lastFinishedAt?'最近检查完成':'尚未检查';
      add(card,node('p',`状态：${label} · 检查间隔：${x.intervalMinutes??'—'} 分钟`,'muted'));
      add(card,node('p',`上次开始：${pollClock(x.lastStartedAt)} · 上次完成：${pollClock(x.lastFinishedAt)}`,'muted'));
      add(card,node('p',`下次预计：${x.enabled&&scheduler.running?(x.polling?'本轮进行中':pollClock(x.nextAt)):'未计划'}`,'muted'));
      if(x.lastError)add(card,node('p','最近错误：'+String(x.lastError).slice(0,180),'muted'));
      else if(x.lastDetails?.skipped)add(card,node('p','跳过原因：'+String(x.lastDetails.skipped),'muted'));
      target.appendChild(card);
    }
  };
  $('polling-refresh').addEventListener('click',()=>run(loadPolling));
  $('polling-reload').addEventListener('click',()=>run(loadPolling));
  $('polling-save').addEventListener('click',()=>run(async()=>{
    const payload={};for(const [id,key] of pollingFields)payload[key]=boundedInt(id,1,120,key);
    const saved=await request('/config',payload);await loadPolling();
    message(saved.host?.ok===false?'间隔已保存到本插件，但同步 DSH 设置失败：'+(saved.host.error||'未知原因'):'四项轮询间隔已保存，下次检查会动态采用新值');
  }));

  // 显式加载内置默认提示词，旧用户已有非空自定义优先。不存在自动覆盖和自动保存。
  const promptEntries=[
    ['persona','personaPrompt','/persona-prompt-default','8000','大肥鱼人设'],
    ['meme-prompt','commentMemePrompt','/comment-meme-prompt-default','4000','AI 选图提示词'],
    ['vision-prompt','visionPrompt','/vision-prompt-default','4000','视觉识图提示词'],
    ['lore','characterLore','/character-lore-default','4000','角色背景']
  ];
  const promptDefaults={};
  let friendProfilesDraft={};
  let friendsDirectory=[];
  const uidValid=v=>/^[1-9]\d{0,18}$/.test(String(v||''));
  const friendName=r=>r.name||('UID '+r.uid);
  const normalizeFriends=rows=>{
    const seen=new Set();return rows.filter(r=>r&&uidValid(r.uid)).map(r=>({
      uid:String(r.uid), name:String(r.name||'').replace(/[<>|\r\n]/g,' ').trim().slice(0,40),
      dm:r.dm===true,mention:r.mention===true,atInvite:r.atInvite===true
    })).filter(r=>{if(seen.has(r.uid))return false;seen.add(r.uid);return true}).slice(0,120);
  };
  const readNames=text=>String(text||'').split(/[\r\n,，;；]+/).map(x=>x.trim()).filter(Boolean).map(x=>{
    const [left='',right='']=x.split('|').map(v=>v.trim());
    return uidValid(left)?{uid:left,name:right}:uidValid(right)?{uid:right,name:left}:null;
  }).filter(Boolean);
  const importPriorDirectory=c=>{
    let current=[];try{current=JSON.parse(c.friendDirectory||'[]')}catch{}
    const existing=normalizeFriends(Array.isArray(current)?current:[]);
    const map=new Map(existing.map(r=>[r.uid,r]));
    for(const [key,flag] of [['dmWhitelist','dm'],['mentionTargets','mention'],['commentAtWhitelist','atInvite']]){
      for(const item of readNames(c[key])){
        const r=map.get(item.uid)||{uid:item.uid,name:item.name,dm:false,mention:false,atInvite:false};
        if(!r.name&&item.name)r.name=item.name;r[flag]=true;map.set(r.uid,r);
      }
    }
    return normalizeFriends([...map.values()]);
  };
  const drawFriendDirectory=()=>{
    const target=$('friend-directory-editor');target.replaceChildren();
    if(!friendsDirectory.length){target.appendChild(info('还没有好友。请先添加 UID；昵称可留空。'));return}
    for(const row of friendsDirectory){
      const card=node('article','','settings-section');
      const heading=node('div','','toolbar');add(heading,node('strong',friendName(row)+' · UID '+row.uid), btn('移除',async()=>{
        if(!confirm('移除 UID '+row.uid+' 的名册权限和画像？请点击保存后才正式生效。'))return;
        friendsDirectory=friendsDirectory.filter(x=>x.uid!==row.uid);
        delete friendProfilesDraft[row.uid];drawFriendDirectory();
      },'danger'));
      card.appendChild(heading);
      const nameWrap=node('div','','fields');const nameL=node('label','昵称备注（不参与权限判断）');const nameInput=node('input');
      nameInput.value=row.name;nameInput.maxLength=40;nameInput.addEventListener('input',()=>{row.name=nameInput.value.trim();heading.querySelector('strong').textContent=friendName(row)+' · UID '+row.uid});
      add(nameWrap,add(node('div'),nameL,nameInput));card.appendChild(nameWrap);
      const checks=node('div','','friend-role-row');add(checks,node('span','权限（可以多选）','muted'));
      for(const [key,label] of [['dm','后台私信白名单'],['mention','大肥鱼主动 @'],['atInvite','允许对方 @ 大肥鱼']]){
        const wrap=node('label','','checkline');const check=document.createElement('input');check.type='checkbox';check.checked=row[key];
        check.addEventListener('change',()=>{row[key]=check.checked});add(wrap,check,node('span',label));checks.appendChild(wrap);
      }
      card.appendChild(checks);
      const profile=friendProfilesDraft[row.uid]||{};
      const fields=node('div','','fields');
      const makeField=(label,value,onUpdate,multiline=false)=>{
        const wrap=node('div');const lab=node('label',label);const el=node(multiline?'textarea':'input');
        el.value=value||'';el.maxLength=multiline?700:120;if(multiline)el.rows=3;
        el.addEventListener('input',()=>{const v=friendProfilesDraft[row.uid]||{};onUpdate(v,el.value);friendProfilesDraft[row.uid]=v});
        add(wrap,lab,el);return wrap;
      };
      fields.appendChild(makeField('与大肥鱼的关系',profile.relationship,(v,x)=>v.relationship=x));
      const ownerWrap=node('div');const ownerLab=node('label','大肥鱼的主人（可多个 UID）','');
      const ownerCheck=document.createElement('input');ownerCheck.type='checkbox';ownerCheck.checked=profile.role==='owner';
      ownerCheck.addEventListener('change',()=>{friendProfilesDraft[row.uid]={...(friendProfilesDraft[row.uid]||{}),role:ownerCheck.checked?'owner':'friend'}});
      add(ownerWrap,ownerLab,add(node('label','标为主人（仅角色设定，不授管理权限）','checkline'),ownerCheck));fields.appendChild(ownerWrap);
      fields.appendChild(makeField('性格爱好',profile.personalityInterests||[profile.personality,profile.interests].filter(Boolean).join('；'),(v,x)=>v.personalityInterests=x,true));
      card.appendChild(fields);
      const peers=node('div','','settings-section');add(peers,node('h4','与其他白名单用户的关系'),info('选一位 UID，填入这位好友与对方的关系；不能选择自己。'));
      const peerRows=Array.isArray(profile.peerRelationships)?profile.peerRelationships:[];
      const makePeer=(peer)=>{
        const line=node('div','','peer-line');const select=node('select');
        add(select, new Option('选择好友',''));
        for(const r of friendsDirectory.filter(x=>x.uid!==row.uid))add(select,new Option(friendName(r)+' · '+r.uid,r.uid));
        select.value=peer.uid||'';const description=node('input');description.placeholder='这两位是什么关系';description.maxLength=120;description.value=peer.relationship||'';
        const rm=btn('移除关系',async()=>{line.remove()});
        add(line,select,description,rm);peers.appendChild(line);
        // Persist draft from live editor in a safe, deterministic way.
        line.dataset.peer='1';line.dataset.forUid=row.uid;
        select.addEventListener('change',syncPeers);description.addEventListener('input',syncPeers);rm.addEventListener('click',syncPeers);
      };
      const syncPeers=()=>{const links=[...peers.querySelectorAll('.peer-line')].map(l=>({uid:l.querySelector('select')?.value||'',relationship:l.querySelector('input')?.value.trim()||''})).filter(x=>x.uid&&x.relationship&&x.uid!==row.uid);friendProfilesDraft[row.uid]={...(friendProfilesDraft[row.uid]||{}),peerRelationships:links}};
      for(const peer of peerRows)makePeer(peer);
      add(peers,btn('添加一项好友关系',async()=>{makePeer({uid:'',relationship:''})}));card.appendChild(peers);
      target.appendChild(card);
    }
  };
  const loadPersona=async()=>{
    const [config,...defaults]=await Promise.all([request('/config'),...promptEntries.map(x=>request(x[2]))]);
    const c=config.config||{};
    for(let i=0;i<promptEntries.length;i++){
      const [id,key]=promptEntries[i];const d=promptDefaults[key]=String(defaults[i].prompt||'');
      $(id+'-text').value=String(c[key]||d);
      $(id+'-status').textContent=String(c[key]||'').trim()?'已自定义':'内置默认';
    }
    $('friends-mode').value=['ai','ai_select','off','always'].includes(c.mentionMode)?c.mentionMode:'ai_select';
    friendsDirectory=importPriorDirectory(c);
    try{friendProfilesDraft=JSON.parse(c.mentionProfiles||'{}');if(!friendProfilesDraft||Array.isArray(friendProfilesDraft)||typeof friendProfilesDraft!=='object')friendProfilesDraft={}}catch{friendProfilesDraft={}}
    // Import old profile names by a one-off display-name match. Afterwards only UID keys are saved.
    for(const r of friendsDirectory){if(!friendProfilesDraft[r.uid]&&friendProfilesDraft[r.name])friendProfilesDraft[r.uid]=friendProfilesDraft[r.name]}
    drawFriendDirectory();
  };
  const saveFriends=async()=>{
    friendsDirectory=normalizeFriends(friendsDirectory);
    if(friendsDirectory.filter(r=>r.mention).length>8)throw Error('主动 @ 的好友最多 8 位，请取消多余勾选');
    const names=r=>r.uid+(r.name?'|'+r.name:'');
    const targets=friendsDirectory.filter(r=>r.mention).map(names).join('\n');
    const dm=friendsDirectory.filter(r=>r.dm).map(names).join('\n');
    const invite=friendsDirectory.filter(r=>r.atInvite).map(names).join('\n');
    const selected={};for(const r of friendsDirectory)if(friendProfilesDraft[r.uid])selected[r.uid]=friendProfilesDraft[r.uid];
    const payload={friendDirectory:JSON.stringify(friendsDirectory),mentionProfiles:JSON.stringify(selected),mentionMode:$('friends-mode').value,mentionTargets:targets,dmWhitelist:dm,commentAtWhitelist:invite,
      clear:[...(!targets?['mentionTargets']:[]),...(!dm?['dmWhitelist']:[]),...(!invite?['commentAtWhitelist']:[])]};
    const saved=await request('/config',payload);
    await loadPersona();message(saved.host?.ok===false?'已保存，但同步 DSH 设置失败：'+(saved.host.error||'未知原因'):'统一好友名册、三项权限与画像已保存');
  };
  $('friend-add').addEventListener('click',()=>run(async()=>{
    const uid=$('friend-new-uid').value.trim();if(!uidValid(uid))throw Error('请输入有效的纯数字 UID');
    if(friendsDirectory.some(r=>r.uid===uid))throw Error('这个 UID 已存在，可直接编辑该条');
    if(friendsDirectory.length>=120)throw Error('好友名册最多 120 人');
    friendsDirectory.push({uid,name:$('friend-new-name').value.trim(),dm:false,mention:false,atInvite:false});
    $('friend-new-uid').value='';$('friend-new-name').value='';drawFriendDirectory();message('已加入草稿，勾选权限后点击保存');
  }));
  $('friend-save-all').addEventListener('click',()=>run(saveFriends));
  $('friends-save').addEventListener('click',()=>run(saveFriends));
  $('friends-generate').addEventListener('click',()=>run(()=>{drawFriendDirectory();message('已刷新好友画像编辑项')}));
  for(const [id,key,,,label] of promptEntries){
    $(id+'-save').addEventListener('click',()=>run(async()=>{
      const text=$(id+'-text').value.trim();if(!text)throw Error(label+'不能为空；需要默认规则，请点击「恢复默认」');
      const isDefault=text===promptDefaults[key];
      const saved=await request('/config',{[key]:isDefault?'':text,clear:isDefault?[key]:[]});
      $(id+'-status').textContent=isDefault?'内置默认':'已自定义';
      message(saved.host?.ok===false?'保存成功，但 DSH 同步失败：'+(saved.host.error||'未知原因'):label+'已保存');
    }));
    $(id+'-reset').addEventListener('click',()=>run(async()=>{
      if(!confirm('恢复「'+label+'」为官方默认？当前自定义内容将清除。'))return;
      const saved=await request('/config',{[key]:'',clear:[key]});
      $(id+'-text').value=promptDefaults[key]||'';
      $(id+'-status').textContent='内置默认';
      message(saved.host?.ok===false?'已清除自定义，但 DSH 同步失败：'+(saved.host.error||'未知原因'):label+'已恢复默认');
    }));
  }
  $('persona-refresh').addEventListener('click',()=>run(loadPersona));

  const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const safeVideoLink=(bvid)=>{const bv=/^BV[0-9A-Za-z]{10}$/.test(String(bvid||''))?String(bvid):'';const a=node('a',bv||'打开视频');a.href='https://www.bilibili.com/video/'+encodeURIComponent(bv);a.target='_blank';a.rel='noopener noreferrer';return a};
  const safeCommentLink=(c)=>{
    const bv=/^BV[0-9A-Za-z]{10}$/.test(String(c?.bvid||''))?String(c.bvid):'';
    const rid=/^\d{6,30}$/.test(String(c?.rpid||''))?String(c.rpid):'';
    const root=/^\d{6,30}$/.test(String(c?.root||''))?String(c.root):'';
    const isReply=c?.kind==='reply';
    const videoLabel=bv||'视频 ID 未记录';
    const a=node('a',videoLabel);
    const base=bv?'https://www.bilibili.com/video/'+encodeURIComponent(bv)+'/':'https://www.bilibili.com/';
    if(bv&&rid&&(!isReply||root)){
      const params=new URLSearchParams();
      params.set('comment_on','1');
      params.set('comment_root_id',isReply?root:rid);
      if(isReply)params.set('comment_secondary_id',rid);
      a.href=base+'?'+params.toString()+'#reply'+encodeURIComponent(rid);
    }else a.href=base;
    a.target='_blank';a.rel='noopener noreferrer';
    a.title=rid&&(!isReply||root)?'点击定位具体评论 · rpid '+rid:
      (isReply&&rid?'该历史记录没有保存根评论 rpid，仅能打开视频':'仅能打开视频');
    return a
  };
  const reasonLabel=(x)=>({ai_declined:'AI 决定不 @',ai_selected_no_names:'AI 想 @，但未选中名单内好友',no_mention_targets:'没有配置 @ 名单',mention_disabled:'@ 策略已关闭',mentioned_text_only_missing_uid:'缺少有效 UID',mention_requested:'已按设置尝试 @',reply_no_group_mentions:'后台回复不群发 @'}[x]||x||'未提供原因');
  const dynamicStatusLabel=(x)=>({api_accepted_unverified:'B站接口接受（公开状态未核实）',ai_skipped:'AI 选择不同步',disabled:'同步开关关闭',blocked_by_setting:'被用户设置阻止',receipt_unverified:'评论回执不完整，无法安全同步',daily_limit:'达到每日动态上限',already_attempted:'同 BV 今日已尝试',reservation_failed_no_publish:'额度锁失败，未发布',comment_receipt_unverified_no_publish:'评论回执不完整，未发布',uncertain_no_retry:'发送结果不确定，不重试',failed:'动态接口失败',paused:'插件已暂停',not_requested:'未选择同步',comment_failed:'评论失败',not_applicable:'不适用于楼中楼回复'}[x]||x||'状态未知');
  const diagFields=[['diag-mention-enabled','diagMentionEnabled'],['diag-dynamic-enabled','diagDynamicEnabled'],['diag-vision-enabled','diagVisionEnabled'],['diag-meme-enabled','diagMemeEnabled']];
  $('diag-save').addEventListener('click',()=>run(async()=>{
    const patch={};for(const [id,key] of diagFields)patch[key]=$(id).checked;
    const saved=await request('/config',patch);
    message(saved.host?.ok===false?'已写入本地配置，DSH 设置同步失败：'+(saved.host.error||'未知原因'):'诊断开关已保存，后续任务按新开关记录；历史日志保留');
  }));
  const loadDiagnostics=async()=>{
    const [m,im,vi,config]=await Promise.all([request('/mention-diagnostics'),request('/meme-diagnostics'),request('/vision-diagnostics'),request('/config')]);
    for(const [id,key] of diagFields)$(id).checked=config.config?.[key]!==false;
    $('mention-summary').textContent=`${m.day||localDay()} · 已发表评论 ${m.total||0} 条 · 尝试 @ ${m.attempted||0} 条 · 未 @ ${m.notMentioned||0} 条 · 失败 ${m.failed||0} 条`;
    $('mention-list').replaceChildren();
    for(const x of (m.recent||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');add(top,safeVideoLink(x.bvid),node('span',' · '+(x.kind==='reply'?'楼中楼':'顶层')+' · '+(x.success?(x.mention_attempted?'尝试 @':'未 @'):'发送失败')));
      add(card,top,info((x.time||'')+' · '+reasonLabel(x.reason)+(x.mention_delivery?' · '+x.mention_delivery:'')));
      if(x.success&&x.reason==='ai_declined'&&x.ai_reason)add(card,info('AI说明：'+x.ai_reason));
      $('mention-list').appendChild(card);
    }
    if(!$('mention-list').children.length)$('mention-list').append(info('今天还没有 @ 诊断记录。'));
    const dy=m.dynamic||{};
    $('dynamic-summary').textContent=`顶层评论决策 ${dy.evaluated??0} 条 · AI 选择同步 ${dy.aiSelected??0} 条 · 接口接受 ${dy.accepted??0} 条 · AI 选择不同步 ${dy.aiSkipped??0} 条 · 设置／额度阻止 ${dy.blocked??0} 条`;
    $('dynamic-list').replaceChildren();
    for(const x of (m.dynamicRecent||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');
      add(top,safeVideoLink(x.bvid),node('span',' · '+(x.dynamic_ai_decision===true?'AI 选择同步':'AI 选择不同步')+' · '+dynamicStatusLabel(x.dynamic_status)));
      add(card,top,info((x.time||'')+(x.dynamic_reason?' · AI说明：'+x.dynamic_reason:'')));
      $('dynamic-list').appendChild(card);
    }
    if(!$('dynamic-list').children.length)$('dynamic-list').append(info('今天还没有动态决策诊断记录。'));
    $('vision-summary').textContent=`${vi.enabled?'识图开启':'识图关闭'} · Debug ${vi.debug?'开启':'关闭'} · 今日自动识图调用记录 ${vi.attempts||0} 次 · 本地已保存 ${vi.savedBvs||0} 个 BV / ${vi.savedJpegs||0} 张 JPEG · 路径：${vi.pathHint||'vision-debug/BV号/'}。没有记录时请先确认有自动刷片轮次，或到设置页手动测试一个 BV。`;
    $('vision-list').replaceChildren();
    for(const x of (vi.events||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');
      add(top,safeVideoLink(x.bvid),node('span',' · '+x.source+' · '+x.status+(x.debug_saved?' · 已保存JPEG':'')));
      add(card,top,info((x.time||'')+(x.times?.length?' · 预览秒数：'+x.times.join('、'):'')+(x.error?' · '+x.error:'')));
      $('vision-list').appendChild(card);
    }
    if(!$('vision-list').children.length)$('vision-list').append(info('今天没有实际识图工具调用／取帧日志。仅开启 Debug 不会产生文件。'));
    $('meme-summary').textContent=`${im.day||localDay()} · 顶层评论 ${im.total||0} 条 · 选图 ${im.attempted||0} 次 · 尝试附图 ${im.submitted||0} 次 · 未附图 ${im.notAttached||0} 条 · 失败 ${im.failed||0} 条`;
    $('meme-diag-list').replaceChildren();
    for(const x of (im.recent||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');add(top,safeVideoLink(x.bvid),node('span',' · '+(x.success?'评论已成功':'评论未成功')+' · '+(x.selected?'选图':'未选图')+' · '+(x.status||'')));
      add(card,top,info((x.time||'')+(x.image?' · 图片：'+x.image:'')));
      if(x.reason)add(card,info('原因：'+x.reason));
      $('meme-diag-list').appendChild(card);
    }
    if(!$('meme-diag-list').children.length)$('meme-diag-list').append(info('今天还没有表情包诊断记录。'));
  };
  $('diag-refresh').addEventListener('click',()=>run(loadDiagnostics));

  if($('report-day'))$('report-day').value=localDay();
  const loadReport=async()=>{
    const day=$('report-day').value||localDay();
    const data=await request('/report?day='+encodeURIComponent(day));
    $('report-meta').textContent=data.exists?`${data.day} · 已读取本地日报 · ${data.text.length.toLocaleString()} 字符`:`${data.day} · 这一天没有日报文件`;
    $('report-content').textContent=data.exists?(data.text||'（日报文件为空）'):'这一天没有日报。';
  };
  $('report-load').addEventListener('click',()=>run(loadReport));
  $('report-day').addEventListener('change',()=>run(loadReport));
  $('report-copy').addEventListener('click',()=>run(async()=>{const text=$('report-content').textContent||'';await navigator.clipboard.writeText(text);message('已复制报告文本')}));

  // 展示排序与磁盘存储顺序分离：待审核优先，已拒绝放最后，同状态最近修改在前。
  // 不修改 persona-growth/v1.json 的条目顺序或审计记录。
  const growthPriority={pending:0,approved:1,rejected:2};
  const growthDisplayOrder=entries=>[...entries].sort((a,b)=>{
    const priorityA=growthPriority[a.status]??3;
    const priorityB=growthPriority[b.status]??3;
    if(priorityA!==priorityB)return priorityA-priorityB;
    const changedA=Date.parse(a.updatedAt||a.createdAt||'')||0;
    const changedB=Date.parse(b.updatedAt||b.createdAt||'')||0;
    return changedB-changedA;
  });
  let growthPreviewQuery='';
  const growthList=async()=>{
    const data=await request('/persona-growth'+(growthPreviewQuery?'?query='+encodeURIComponent(growthPreviewQuery):''));$('growth-list').replaceChildren();
    const entries=data.data?.entries||[];
    badge('growth-count',entries.filter(e=>e.status==='pending').length);
    const filter=$('growth-filter').value;
    for(const e of growthDisplayOrder(entries.filter(e=>!filter||e.status===filter))){
      const card=node('article','','card');
      add(card,pill(e.status),pill(e.type),info('原始反馈（仅存档）：'+e.text),info('来源：'+(e.source==='owner-direct'?'主人直接编写':e.source==='owner'?'主人反馈':'日报')+(e.evidence?' · '+e.evidence:'')));
      const candidate=e.status==='approved'?(e.approvedText||e.text):(e.suggestedText||(e.source==='report'?e.text:''));
      const title=node('h4',e.status==='approved'?'已批准 · '+({style:'评论风格',interest:'长期兴趣',experience:'视频经历',relationship:'角色关系'}[e.type]||e.type):e.source==='report'?'日报统计候选 · 主人直接审核':(e.source==='owner-direct'||e.directReview)?'主人直接编写 · 待审核':'模型建议 · 审核前可修改');
      add(card,title);
      if(e.status==='approved'){
        add(card,info(candidate));
      }else{
        const edit=node('textarea',candidate);
        edit.value=candidate;edit.maxLength=230;edit.rows=4;edit.readOnly=e.source==='report';edit.placeholder=e.source==='report'?'日报已提供主题观察；直接批准即可':(e.source==='owner-direct'||e.directReview)?'直接审核稿：可修改后保存，再批准':'先点击「AI 提炼建议」，也可以选择直接审核原始反馈';
        edit.style.width='100%';
        add(card,edit);
        if(e.suggestionReason)add(card,info('提炼说明：'+e.suggestionReason));
        const draftActions=node('div','','actions');
        if(e.source==='owner'&&!e.suggestedText&&!e.modelSuggestedAt)add(draftActions,btn('不调用 AI，直接审核原始反馈',async()=>{await request('/persona-growth',{action:'direct',id:e.id});await growthList();message('已将原始反馈转为直接审核稿，可修改后批准。');}));
        if(e.source==='owner')add(draftActions,btn(e.suggestedText?'重新让 AI 提炼':'AI 提炼建议',async()=>{
          message('正在调用 DSH 模型提炼成长建议…');
          const output=await request('/persona-growth',{action:'suggest',id:e.id});
          await growthList();message('模型建议已生成。请先阅读／修改，再决定是否批准。');
        }));
        if(e.source!=='report' && (e.modelSuggestedAt||e.source==='owner-direct'||e.directReview))add(draftActions,btn('保存修改',async()=>{
          if(edit.value.trim().length<((e.source==='owner-direct'||e.directReview)?6:12))throw Error((e.source==='owner-direct'||e.directReview)?'请填写至少 6 字的成长经验':'请填写至少 12 字的建议');
          await request('/persona-growth',{action:'revise',id:e.id,suggestion:edit.value.trim()});
          await growthList();
        }));
        if(e.suggestedText||e.source==='report')add(draftActions,btn(e.source==='report'?'批准该兴趣':(e.source==='owner-direct'||e.directReview)?'批准这条经验':'批准这条建议',async()=>{
          if(e.source!=='report' && edit.value.trim()!==e.suggestedText)throw Error('你修改了审核稿，请先点击「保存修改」，再批准');
          await request('/persona-growth',{action:'approve',id:e.id});await growthList();
        }));
        add(card,draftActions);
      }
      if(e.type==='relationship'){
        const field=node('div','','inset');
        const name=node('input');name.placeholder='人物名称，例如 Claude';name.value=e.personName||'';name.maxLength=48;
        const aliases=node('input');aliases.placeholder='人物别名，用逗号分隔，例如 克劳德, Claude小姐';aliases.value=(e.personAliases||[]).join(', ');aliases.maxLength=600;
        add(field,info('人物名称和别名（仅影响本地检索，不修改已批准正文）'),name,aliases,btn('保存人物索引',async()=>{
          await request('/persona-growth',{action:'person',id:e.id,personName:name.value,personAliases:aliases.value.split(/[,，\n]/).map(x=>x.trim()).filter(Boolean)});
          await growthList();message('人物名称和别名已保存；主题预览和 AI 记忆召回立即生效。');
        }));add(card,field);
      }
      const actions=node('div','','actions');
      if(e.status!=='rejected'&&e.status!=='approved')add(actions,btn('忽略',async()=>{await request('/persona-growth',{action:'reject',id:e.id});await growthList()}));
      add(actions,btn('删除',async()=>{if(e.status==='approved'&&!confirm('这条成长经验已批准并生效，确定删除？'))return;await request('/persona-growth',{action:'delete',id:e.id});await growthList()},'danger'));
      add(card,actions);$('growth-list').appendChild(card);
    }
    if(!entries.length)$('growth-list').append(info('还没有成长经验。'));
    $('growth-context').textContent=(growthPreviewQuery?'【当前主题：'+growthPreviewQuery+'】\n':'【未输入主题：只显示通用经验】\n')+'【视频值班与选片】\n'+(data.contexts?.duty||'（暂无）')+'\n【公开评论互动】\n'+(data.contexts?.comment||'（暂无）')+'\n【私信聊天】\n'+(data.contexts?.dm||'（暂无）')+'\n【相关视频／人物关系】\n'+(data.contexts?.video||'（未输入主题或没有匹配的已批准经历／关系）')+'\n角色关系和视频经历只在主题相关时召回，不会每轮全部注入。';
  };
  $('growth-preview-apply').addEventListener('click',()=>run(async()=>{growthPreviewQuery=$('growth-preview-query').value.trim().slice(0,120);await growthList()}));
  $('growth-preview-reset').addEventListener('click',()=>run(async()=>{growthPreviewQuery='';$('growth-preview-query').value='';await growthList()}));
  $('growth-preview-query').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('growth-preview-apply').click()}});
  $('growth-add').addEventListener('click',()=>run(async()=>{
    const text=$('growth-draft').value.trim();if(text.length<6)throw Error('请输入至少 6 字的反馈');
    const button=$('growth-add');button.disabled=true;
    try {
      const added=await request('/persona-growth',{action:'add',type:$('growth-type').value,text});
      const entry=added.result;
      if(entry.status==='approved'){
        await growthList();message('相同原始反馈已经批准，未重复提交。');return;
      }
      $('growth-draft').value='';
      message('反馈已存档，正在调用 DSH 模型提炼…');
      try {
        await request('/persona-growth',{action:'suggest',id:entry.id});
        await growthList();message('AI 建议已经生成。请审核候选内容，确认后再点击批准。');
      } catch(error) {
        await growthList();
        message('反馈已保存为待审核，但模型提炼失败：'+String(error?.message||error)+'。可以在列表中点击「AI 提炼建议」重试。',true);
      }
    } finally {button.disabled=false}
  }));
  $('growth-add-direct').addEventListener('click',()=>run(async()=>{
    const text=$('growth-draft').value.trim();if(text.length<6)throw Error('请输入至少 6 字的成长经验');
    const button=$('growth-add-direct');button.disabled=true;
    try {
      const added=await request('/persona-growth',{action:'add-direct',type:$('growth-type').value,text});
      if(added.result.status==='approved'){await growthList();message('相同内容已经批准，未重复提交。');return;}
      $('growth-draft').value='';await growthList();message('已直接提交待审核，没有调用 AI。检查内容后即可批准。');
    } finally {button.disabled=false}
  }));
  $('growth-sync').addEventListener('click',()=>run(async()=>{
    const result=await request('/persona-growth',{action:'sync'});await growthList();
    message('日报同步：新增 '+(result.result?.added||0)+' 条观察、'+(result.result?.proposals||0)+' 条长期兴趣候选。这类统计兴趣可直接审核，不会修改搜索词。');
  }));
  $('growth-undo').addEventListener('click',()=>run(async()=>{
    if(!confirm('撤销最近一次成长库修改？'))return;await request('/persona-growth',{action:'undo'});await growthList();
  }));
  $('growth-filter').addEventListener('change',()=>run(growthList));

  const memeList=async()=>{
    const q=$('meme-search').value.trim();const data=await request('/meme-memory?q='+encodeURIComponent(q));$('meme-list').replaceChildren();
    const entries=data.entries||[];const counts=data.counts||{};
    badge('meme-count',counts.pending||0);
    $('meme-stats').textContent='共 '+(data.total||0)+' 条 · 待审核 '+(counts.pending||0)+' · 已批准 '+(counts.approved||0)+' · 已拒绝 '+(counts.rejected||0)+'。新梗先审核；旧梗继续可用。最多显示 50 条，支持搜索。';
    for(const e of entries){
      const card=node('article','','card');
      add(card,pill(e.review_status),node('h3',e.name),info(e.meaning),info('别名：'+(e.aliases||'无')+' · '+e.kind+' · '+e.confidence));
      for(const src of (e.sources||[]).slice(0,2))add(card,info(src.bvid+' · '+src.evidence_type+'：'+src.evidence));
      const actions=node('div','','actions');
      add(actions,btn('编辑',()=>editMeme(card,e)));
      if(e.review_status!=='approved')add(actions,btn('批准',async()=>{await request('/meme-memory/review',{id:e.id,status:'approved'});await memeList()}));
      if(e.review_status!=='rejected')add(actions,btn('拒绝',async()=>{await request('/meme-memory/review',{id:e.id,status:'rejected'});await memeList()}));
      add(actions,btn('删除',async()=>{if(!confirm('永久删除梗「'+e.name+'」及其来源？'))return;await request('/meme-memory/delete',{id:e.id});await memeList()},'danger'));
      add(card,actions);$('meme-list').appendChild(card);
    }
    if(!entries.length)$('meme-list').append(info('没有匹配的梗记录。'));
  };
  const editMeme=(card,e)=>{
    if(card.querySelector('.inset'))return;
    const wrap=node('div','','inset');const fields=node('div','','fields');const values={};
    const input=(key,title,value,max)=>{
      const box=node('div');const label=node('label',title);const item=node('input');item.value=value||'';item.maxLength=max;values[key]=item;add(box,label,item);fields.appendChild(box);
    };
    input('name','梗名称',e.name,48);input('aliases','别名',e.aliases,140);
    input('meaning','解释',e.meaning,220);
    const select=(key,title,current,options)=>{const box=node('div');const label=node('label',title);const s=node('select');for(const o of options){const op=node('option',o);op.value=o;s.appendChild(op)}s.value=current;values[key]=s;add(box,label,s);fields.appendChild(box)};
    select('kind','类型',e.kind,['梗','角色','人物','系列','其他']);select('confidence','可信度',e.confidence,['待核实','有文字依据']);
    const actions=node('div','','actions');
    add(actions,btn('保存修改',async()=>{const payload={id:e.id};for(const [k,v]of Object.entries(values))payload[k]=v.value;await request('/meme-memory/edit',payload);await memeList()}),btn('取消',()=>wrap.remove()));
    add(wrap,fields,info('修改释义不会伪造或删除来源；未审核条目仍须点批准才会供 AI 使用。'),actions);card.appendChild(wrap);
  };
  $('meme-new-save').addEventListener('click',()=>run(async()=>{
    const name=$('meme-new-name').value.trim(),meaning=$('meme-new-meaning').value.trim();
    if(name.length<2||!meaning)throw Error('请填写至少两个字的名称和释义');
    await request('/meme-memory/add',{name,meaning,aliases:$('meme-new-aliases').value.trim(),kind:$('meme-new-kind').value,confidence:$('meme-new-confidence').value});
    $('meme-new-name').value='';$('meme-new-aliases').value='';$('meme-new-meaning').value='';
    await memeList();message('已人工新增并启用梗知识');
  }));
  $('meme-find').addEventListener('click',()=>run(memeList));
  $('meme-search').addEventListener('keydown',e=>{if(e.key==='Enter')run(memeList)});

  // 本地文件库管理：与自动评论使用同一个 comment-memes 目录；前端不持有绝对路径。
  let stickerItems=[];
  let stickerPage=1;
  const STICKERS_PER_PAGE=24;
  const stickerFolder=s=>{const i=s.name.lastIndexOf('/');return i<0?'':s.name.slice(0,i)};
  const stickerDirectories=items=>{
    const directories=new Set();
    for(const item of items){
      const parts=stickerFolder(item).split('/').filter(Boolean);
      for(let i=1;i<=parts.length;i++)directories.add(parts.slice(0,i).join('/'));
    }
    return [...directories].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  };
  const updateStickerFolders=()=>{
    const select=$('sticker-folder-filter');const selected=select.value;
    select.replaceChildren();
    const option=(value,label)=>{const o=node('option',label);o.value=value;select.appendChild(o)};
    option('all','全部文件夹（'+stickerItems.length+'）');
    option('root','根目录 · 未分类（'+stickerItems.filter(s=>!stickerFolder(s)).length+'）');
    for(const dir of stickerDirectories(stickerItems)){
      const count=stickerItems.filter(s=>stickerFolder(s)===dir||stickerFolder(s).startsWith(dir+'/')).length;
      option('folder:'+dir,dir+'（'+count+'）');
    }
    if([...select.options].some(o=>o.value===selected))select.value=selected;
  };
  const renderStickers=()=>{
    const query=$('sticker-search').value.trim().toLowerCase();
    const folder=$('sticker-folder-filter').value;
    const filtered=stickerItems.filter(s=>{
      const dir=stickerFolder(s);
      const inFolder=folder==='all'||(folder==='root'?!dir:folder.startsWith('folder:')&&(dir===folder.slice(7)||dir.startsWith(folder.slice(7)+'/')));
      return inFolder&&s.name.toLowerCase().includes(query);
    });
    const totalPages=Math.max(1,Math.ceil(filtered.length/STICKERS_PER_PAGE));
    stickerPage=Math.min(Math.max(1,stickerPage),totalPages);
    const offset=(stickerPage-1)*STICKERS_PER_PAGE;
    const visible=filtered.slice(offset,offset+STICKERS_PER_PAGE);
    $('sticker-list').replaceChildren();
    for(const s of visible){
      const card=node('article','','card');
      const img=node('img','','sticker-preview');img.loading='lazy';img.alt=s.name;
      img.src=API+'/stickers/file?name='+encodeURIComponent(s.name);
      const name=node('h3',s.name);const desc=info((stickerFolder(s)||'未分类')+' · '+s.ext.toUpperCase()+' · '+Math.ceil(s.bytes/1024)+' KB');
      const actions=node('div','','actions');
      add(actions,btn('重命名',async()=>{
        const name=prompt('请输入新名称（可使用 分类/图片名）',s.name);
        if(name===null||name===s.name)return;
        await request('/stickers?action=rename',{name:s.name,newName:name.trim()});await loadStickers();message('已重命名表情包');
      }),btn('删除',async()=>{
        if(!confirm('确定永久删除表情包「'+s.name+'」？此操作不可撤销。'))return;
        await request('/stickers?action=delete',{name:s.name});await loadStickers();message('已删除表情包');
      },'danger'));
      add(card,img,name,desc,actions);$('sticker-list').appendChild(card);
    }
    if(!filtered.length)$('sticker-list').append(info('这个分类下没有匹配的表情包。'));
    $('sticker-page-status').textContent='第 '+stickerPage+' / '+totalPages+' 页 · 本页 '+visible.length+' 张';
    $('sticker-page-prev').disabled=stickerPage<=1;
    $('sticker-page-next').disabled=stickerPage>=totalPages;
    $('sticker-summary').textContent='图库共 '+stickerItems.length+' 张 · 筛选结果 '+filtered.length+' 张 · 只加载本页图片；底层仍使用 comment-memes 文件夹。';
  };
  const loadStickers=async()=>{const data=await request('/stickers');stickerItems=data.items||[];updateStickerFolders();renderStickers()};
  $('sticker-search').addEventListener('input',()=>{stickerPage=1;renderStickers()});
  $('sticker-folder-filter').addEventListener('change',()=>{stickerPage=1;renderStickers()});
  $('sticker-page-prev').addEventListener('click',()=>{if(stickerPage>1){stickerPage--;renderStickers()}});
  $('sticker-page-next').addEventListener('click',()=>{stickerPage++;renderStickers()});
  $('sticker-reload').addEventListener('click',()=>run(loadStickers));
  $('sticker-file').addEventListener('change',()=>{
    const file=$('sticker-file').files?.[0];if(!file)return;
    if(!$('sticker-name').value.trim())$('sticker-name').value=file.name.replace(/\.[^.]+$/,'').slice(0,48);
  });
  $('sticker-upload').addEventListener('click',()=>run(async()=>{
    const file=$('sticker-file').files?.[0];if(!file)throw Error('请先选择图片');
    if(file.size<=0||file.size>8*1024*1024)throw Error('图片需要小于8MB');
    const ext=(file.name.match(/\.(png|jpe?g|gif|webp)$/i)||[])[0]?.toLowerCase();
    if(!ext)throw Error('仅支持 PNG、JPG、GIF、WebP');
    const category=$('sticker-category').value.trim(),stem=$('sticker-name').value.trim();
    const name=(category?category+'/':'')+stem;if(!stem)throw Error('请填写表情包名称');
    const raw=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(Error('读取图片失败'));reader.readAsDataURL(file);
    });
    const content=raw.split(',')[1]||'';
    const button=$('sticker-upload');button.disabled=true;$('sticker-upload-status').textContent='正在校验并保存…';
    try{
      await request('/stickers?action=upload',{name,ext,data:content});
      $('sticker-file').value='';$('sticker-name').value='';$('sticker-upload-status').textContent='上传成功';
      await loadStickers();message('已上传表情包：'+name);
    }finally{button.disabled=false}
  }));

  const loadDmSettings=async()=>{
    const data=await request('/config');const cfg=data.config||{};
    $('dm-watch').checked=cfg.dmWatch===true;
    $('dm-stranger-enabled').checked=cfg.dmStrangerOnce===true;
    $('dm-whitelist').value=cfg.dmWhitelist||'';

    $('dm-first-fixed').checked=cfg.dmStrangerFirstFixed!==false;
    $('dm-welcome').value=cfg.dmStrangerText||'';
    $('dm-approval-enabled').checked=cfg.dmApprovalEnabled===true;
    $('dm-phrase').value=cfg.dmApprovalPhrase||'白饭🍚';

  };
  const boundedInt=(id,min,max,label)=>{const n=Number($(id).value);if(!Number.isInteger(n)||n<min||n>max)throw Error(label+'必须是 '+min+'–'+max+' 的整数');return n};
  $('dm-settings-save').addEventListener('click',()=>run(async()=>{
    const phrase=$('dm-phrase').value.trim();if(!phrase||phrase.length>60)throw Error('申请暗号不能为空且最多60字');
    const welcome=$('dm-welcome').value;if(welcome.length>450)throw Error('欢迎语最多450字');
    const payload={dmWatch:$('dm-watch').checked,dmStrangerOnce:$('dm-stranger-enabled').checked,
      clear:!welcome.trim()?['dmStrangerText']:[],
      dmStrangerFirstFixed:$('dm-first-fixed').checked,dmStrangerText:welcome,
      dmApprovalEnabled:$('dm-approval-enabled').checked,dmApprovalPhrase:phrase,
      };
    const saved=await request('/config',payload);await loadDmSettings();await loadDmStatus();await dmList();await loadDmWishes();message(saved.host?.ok===false?'配置已保存，但 DSH 设置同步失败：'+(saved.host.error||'未知原因'):'后台私信规则已保存');
  }));
  $('dm-settings-reload').addEventListener('click',()=>run(loadDmSettings));
  const loadDmStatus=async()=>{
    const data=await request('/status');const x=data.dmAutoReplyStatus||{};
    const dmScheduler=data.interactionSchedulerStatus?.checks?.dm||{};
    $('dm-status').textContent=`监听：${x.enabled?'已开启':'关闭'} · 调度：${data.interactionSchedulerStatus?.running?'运行中':'已停止'} · 当前轮询：${dmScheduler.polling?'正在检查':'空闲'} · 上次检查：${pollClock(dmScheduler.lastFinishedAt||x.lastPollAt)} · 下次预计：${dmScheduler.nextAt?pollClock(dmScheduler.nextAt):'未计划'}（各项轮询间隔在「后台轮询」修改）`;
    $('dm-error').textContent=x.lastError?'最近错误：'+x.lastError:'最近一次私信轮询没有记录错误。';
  };
  const identityLink=(uid,nickname)=>{const span=node('span');const name=String(nickname||'').trim();const id=String(uid||'');span.appendChild(node('strong',(name||'昵称未获取')+' · '));const a=node('a','UID '+id);if(/^[1-9]\d{0,18}$/.test(id)){a.href='https://space.bilibili.com/'+id;a.target='_blank';a.rel='noopener noreferrer';}span.appendChild(a);return span};
  const loadDmRecent=async()=>{
    const data=await request('/dm-recent');const list=$('dm-recent-list');list.replaceChildren();
    for(const c of (data.conversations||[])){
      const card=node('article','','record');add(card,identityLink(c.uid,c.nickname));
      const status=[c.approvalStatus?'申请 '+c.approvalStatus:'',c.strangerStatus?'陌生人状态 '+c.strangerStatus:'',c.lastRepliedAt?'最近回复 '+new Date(c.lastRepliedAt).toLocaleString():''].filter(Boolean).join(' · ');
      if(status)add(card,info(status));
      for(const m of (c.recent||[]).slice(-5)){add(card,info((m.role==='assistant'?'大肥鱼：':'对方：')+m.text));}
      if(c.approvalStatus==='approved')add(card,btn('从本地历史补录视频心愿',async()=>{
        if(!confirm('仅扫描这个已获批用户在本地保存的最近私信，补录其中明确提出的视频偏好。将调用 AI 审核新发现的心愿，但不会发送私信。继续？'))return;
        const r=await request('/video-wishes',{action:'backfill',uid:c.uid});
        await loadDmWishes();message(r.created?`已补录 ${r.created} 个主题：${r.topics.join('、')}`:`扫描 ${r.scanned} 条本地消息，暂无新的可识别心愿`);
      }));
      list.appendChild(card);
    }
    if(!list.children.length)list.append(info(data.error||'本地还没有保存过已回复的私信会话。'));
  };
  const loadDmWishes=async()=>{
    const data=await request('/video-wishes');const list=$('dm-wishes-list');list.replaceChildren();
    for(const w of data.wishes||[]){
      const card=node('article','','record');
      add(card,identityLink(w.uid,w.nickname),node('strong',' · '+w.topic+' · '+({active:'已通过',pending_review:'待审核',rejected:'不予满足'}[w.status]||w.status||'未知')),
        info(`审核：${w.reviewReason||'历史心愿'} · 已尝试 ${w.accepted||0} / ${w.limit} 次 · 剩余 ${w.remaining||0} 次 · 有效期至 ${new Date(w.expiresAt).toLocaleDateString()}`));
      const cancelBtn=node('button','移除这条心愿');
      cancelBtn.addEventListener('click',()=>run(async()=>{
        await request('/video-wishes',{action:'cancel',uid:w.uid,id:w.id});await loadDmWishes();message('已移除这条视频心愿');
      }));
      if(['pending_review','rejected'].includes(w.status))add(card,btn('重新 AI 审核',async()=>{const out=await request('/video-wishes',{action:'review',uid:w.uid,id:w.id});await loadDmWishes();message((out.results?.length>1?'同条私信的 '+out.results.length+' 个主题已同步审核：':'')+(out.status==='active'?'审核通过，心愿已启用':'审核结果：'+String(out.reason||out.status||'待审核')));}));
      add(card,cancelBtn);list.appendChild(card);
    }
    if(!list.children.length)list.append(info('暂无有效的临时视频心愿。'));
  };
  $('dm-wishes-refresh').addEventListener('click',()=>run(loadDmWishes));
  const loadDmAll=async()=>{await Promise.all([loadDmSettings(),loadDmStatus(),dmList(),loadDmRecent(),loadDmWishes()])};
  $('dm-network-test').addEventListener('click',()=>run(async()=>{
    $('dm-error').textContent='正在只读测试 api.vc.bilibili.com，会话不会被回复…';
    try {
      const result=await request('/dm-network-check',{});
      $('dm-error').textContent=`连接成功：${result.host} · ${result.sessionCount} 个会话 · ${result.elapsedMs} ms · ${result.checkedAt}`;
      await loadDmStatus();
    } catch(e) {
      $('dm-error').textContent='连接测试失败：'+String(e?.message||e);
      throw e;
    }
  }));
  $('dm-refresh').addEventListener('click',()=>run(loadDmAll));
  $('dm-recent-reload').addEventListener('click',()=>run(loadDmRecent));

  const loadCommentSettings=async()=>{
    const data=await request('/config');const c=data.config||{};
    $('comment-watch-replies').checked=c.commentWatchReplies===true;
    $('comment-watch-top').checked=c.commentWatchTop===true;
    $('comment-at-enabled').checked=c.commentAtEnabled===true;
    $('comment-at-mode').value=c.commentAtMode==='all'?'all':'whitelist';
    $('comment-at-whitelist').value=String(c.commentAtWhitelist||'');
    $('comment-allow-general-top').checked=c.commentAllowGeneralTop===true;

  };
  let commentsOffset=0,commentsTotal=0;
  const loadRecentComments=async()=>{
    const limit=Number($('comments-limit').value)||50;
    const day=$('comments-day').value||'';
    const kind=$('comments-kind').value;
    const query=new URLSearchParams({limit:String(limit),offset:String(commentsOffset)});
    if(day)query.set('day',day);
    if(kind==='top'||kind==='reply')query.set('kind',kind);
    const data=await request('/recent-comments?'+query.toString());
    commentsTotal=Number(data.total)||0;
    const list=$('recent-comments-list');list.replaceChildren();
    const counts=data.counts||{};
    $('comments-summary').textContent=(day?day+' · ':'全部日期 · ')+`主评论 ${counts.top??0} 条 · 回复别人评论 ${counts.reply??0} 条 · 当前分类 ${commentsTotal} 条`+
      (counts.withoutId?` · 当前分类中 ${counts.withoutId} 条没有评论 ID`:'')+'。含一次性补录的旧成功回执；这里不代表 B站 已公开可见。';
    for(const c of (data.rows||[])){
      const card=node('article','','record');const top=node('div');
      add(top,safeCommentLink(c));
      if(c.kind==='reply'){
        top.appendChild(node('span',' · 对方：'));
        const uid=/^[1-9]\d{0,19}$/.test(String(c.recipientUid||''))?String(c.recipientUid):'';
        const nickname=String(c.recipientName||'').trim();
        const spaceLink=()=>{const a=node('a');a.href='https://space.bilibili.com/'+uid;a.target='_blank';a.rel='noopener noreferrer';return a};
        if(uid){
          const name=spaceLink();name.textContent=nickname||'昵称未记录';name.title='进入对方 B站主页';top.appendChild(name);
          top.appendChild(node('span','（'));
          const idLink=spaceLink();idLink.textContent='UID '+uid;idLink.title='进入对方 B站主页';top.appendChild(idLink);
          top.appendChild(node('span','）'));
        }else{top.appendChild(node('span',nickname?nickname+'（UID 未记录）':'昵称及 UID 未记录'));}
      }else top.appendChild(node('span',' · 原创主评论'));
      add(card,top,info((c.time||'时间未记录')+' · '+(c.snippet||'（没有保存正文摘要）')),
        ...(c.kind==='reply'?[(()=>{const d=node('details');const summary=node('summary','预览对方上一条评论');d.appendChild(summary);d.appendChild(info(c.recipientComment||'旧记录未保存对方原评论'));return d})()]:[]),
        info('来源：'+(c.source||'本地记录')+' · 公开状态未核实'));
      list.appendChild(card);
    }
    if(!list.children.length)list.append(info(day?'这一天没有找到本地评论记录。':data.note||'暂时没有记录。'));
    $('comments-prev').disabled=commentsOffset===0;
    $('comments-next').disabled=commentsOffset+limit>=commentsTotal;
    $('comments-page-info').textContent=commentsTotal?`${commentsOffset+1}–${Math.min(commentsOffset+limit,commentsTotal)} / ${commentsTotal}`:'0 条';
  };
  const loadCommentsStatus=async()=>{
    const data=await request('/status');const c=data.commentInteractStatus||{};
    $('comments-status').textContent=`后台评论互动：${c.busy?'正在运行':'空闲'} · 上次检查：${c.lastPollAt?new Date(c.lastPollAt).toLocaleString():'暂无'}${c.lastError?' · 错误：'+c.lastError:''}`;
    $('comments-usage').textContent=`近24小时后台回复成功回执：${c.sentLast24Hours??0} / ${c.replyPerDay??5} 条。我的主评论下：${c.sentOnOwnTop24h??0}；我的楼中楼回复下：${c.sentOnOwnNested24h??0}。这是后台互动自己的滚动24小时上限，不是全局每日额度。`;
    $('comments-send-stats').textContent=`近24小时后台发送记录：成功回执 ${c.sentLast24Hours??0} · 明确失败 ${c.sendFailedLast24Hours??0} · 结果不确定 ${c.sendUncertainLast24Hours??0} · 全局额度／配额安全拦截 ${c.sendBlockedByGlobalQuotaLast24Hours??0} · 其他拦截 ${c.sendBlockedOtherLast24Hours??0} · 中断后待核实 ${c.sendPendingLast24Hours??0}。`;
    const historyStarted=c.sendAttemptHistoryStartedAt?new Date(c.sendAttemptHistoryStartedAt).toLocaleString():'';
    const quotaPauseNote=c.globalQuotaBlocked
      ? (c.globalQuotaBlockReason==='store-error'?'公开评论额度账本暂不可用：后台暂停5分钟后重试，避免每轮重复撞错误。':'全局额度已耗尽：本轮停止继续生成／发送，避免每次后台轮询重复撞额度；新自然日或修改全局上限后会重新检查。')
      : '发送结果分类已启用。';
    $('comments-history-note').textContent=c.sendAttemptHistoryAvailable
      ? `${quotaPauseNote}${historyStarted?' 发送结果分类从 '+historyStarted+' 开始记录；此前的历史失败数无法追溯。':''} “成功回执”仍不代表 B 站当前公开可见。`
      : '旧版本没有保存完整的发送失败时间线；升级后开始记录新发送的成功、失败、额度拦截和中断待核实状态。旧历史失败数无法追溯。';
  };
  const loadCommentGlobalQuota=async()=>{
    const target=$('global-comment-quota'),note=$('global-comment-quota-note');
    try{
      const q=await request('/comment-quota');
      if(q.ok!==true)throw Error(q.error||'读取失败');
      const used=Math.max(0,Number(q.used)||0),limit=Math.max(0,Number(q.limit)||0),day=String(q.day||localDay());
      if(limit===0)target.textContent=`${day} · 全局公开评论已禁用（上限为 0）· 本地账本仍记录 ${used} 次历史发送尝试。`;
      else target.textContent=`${day} · 今日已占用 ${used} / ${limit} 次 · 剩余 ${Math.max(0,limit-used)} 次。`;
      note.textContent='自然日硬上限：主动发表的公开主评论 + 后台楼中楼／评论回复共用；以即将调用 B 站发布接口的发送尝试计数。失败或结果不确定的真实发布尝试也会占用名额。旧版本当天记录可能包含发送前校验失败的占位，升级后新记录已调整为临近发布接口时才占位。';
    }catch(e){
      target.textContent='今日全局额度暂不可读取：'+String(e?.message||e).slice(0,140);
      note.textContent='无法读取时不要根据后台回复的 55/100 推断全局额度；两套计数相互独立。';
    }
  };
  const loadCommentsAll=async()=>{await Promise.all([loadCommentSettings(),loadRecentComments(),loadCommentsStatus(),loadCommentGlobalQuota()])};
  $('comments-settings-save').addEventListener('click',()=>run(async()=>{
    const payload={commentWatchReplies:$('comment-watch-replies').checked,commentWatchTop:$('comment-watch-top').checked,
      commentAtEnabled:$('comment-at-enabled').checked,commentAtMode:$('comment-at-mode').value,
      commentAllowGeneralTop:$('comment-allow-general-top').checked,
};
    const saved=await request('/config',payload);await loadCommentsAll();message(saved.host?.ok===false?'评论设置已保存，但 DSH 设置同步失败：'+(saved.host.error||'未知原因'):'后台评论互动设置已保存');
  }));
  $('comments-load').addEventListener('click',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-day').addEventListener('change',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-day-clear').addEventListener('click',()=>run(()=>{$('comments-day').value='';commentsOffset=0;return loadRecentComments()}));
  $('comments-kind').addEventListener('change',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-prev').addEventListener('click',()=>run(()=>{commentsOffset=Math.max(0,commentsOffset-(Number($('comments-limit').value)||50));return loadRecentComments()}));
  $('comments-next').addEventListener('click',()=>run(()=>{commentsOffset+=Number($('comments-limit').value)||50;return loadRecentComments()}));
  $('comments-refresh').addEventListener('click',()=>run(loadCommentsAll));

  const dmList=async()=>{
    const data=await request('/dm-approvals');const entries=data.approvals||[];$('dm-list').replaceChildren();
    badge('dm-count',entries.filter(x=>x.status==='pending').length);
    const f=$('dm-filter').value;
    for(const e of entries.filter(x=>!f||x.status===f)){
      const card=node('article','','card');add(card,pill(e.status),identityLink(e.uid,e.nickname),info('申请消息：'+(e.lastText||'（无）')),
        info('已获批累计回复 '+(e.total||0)+' 条 · 今日 '+(e.daily||0)+' 条'));
      const resumeInfo={queued:'已通过：下次后台私信轮询将自动接话，无需对方再发送消息',reserved:'自动回复发送中／等待确认',sent:'已自动回复'+(e.autoReplyAt?' · '+new Date(e.autoReplyAt).toLocaleString():''),
        uncertain:'发送回执不确定：为防重复发送已暂停自动重试，请检查 B站私信',cancelled:'自动回复已取消'};
      if(e.autoReplyStatus) add(card,info(resumeInfo[e.autoReplyStatus]||'自动回复状态：'+e.autoReplyStatus));
      const actions=node('div','','actions');
      if(e.status==='pending')add(actions,btn('批准聊天',async()=>{if(!confirm('确认授权 UID '+e.uid+' 在设置限额内继续聊天？'))return;await request('/dm-approvals',{uid:e.uid,action:'approve'});await dmList()}),
        btn('拒绝',async()=>{await request('/dm-approvals',{uid:e.uid,action:'reject'});await dmList()}));
      if(e.canResume)
        add(actions,btn('补发首次回复（旧版）',async()=>{if(!confirm('仅适用于旧版批准后没有自动回复的申请。请先确认没有在 B站 手动回复过该用户，避免重复私信。继续？'))return;
          await request('/dm-approvals',{uid:e.uid,action:'resume'});await dmList()}));
      if(e.status==='approved')add(actions,btn('撤销授权',async()=>{if(!confirm('撤销 '+e.uid+' 的限额聊天权限？'))return;await request('/dm-approvals',{uid:e.uid,action:'revoke'});await dmList()},'danger'));
      add(card,actions);$('dm-list').appendChild(card);
    }
    if(!$('dm-list').children.length)$('dm-list').append(info('当前没有符合条件的聊天申请。'));
  };
  $('dm-filter').addEventListener('change',()=>run(dmList));
  const loaders={diagnostics:loadDiagnostics,reports:loadReport,quotas:loadQuotas,polling:loadPolling,persona:loadPersona,dm:loadDmAll,comments:loadCommentsAll,growth:growthList,meme:memeList,stickers:loadStickers};
  run(async()=>{switchTab('persona')});
})();
