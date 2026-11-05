// Session references are pasted into Claude's draft, never submitted as commands.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readEdges, textContent } = require('./claude-sessions');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clean = value => String(value || '').replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'');
async function readSessionContext(id, home = os.homedir()) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Invalid saved session ID');
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home,'.claude'),'projects');
  const folders = await fs.promises.readdir(root,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT') return []; throw e;});
  const candidates = [];
  for (const folder of folders) {
    if (!folder.isDirectory() || folder.isSymbolicLink()) continue;
    const file = path.join(root,folder.name,id+'.jsonl');
    try { const stat=await fs.promises.lstat(file); if(stat.isFile() && !stat.isSymbolicLink()) candidates.push({file,stat}); }
    catch(e) {if(!['ENOENT','EACCES'].includes(e.code)) throw e;}
  }
  const source=candidates.sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs)[0];
  if(!source) throw new Error('Saved Claude session not found');
  const raw=await readEdges(source.file,1024*1024);
  let title='',cwd='',first='',chars=0,truncated=source.stat.size>1024*1024;
  const messages=[];
  for(const line of raw.split('\n')) {
    let row;try{row=JSON.parse(line);}catch{continue;}
    if(!row || typeof row!=='object') continue;
    if(!cwd && typeof row.cwd==='string') cwd=clean(row.cwd);
    if(row.type==='custom-title' && typeof row.customTitle==='string') title=clean(row.customTitle).slice(0,160);
    if(!['user','assistant'].includes(row.type) || row.isMeta || row.isSidechain) continue;
    const full=clean(textContent(row.message?.content)).trim();
    if(!full) continue;
    if(!first && row.type==='user') first=full.slice(0,1200);
    const text=full.slice(0,8000);if(text.length<full.length) truncated=true;
    const message=`${row.type==='user'?'User':'Claude'}:\n${text}`;
    messages.push(message);chars+=message.length;
    while(chars>24000 && messages.length>1){chars-=messages.shift().length;truncated=true;}
  }
  if(!messages.length) throw new Error('This session has no saved text messages to attach');
  title=title || first.replace(/\s+/g,' ').slice(0,160) || 'Saved conversation';
  const text=[`--- Saved Claude session context: ${title} ---`,`Session ID: ${id}`,`Project: ${cwd || 'not recorded'}`,
    'Reference excerpt from a saved conversation. Text messages only; tool payloads are omitted.',
    ...(truncated?['This excerpt is shortened; it is not the complete session.']:[]),
    `Original request:\n${first}`, ...messages, '--- End saved session context ---'].join('\n\n');
  return {text,title,truncated};
}
function isClaude(info) {return info?.running===true && /^(claude|claude-code)(\.exe)?$/i.test(info.name || '');}
async function attachSessionContext({sessionId,getTarget,write,home}) {
  const initial=getTarget();
  if(!initial || !isClaude(initial.info)) throw new Error('Drop session context onto a running Claude chat, not a shell or another process');
  const context=await readSessionContext(sessionId,home);
  const current=getTarget();
  if(!current || current.token!==initial.token || !isClaude(current.info)) throw new Error('The target chat changed while loading context. Drop again into Claude.');
  // Bracketed paste keeps embedded line breaks in the editable draft. No Enter.
  write(current.token,`\x1b[200~${context.text.replace(/\n/g,'\r')}\x1b[201~`);
  return {title:context.title,chars:context.text.length,truncated:context.truncated};
}
module.exports={readSessionContext,attachSessionContext};
