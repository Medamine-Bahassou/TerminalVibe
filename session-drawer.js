// Tool history is a contextual drawer; workspaces, tabs and splits stay primary.
(function () {
  let closeCurrent, currentHost;
  const viewStates = new WeakMap();
  window.openSessionDrawer = async function ({ host, trigger, title = 'Claude sessions', cwd, project, currentId, load, start, canReplace, initialData }) {
    if (!host?.isConnected) throw new Error('The terminal pane is no longer available');
    if (closeCurrent && currentHost === host) { closeCurrent(); return; }
    if (closeCurrent?.() === false) return;
    let views = viewStates.get(host);
    if(!views) {views = new Map();viewStates.set(host,views);}
    const viewKey = project || cwd || title;
    let view = views.get(viewKey);
    if(!view) {view = {query:'',scrollTop:0,expanded:new Map(),showAll:new Set()};views.set(viewKey,view);}
    const previous = document.activeElement;
    const overlay = document.createElement('div'); overlay.className = 'session-overlay';
    const drawer = document.createElement('section'); drawer.className = 'session-drawer';
    drawer.setAttribute('role','dialog'); drawer.setAttribute('aria-label',title);
    const el = (tag, cls, text) => { const n=document.createElement(tag); n.className=cls; if(text) n.textContent=text; return n; };
    const button = (text, fn, cls='') => { const b=el('button',cls,text); b.type='button'; b.onclick=fn; return b; };
    const head=el('header','session-head');
    const titles=el('div','session-titles'); titles.append(el('h2','',title));
    if(cwd) {const sub=el('div','session-sub',cwd); sub.title=cwd; titles.append(sub);}
    const refresh=button('',()=>fetchHistory(true),'session-refresh');refresh.innerHTML='<i class="ph ph-arrow-clockwise"></i>';refresh.title='Refresh conversations';refresh.setAttribute('aria-label','Refresh conversations');
    const close=button('',()=>dismiss(),'session-close'); close.innerHTML='<i class="ph ph-x"></i>'; close.setAttribute('aria-label','Close session history'); head.append(titles,refresh,close);
    const tools=el('div','session-tools');
    const search=el('input','session-search'); search.placeholder='Search conversations…'; search.setAttribute('aria-label','Search conversations');
    search.disabled=true;search.value=view.query;
    const fresh=button('',()=>run(null,'here'),'session-primary'); fresh.innerHTML='<i class="ph ph-plus"></i><span>New session</span>'; fresh.setAttribute('aria-label','New conversation');
    fresh.disabled=true;
    const searchWrap=el('div','session-search-wrap');
    const icon=el('i','session-search-icon ph ph-magnifying-glass'); icon.setAttribute('aria-hidden','true');
    const hint=el('kbd','session-search-hint','Ctrl F');
    searchWrap.append(icon,search,hint); tools.append(searchWrap,fresh);
    const status=el('div','session-status','Loading local conversations…'); status.setAttribute('role','status');
    const list=el('div','session-list'); list.setAttribute('aria-label','Conversations');
    drawer.append(head,tools,status,list); overlay.append(drawer); host.append(overlay);
    // Terminal body handlers otherwise send focus back to xterm after a click.
    overlay.addEventListener('mousedown', e => e.stopPropagation());
    overlay.addEventListener('click', e => e.stopPropagation());
    // Drawer content must never open the underlying terminal's actions.
    overlay.addEventListener('contextmenu', e => {
      e.stopPropagation();
      if (!e.target.closest('input,textarea')) e.preventDefault();
    });
    let closed=false, busy=false, sessions=[], replace=false, capped=false, draggedUntil=0;
    let hasData=false, loading=false, dataSignature=null;
    let menu=null, menuTrigger=null;
    function closeMenu(restore=true) {
      if(!menu) return;
      const focused=menu.contains(document.activeElement);
      menu.remove();menu=null;
      if(restore && focused && menuTrigger?.isConnected) menuTrigger.focus({preventScroll:true});
      menuTrigger=null;
    }
    function sessionMenu(e, session, row) {
      e.preventDefault();e.stopPropagation();closeMenu(false);
      if(closed || busy) return;
      menuTrigger=row;
      menu=el('div','session-context-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label','Conversation actions');
      const copy=async text=>{
        try {
          if(window.electronAPI?.clipboardWrite) await window.electronAPI.clipboardWrite(text);
          else await navigator.clipboard.writeText(text);
        } catch(error) {if(!closed) status.textContent='Could not copy: '+error.message;}
      };
      const action=(label,icon,fn,disabled=false)=>{
        const b=button('',()=>{closeMenu();if(!closed && !busy) fn();},'session-menu-item');
        b.setAttribute('role','menuitem');b.disabled=disabled;
        const i=el('i','ph '+icon);i.setAttribute('aria-hidden','true');
        b.append(i,el('span','',label));menu.append(b);
      };
      const unavailable=session.cwd===null || session.id===currentId;
      action('Resume here','ph-play',()=>run(session,'here'),unavailable || !replace);
      action('Open in new split','ph-columns',()=>run(session,'split'),unavailable);
      const sep=el('div','session-menu-separator');sep.setAttribute('role','separator');menu.append(sep);
      action('Copy session ID','ph-copy',()=>copy(session.id));
      action('Copy project path','ph-folder',()=>copy(session.cwd),!session.cwd);
      menu.addEventListener('mousedown',e=>e.stopPropagation());
      menu.addEventListener('click',e=>e.stopPropagation());
      menu.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();});
      menu.addEventListener('keydown',e=>{
        e.stopPropagation();
        if(e.key==='Escape' || e.key==='Tab') {if(e.key==='Escape') e.preventDefault();closeMenu();return;}
        if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return;
        e.preventDefault();
        const items=[...menu.querySelectorAll('button:not(:disabled)')],current=items.indexOf(document.activeElement);
        const index=e.key==='Home'?0:e.key==='End'?items.length-1:(current+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
        items[index]?.focus();
      });
      document.body.append(menu);
      const rect=row.getBoundingClientRect();
      const x=e.clientX ?? rect.left, y=e.clientY ?? rect.bottom;
      menu.style.left=Math.max(4,Math.min(x,window.innerWidth-menu.offsetWidth-4))+'px';
      menu.style.top=Math.max(4,Math.min(y,window.innerHeight-menu.offsetHeight-4))+'px';
      menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
    }
    overlay.addEventListener('mousedown',e=>{if(!e.target.closest('.session-row')) closeMenu();});
    list.addEventListener('scroll',()=>closeMenu(),true);
    function dismiss(force=false) {
      if(closed) return true;
      if(busy && !force) return false;
      const restoreFocus=overlay.contains(document.activeElement) || menu?.contains(document.activeElement);
      closeMenu(false);
      view.query=search.value;if(list.childElementCount) view.scrollTop=list.scrollTop;
      if(!search.value.trim()) list.querySelectorAll('.session-group').forEach(group=>view.expanded.set(group.dataset.project,group.open));
      closed=true; observer.disconnect();
      overlay.inert=true;
      overlay.classList.add('closing');
      const duration=parseFloat(getComputedStyle(drawer).transitionDuration)*1000;
      if(!force && duration>0) {
        const finish=()=>{clearTimeout(timer);overlay.remove();};
        const timer=setTimeout(finish,duration+50);
        drawer.addEventListener('transitionend',e=>{if(e.target===drawer && e.propertyName==='transform') finish();});
      } else overlay.remove();
      document.removeEventListener('session-context:attached',contextAttached);
      document.removeEventListener('mousedown',outsideClick,true);
      if(closeCurrent===dismiss) {closeCurrent=null;currentHost=null;}
      if(restoreFocus && previous?.isConnected) previous.focus();
      return true;
    }
    const observer=new MutationObserver(()=>{if(!host.isConnected) dismiss(true);});
    observer.observe(document.body,{childList:true,subtree:true});
    closeCurrent=dismiss;currentHost=host;
    function contextAttached(e) {if(e.detail?.error) status.textContent=e.detail.error;else dismiss();}
    document.addEventListener('session-context:attached',contextAttached);
    function outsideClick(e) {
      if(menu?.contains(e.target)) return;
      closeMenu();
      if(!overlay.contains(e.target) && !trigger?.contains(e.target)) dismiss();
    }
    document.addEventListener('mousedown',outsideClick,true);
    overlay.onclick=e=>{if(e.target===overlay) dismiss();};
    function keys(e) {
      e.stopPropagation();
      if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='f') {e.preventDefault();search.focus();search.select();}
      if(e.key==='Escape') {e.preventDefault();e.stopPropagation();dismiss();}
    }
    overlay.addEventListener('keydown',keys); close.focus();
    const TEMP=/^(\/tmp\/|\/var\/(folders|tmp)\/|\/private\/var\/)|[\\/](scratch|temp)[\\/]/i;
    const base=p=>p.split(/[\\/]/).filter(Boolean).pop()||p;
    const ago=t=>{const m=(Date.now()-new Date(t))/6e4;
      if(m<1) return 'now'; if(m<60) return `${m|0}m`; if(m<1440) return `${m/60|0}h`; if(m<10080) return `${m/1440|0}d`;
      return new Date(t).toLocaleDateString([],{month:'short',day:'numeric'});};
    const PAGE=5, expanded=view.expanded, showAll=view.showAll;
    function renderRow(s) {
      const row=button('',()=>{if(Date.now()>draggedUntil) run(s,'here');},'session-row');
      row.dataset.sessionId=s.id;
      row.dataset.resumeAllowed=String(s.id!==currentId && s.cwd!==null);
      row.setAttribute('aria-disabled',String(!replace || s.id===currentId || s.cwd===null));
      row.addEventListener('contextmenu',e=>sessionMenu(e,s,row));
      row.addEventListener('keydown',e=>{
        if(e.key==='ContextMenu' || (e.shiftKey && e.key==='F10')) {
          const rect=row.getBoundingClientRect();
          sessionMenu({preventDefault:()=>e.preventDefault(),stopPropagation:()=>e.stopPropagation(),clientX:rect.left,clientY:rect.bottom},s,row);
        }
      });
      row.draggable=true;
      row.addEventListener('dragstart',e=>{
        if(busy) {e.preventDefault();return;}
        e.stopPropagation();
        e.dataTransfer.setData('application/x-terminalvibe-session',s.id);
        e.dataTransfer.effectAllowed='copy';
        overlay.classList.add('session-dragging');draggedUntil=Date.now()+1000;
      });
      row.addEventListener('dragend',()=>{
        overlay.classList.remove('session-dragging');draggedUntil=Date.now()+500;
        document.querySelectorAll('.session-context-drop-effect').forEach(n=>n.remove());
      });
      const untitled=!s.title || /^untitled/i.test(s.title);
      const t=el('span','session-row-title'+(untitled?' untitled':''),s.title||'Untitled conversation');
      row.append(t,el('span','session-row-meta',ago(s.updatedAt)));
      if(s.id===currentId) {row.setAttribute('aria-current','true');row.append(el('span','session-current','Current'));}
      row.title=`${s.title||''}\n${new Date(s.updatedAt).toLocaleString()}\n${s.id===currentId?'Current session':!replace?'Resume unavailable in this terminal':'Click to resume'} · drag into Claude to attach or onto the tab bar to open`;
      return row;
    }
    function renderList() {
      closeMenu(false);
      const scrollTop=list.childElementCount?list.scrollTop:view.scrollTop;
      const focusedId=list.contains(document.activeElement)?document.activeElement.closest('.session-row')?.dataset.sessionId:null;
      list.replaceChildren();
      const query=search.value.trim().toLowerCase();
      const filtered=sessions.filter(s=>((s.title||'') + ' ' + (s.cwd || '')).toLowerCase().includes(query));
      status.textContent=`${filtered.length}${capped?' recent':''} conversation${filtered.length===1?'':'s'} · drag to attach or open a tab`;
      // Projects by recency; this terminal's project first; unknown and throwaway temp/scratch dirs last.
      const groups=new Map(), rank=k=>k===project?0:k==='\0temp'?3:k===''?2:1;
      for(const s of filtered) {const k=s.cwd&&TEMP.test(s.cwd)&&s.cwd!==project?'\0temp':s.cwd||'';if(!groups.has(k)) groups.set(k,[]);groups.get(k).push(s);}
      const ordered=[...groups].sort((a,b)=>rank(a[0])-rank(b[0]));
      ordered.forEach(([k,items],i)=>{
        const group=el('details','session-group');group.dataset.project=k;
        // Searching opens every match; otherwise only this project (or the most recent one) starts open.
        group.open=query?true:expanded.has(k)?expanded.get(k):k===project||(i===0&&rank(k)===1&&!groups.has(project));
        group.ontoggle=()=>{if(!closed && !query && group.isConnected) expanded.set(k,group.open);};
        const summary=el('summary','session-group-head');
        const name=k==='\0temp'?'Scratch & temp':k?base(k):'Other';
        summary.title=k==='\0temp'?'Temporary and scratch folders':k||'Unknown project';
        summary.append(el('span','session-group-name',name));
        if(k===project) summary.append(el('span','session-group-tag','this folder'));
        summary.append(el('span','session-group-count',String(items.length)));
        group.append(summary);list.append(group);
        const all=query||showAll.has(k), shown=all?items:items.slice(0,PAGE);
        for(const s of shown) group.append(renderRow(s));
        if(!all && items.length>PAGE) group.append(button(`Show ${items.length-PAGE} more`,()=>{showAll.add(k);renderList();},'session-more'));
      });
      if(!filtered.length) list.append(el('p','session-empty',sessions.length?'No matching conversations.':'No saved Claude Code conversations found.'));
      list.scrollTop=scrollTop;
      if(focusedId) [...list.querySelectorAll('.session-row')].find(row=>row.dataset.sessionId===focusedId)?.focus({preventScroll:true});
    }
    async function run(session, mode) {
      if(closed || busy || (!replace && mode==='here') || session?.cwd===null || (session && session.id===currentId)) return; closeMenu(false); busy=true; drawer.setAttribute('aria-busy','true');
      drawer.querySelectorAll('button,input').forEach(n=>n.disabled=true);
      status.textContent='Starting Claude…';
      try {await start(session,mode);busy=false;dismiss();}
      catch(e) {busy=false;drawer.removeAttribute('aria-busy');fresh.disabled=!replace;search.disabled=false;close.disabled=false;refresh.disabled=loading;renderList();status.textContent=e.message;search.focus();}
    }
    function syncResumeState() {
      fresh.disabled=busy || !hasData || !replace;
      fresh.title=replace?'Start Claude in this terminal split':'This terminal is running another process or its state is unknown.';
      list.querySelectorAll('.session-row').forEach(row=>row.setAttribute('aria-disabled',String(!replace || row.dataset.resumeAllowed!=='true')));
    }
    function applyHistory(result) {
      if(!Array.isArray(result?.sessions)) throw new Error('Invalid session history response');
      const signature=JSON.stringify([result.limit,result.sessions.map(s=>[s.id,s.title,s.cwd,s.updatedAt])]);
      sessions=result.sessions;capped=!!result.limit && sessions.length>=result.limit;hasData=true;
      search.disabled=false;syncResumeState();
      if(signature!==dataSignature) {dataSignature=signature;renderList();}
    }
    async function fetchHistory(force=false) {
      if(loading || closed || busy) return;
      loading=true;refresh.disabled=true;list.setAttribute('aria-busy','true');
      if(!hasData) status.textContent='Loading local conversations…';
      try {
        const result=await load(force);
        if(closed) return;
        // Never disrupt an active drag, menu, or resume; the next open uses
        // the refreshed cache if a response arrives during one of those actions.
        if(busy || menu || overlay.classList.contains('session-dragging')) return;
        applyHistory(result);refresh.title='Refresh conversations';
        if(document.activeElement===close) search.focus({preventScroll:true});
      } catch(error) {
        if(!closed) {
          if(hasData) refresh.title='Could not refresh conversations. Showing previous chats; click to retry.';
          else {status.textContent=error.message;fresh.disabled=true;search.disabled=true;}
        }
      } finally {
        if(!closed) {loading=false;refresh.disabled=busy;list.setAttribute('aria-busy','false');}
      }
    }
    search.oninput=()=>{view.query=search.value;view.scrollTop=0;list.scrollTop=0;renderList();};
    if(initialData) {try {applyHistory(initialData);}catch {}}
    const permission=Promise.resolve().then(canReplace).then(idle=>{
      if(!closed) {replace=!!idle;syncResumeState();}
    },()=>{if(!closed) {replace=false;syncResumeState();}});
    await Promise.all([fetchHistory(),permission]);
  };
})();
