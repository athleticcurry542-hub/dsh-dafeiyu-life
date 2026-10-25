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
  const run=async(fn)=>{try{await fn();message('操作已完成')}catch(e){message(e?.message||'操作失败',true)}};
  const message=(m,bad=false)=>{const e=$('message');e.textContent=String(m||'');e.style.color=bad?'var(--bad)':'var(--action)'};
  const request=async(path,body)=>{
    const res=await fetch(API+path,body===undefined?{credentials:'same-origin'}:{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let data;try{data=await res.json()}catch{throw Error('服务器未返回 JSON（HTTP '+res.status+'）')}
    if(!res.ok||!data?.ok)throw Error(String(data?.error||'请求失败').slice(0,180));
    return data;
  };
  const badge=(id,n)=>{const e=$(id);e.hidden=!n;e.textContent=String(n)};
  let active='growth';
  const refresh=()=>loaders[active]();
  const switchTab=tab=>{
    active=tab; for(const t of ['growth','meme','dm']){$('panel-'+t).hidden=t!==tab;document.querySelector(`[data-tab="${t}"]`).setAttribute('aria-selected',String(t===tab))}
    message('');run(refresh);
  };
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  $('refresh').addEventListener('click',()=>run(refresh));

  const growthList=async()=>{
    const data=await request('/persona-growth');$('growth-list').replaceChildren();
    const entries=data.data?.entries||[];
    badge('growth-count',entries.filter(e=>e.status==='pending').length);
    const filter=$('growth-filter').value;
    for(const e of entries.filter(e=>!filter||e.status===filter)){
      const card=node('article','','card');
      add(card,pill(e.status),pill(e.type),info(e.text),info('来源：'+(e.source==='owner'?'主人反馈':'日报')+(e.evidence?' · '+e.evidence:'')));
      const actions=node('div','','actions');
      if(e.status!=='approved')add(actions,btn('批准',async()=>{await request('/persona-growth',{action:'approve',id:e.id});await growthList()}));
      if(e.status!=='rejected')add(actions,btn('忽略',async()=>{await request('/persona-growth',{action:'reject',id:e.id});await growthList()}));
      add(actions,btn('删除',async()=>{if(!confirm('删除这条成长经验？'))return;await request('/persona-growth',{action:'delete',id:e.id});await growthList()},'danger'));
      add(card,actions);$('growth-list').appendChild(card);
    }
    if(!entries.length)$('growth-list').append(info('还没有成长经验。'));
    $('growth-context').textContent=data.context||'尚无已批准经验。';
  };
  $('growth-add').addEventListener('click',()=>run(async()=>{
    const text=$('growth-draft').value.trim();if(text.length<6)throw Error('请输入至少 6 字的反馈');
    await request('/persona-growth',{action:'add',type:$('growth-type').value,text});$('growth-draft').value='';await growthList();
  }));
  $('growth-sync').addEventListener('click',()=>run(async()=>{
    const result=await request('/persona-growth',{action:'sync'});await growthList();
    message('日报同步：新增 '+(result.result?.added||0)+' 条观察、'+(result.result?.proposals||0)+' 条候选');
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
  $('meme-find').addEventListener('click',()=>run(memeList));
  $('meme-search').addEventListener('keydown',e=>{if(e.key==='Enter')run(memeList)});

  const loadDmSettings=async()=>{
    const data=await request('/config');const cfg=data.config||{};
    $('dm-enable').checked=cfg.dmApprovalEnabled===true;
    $('dm-phrase').value=cfg.dmApprovalPhrase||'白饭🍚';
    $('dm-total').value=String(cfg.dmApprovedTotalLimit??50);
    $('dm-daily').value=String(cfg.dmApprovedDailyLimit??10);
  };
  $('dm-settings-save').addEventListener('click',()=>run(async()=>{
    const phrase=$('dm-phrase').value.trim();
    const total=Number($('dm-total').value), daily=Number($('dm-daily').value);
    if(!phrase||phrase.length>60||!/^(?:[1-9]\d*)$/.test(String(total))||total>10000||!/^(?:[1-9]\d*)$/.test(String(daily))||daily>1000)
      throw Error('暗号不能为空；累计额度应为1–10000，日额度应为1–1000的整数');
    await request('/config',{dmApprovalEnabled:$('dm-enable').checked,dmApprovalPhrase:phrase,
      dmApprovedTotalLimit:total,dmApprovedDailyLimit:daily});
    await loadDmSettings();message('限额聊天规则已保存');
  }));
  $('dm-settings-reload').addEventListener('click',()=>run(loadDmSettings));

  const dmList=async()=>{
    const data=await request('/dm-approvals');const entries=data.approvals||[];$('dm-list').replaceChildren();
    badge('dm-count',entries.filter(x=>x.status==='pending').length);
    const f=$('dm-filter').value;
    for(const e of entries.filter(x=>!f||x.status===f)){
      const card=node('article','','card');add(card,pill(e.status),node('h3','UID '+e.uid),info('申请消息：'+(e.lastText||'（无）')),
        info('已获批累计回复 '+(e.total||0)+' 条 · 今日 '+(e.daily||0)+' 条'));
      const actions=node('div','','actions');
      if(e.status==='pending')add(actions,btn('批准聊天',async()=>{if(!confirm('确认授权 UID '+e.uid+' 在设置限额内继续聊天？'))return;await request('/dm-approvals',{uid:e.uid,action:'approve'});await dmList()}),
        btn('拒绝',async()=>{await request('/dm-approvals',{uid:e.uid,action:'reject'});await dmList()}));
      if(e.status==='approved')add(actions,btn('撤销授权',async()=>{if(!confirm('撤销 '+e.uid+' 的限额聊天权限？'))return;await request('/dm-approvals',{uid:e.uid,action:'revoke'});await dmList()},'danger'));
      add(card,actions);$('dm-list').appendChild(card);
    }
    if(!$('dm-list').children.length)$('dm-list').append(info('当前没有符合条件的聊天申请。'));
  };
  $('dm-filter').addEventListener('change',()=>run(dmList));
  const loaders={growth:growthList,meme:memeList,dm:async()=>{await loadDmSettings();await dmList()}};
  run(async()=>{await Promise.all([growthList(),memeList(),dmList(),loadDmSettings()]);switchTab('growth')});
})();
