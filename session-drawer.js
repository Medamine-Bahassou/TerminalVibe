// Tool history is a contextual drawer; workspaces, tabs and splits stay primary.
(function () {
  let closeCurrent;
  window.openSessionDrawer = async function ({ host, title = 'Claude sessions', cwd, project, currentId, load, start, canReplace }) {
    if (!host?.isConnected) throw new Error('The terminal pane is no longer available');
    if (closeCurrent?.() === false) return;
    const previous = document.activeElement;
    const overlay = document.createElement('div'); overlay.className = 'session-overlay';
    const drawer = document.createElement('section'); drawer.className = 'session-drawer';
    drawer.setAttribute('role','dialog'); drawer.setAttribute('aria-label',title);
    const el = (tag, cls, text) => { const n=document.createElement(tag); n.className=cls; if(text) n.textContent=text; return n; };
    const button = (text, fn, cls='') => { const b=el('button',cls,text); b.type='button'; b.onclick=fn; return b; };
    const head=el('header','session-head');
    const titles=el('div','session-titles'); titles.append(el('h2','',title));
    if(cwd) {const sub=el('div','session-sub',cwd); sub.title=cwd; titles.append(sub);}
    const close=button('×',()=>dismiss(),'session-close'); close.setAttribute('aria-label','Close session history'); head.append(titles,close);
    const tools=el('div','session-tools');
    const search=el('input','session-search'); search.placeholder='Search conversations…'; search.setAttribute('aria-label','Search conversations');
    search.disabled=true;
    const fresh=button('+ New',()=>run(null,'here'),'session-primary'); fresh.setAttribute('aria-label','New conversation');
    fresh.disabled=true;
    tools.append(search,fresh);
    const status=el('div','session-status','Loading local conversations…'); status.setAttribute('role','status');
    const list=el('div','session-list'); list.setAttribute('aria-label','Conversations');
    drawer.append(head,tools,status,list); overlay.append(drawer); host.append(overlay);
    // Terminal body handlers otherwise send focus back to xterm after a click.
    overlay.addEventListener('mousedown', e => e.stopPropagation());
    overlay.addEventListener('click', e => e.stopPropagation());
    let closed=false, busy=false, sessions=[], replace=false, capped=false, draggedUntil=0;
    function dismiss(force=false) {
      if(busy && !force) return false;
      const restoreFocus=overlay.contains(document.activeElement);
      closed=true; observer.disconnect(); overlay.remove();
      document.removeEventListener('session-context:attached',contextAttached);
      document.removeEventListener('mousedown',outsideClick,true);
      if(closeCurrent===dismiss) closeCurrent=null;
      if(restoreFocus && previous?.isConnected) previous.focus();
      return true;
    }
    const observer=new MutationObserver(()=>{if(!host.isConnected) dismiss(true);});
    observer.observe(document.body,{childList:true,subtree:true});
    closeCurrent=dismiss;
    function contextAttached(e) {if(e.detail?.error) status.textContent=e.detail.error;else dismiss();}
    document.addEventListener('session-context:attached',contextAttached);
    function outsideClick(e) {if(!overlay.contains(e.target)) dismiss();}
    document.addEventListener('mousedown',outsideClick,true);
    overlay.onclick=e=>{if(e.target===overlay) dismiss();};
    function keys(e) {
      e.stopPropagation();
      if(e.key==='Escape') {e.preventDefault();e.stopPropagation();dismiss();}
    }
    overlay.addEventListener('keydown',keys); close.focus();
    const TEMP=/^(\/tmp\/|\/var\/(folders|tmp)\/|\/private\/var\/)|[\\/](scratch|temp)[\\/]/i;
    const base=p=>p.split(/[\\/]/).filter(Boolean).pop()||p;
    const ago=t=>{const m=(Date.now()-new Date(t))/6e4;
      if(m<1) return 'now'; if(m<60) return `${m|0}m`; if(m<1440) return `${m/60|0}h`; if(m<10080) return `${m/1440|0}d`;
      return new Date(t).toLocaleDateString([],{month:'short',day:'numeric'});};
    const PAGE=5, expanded=new Map(), showAll=new Set();
    function renderRow(s) {
      const row=button('',()=>{if(Date.now()>draggedUntil) run(s,'here');},'session-row');
      row.setAttribute('aria-disabled',String(!replace || s.id===currentId || s.cwd===null));
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
      row.title=`${s.title||''}\n${new Date(s.updatedAt).toLocaleString()}\n${s.id===currentId?'Current session':!replace?'Resume unavailable in this terminal':'Click to resume'} · drag into Claude to attach`;
      return row;
    }
    function renderList() {
      list.replaceChildren();
      const query=search.value.trim().toLowerCase();
      const filtered=sessions.filter(s=>((s.title||'') + ' ' + (s.cwd || '')).toLowerCase().includes(query));
      status.textContent=`${filtered.length}${capped?' recent':''} conversation${filtered.length===1?'':'s'} · drag to attach`;
      // Projects by recency; this terminal's project first; unknown and throwaway temp/scratch dirs last.
      const groups=new Map(), rank=k=>k===project?0:k==='\0temp'?3:k===''?2:1;
      for(const s of filtered) {const k=s.cwd&&TEMP.test(s.cwd)&&s.cwd!==project?'\0temp':s.cwd||'';if(!groups.has(k)) groups.set(k,[]);groups.get(k).push(s);}
      const ordered=[...groups].sort((a,b)=>rank(a[0])-rank(b[0]));
      ordered.forEach(([k,items],i)=>{
        const group=el('details','session-group');
        // Searching opens every match; otherwise only this project (or the most recent one) starts open.
        group.open=query?true:expanded.has(k)?expanded.get(k):k===project||(i===0&&rank(k)===1&&!groups.has(project));
        group.ontoggle=()=>{if(!query) expanded.set(k,group.open);};
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
    }
    async function run(session, mode) {
      if(busy || !replace || session?.cwd===null || (session && session.id===currentId)) return; busy=true; drawer.setAttribute('aria-busy','true');
      drawer.querySelectorAll('button,input').forEach(n=>n.disabled=true);
      status.textContent='Starting Claude…';
      try {await start(session,mode);busy=false;dismiss();}
      catch(e) {busy=false;drawer.removeAttribute('aria-busy');fresh.disabled=!replace;search.disabled=false;close.disabled=false;renderList();status.textContent=e.message;search.focus();}
    }
    search.oninput=renderList;
    try {
      const [result,idle]=await Promise.all([load(),canReplace()]);
      if(closed) return; sessions=result.sessions;capped=!!result.limit && sessions.length>=result.limit;replace=idle;fresh.disabled=!replace;fresh.title=replace?'Start Claude in this terminal split':'This terminal is running another process or its state is unknown.';search.disabled=false;renderList();
      if(overlay.contains(document.activeElement)) search.focus();
    } catch(e) {if(!closed) {status.textContent=e.message;fresh.disabled=true;search.disabled=true;}}
  };
})();
