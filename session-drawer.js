// Tool history is a contextual drawer; workspaces, tabs and splits stay primary.
(function () {
  let closeCurrent;
  window.openSessionDrawer = async function ({ host, title = 'Claude sessions', cwd, currentId, load, start, canReplace }) {
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
    let closed=false, busy=false, sessions=[], replace=false, capped=false;
    function dismiss(force=false) {
      if(busy && !force) return false;
      const restoreFocus=overlay.contains(document.activeElement);
      closed=true; observer.disconnect(); overlay.remove();
      if(closeCurrent===dismiss) closeCurrent=null;
      if(restoreFocus && previous?.isConnected) previous.focus();
      return true;
    }
    const observer=new MutationObserver(()=>{if(!host.isConnected) dismiss(true);});
    observer.observe(document.body,{childList:true,subtree:true});
    closeCurrent=dismiss;
    overlay.onclick=e=>{if(e.target===overlay) dismiss();};
    function keys(e) {
      e.stopPropagation();
      if(e.key==='Escape') {e.preventDefault();e.stopPropagation();dismiss();}
    }
    overlay.addEventListener('keydown',keys); close.focus();
    function renderList() {
      list.replaceChildren();
      const query=search.value.toLowerCase();
      const filtered=sessions.filter(s=>(s.title + ' ' + (s.cwd || '')).toLowerCase().includes(query));
      status.textContent=`${filtered.length}${capped?' recent':''} conversation${filtered.length===1?'':'s'}`;
      for(const s of filtered) {
        const row=button('',()=>run(s,'here'),'session-row');
        row.disabled=!replace || s.id===currentId || s.cwd===null;
        if(s.id===currentId) row.setAttribute('aria-current','true');
        const when=new Date(s.updatedAt).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
        row.append(el('span','session-row-title',s.title),el('span','session-row-meta',s.cwd?`${s.cwd.split(/[\\/]/).filter(Boolean).pop()||s.cwd} · ${when}`:when));
        row.title=s.id===currentId?'Current session':s.cwd===null?'Saved working directory unavailable':!replace?'This terminal is running another process or its state is unknown.':`Resume in this tab${s.cwd ? ' · '+s.cwd : ''}`;
        if(s.id===currentId) row.append(el('span','session-current','Current')); list.append(row);
      }
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
