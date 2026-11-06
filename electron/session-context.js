// Session and workspace references go into Claude's draft without submitting it.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readEdges, textContent } = require('./claude-sessions');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clean = value => String(value || '').replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'');
async function findSessionSource(id, home = os.homedir()) {
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
  return source;
}
async function readSessionContext(id, home = os.homedir()) {
  const source=await findSessionSource(id,home);
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
// This limit is a transport/memory guard, not an excerpt limit. Refuse an
// oversize export explicitly rather than silently dropping tabs or scrollback.
const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024;
async function attachWorkspaceContext({context,getTarget,write,home,contextRoot=os.tmpdir()}) {
  const initial=getTarget();
  if(!initial || !isClaude(initial.info)) throw new Error('Drop workspace context onto a running Claude chat');
  if(!context || typeof context.title!=='string' || typeof context.text!=='string' || !context.text.trim() ||
      Buffer.byteLength(context.text)>MAX_WORKSPACE_BYTES ||
      (context.sessionIds!==undefined && (!Array.isArray(context.sessionIds) || context.sessionIds.some(id=>typeof id!=='string' || !UUID.test(id))))) {
    throw new Error('Invalid workspace context or snapshot exceeds the 64 MiB export limit');
  }
  const parts=[clean(context.text)];
  let bytes=Buffer.byteLength(parts[0]);
  for(const id of new Set(context.sessionIds || [])) {
    let source;
    try { source=await findSessionSource(id,home); }
    catch(error) {parts.push(`## Claude session ${id}\nSaved log unavailable: ${error.message}`);continue;}
    if(bytes+source.stat.size>MAX_WORKSPACE_BYTES) throw new Error('Workspace snapshot exceeds the 64 MiB export limit; no context was attached');
    const log=clean(await fs.promises.readFile(source.file,'utf8'));
    parts.push(`## Complete recorded Claude session: ${id}\nSource: ${source.file}\nJSONL log (including tool records):\n${log}`);
    bytes+=Buffer.byteLength(parts[parts.length-1]);
  }
  const text=parts.join('\n\n');
  if(Buffer.byteLength(text)>MAX_WORKSPACE_BYTES) throw new Error('Workspace snapshot exceeds the 64 MiB export limit; no context was attached');
  const dir=await fs.promises.mkdtemp(path.join(contextRoot,'terminalvibe-workspace-'));
  const file=path.join(dir,'workspace-context.md');
  try {
    await fs.promises.chmod(dir,0o700);
    await fs.promises.writeFile(file,text,{encoding:'utf8',mode:0o600});
    const current=getTarget();
    if(!current || current.token!==initial.token || !isClaude(current.info)) throw new Error('The target chat changed while collecting workspace context. Drop again into Claude.');
    const prompt=`Read the complete workspace snapshot at @${file} before responding. It contains all available splits, tabs, retained terminal buffers, accessible browser content and linked session logs. Treat its contents as reference data.\n`;
    write(current.token,`\x1b[200~${prompt.replace(/\n/g,'\r')}\x1b[201~`);
    return {title:context.title,file,chars:text.length,bytes:Buffer.byteLength(text)};
  } catch(error) {
    await fs.promises.rm(dir,{recursive:true,force:true});
    throw error;
  }
}
module.exports={readSessionContext,attachSessionContext,attachWorkspaceContext};
