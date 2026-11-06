const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listClaudeSessions } = require('../electron/claude-sessions');
(async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tv-history-'));
  const saved=process.env.CLAUDE_CONFIG_DIR;
  try {
    const cwd=path.join(temp,'project'); fs.mkdirSync(cwd);
    const config=path.join(temp,'claude'); process.env.CLAUDE_CONFIG_DIR=config;
    const dir=path.join(config,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'));fs.mkdirSync(dir,{recursive:true});
    const id='01234567-1234-1234-1234-123456789abc';
    const rows=[{type:'user',cwd,message:{content:'Find the issue'}},
      {type:'assistant',message:{content:[{type:'text',text:'A preview'},{type:'tool_use',input:{private:'excluded'}}]}},
      {type:'custom-title',customTitle:'My session'}];
    fs.writeFileSync(path.join(dir,id+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n{incomplete');
    const result=await listClaudeSessions(cwd,temp);
    assert.equal(result.sessions.length,1);assert.equal(result.sessions[0].title,'My session');
    assert.equal(result.sessions[0].preview[1].text,'A preview');assert(!JSON.stringify(result).includes('excluded'));
    assert.equal(result.sessions[0].cwd,cwd,'Each conversation retains its original cwd');
    const other=path.join(temp,'other');fs.mkdirSync(other);
    const otherDir=path.join(config,'projects','another-project');fs.mkdirSync(otherDir);
    const otherId='abcdef01-1234-1234-1234-123456789abc';
    fs.writeFileSync(path.join(otherDir,otherId+'.jsonl'),JSON.stringify({type:'user',cwd:other,message:{content:'Another project'}})+'\nnull\n');
    const global=await listClaudeSessions(cwd,temp);
    assert.equal(global.scope,'all-projects');
    assert.equal(global.sessions.length,2,'Include conversations outside the terminal directory');
    assert.equal(global.sessions.find(s=>s.id===otherId).cwd,other);
    assert.equal((await listClaudeSessions(undefined,temp)).sessions.length,2,'History works with no terminal cwd');
    fs.mkdirSync(path.join(temp,'empty'));
    assert.equal((await listClaudeSessions(path.join(temp,'empty'),temp)).sessions.length,2,'Empty terminal directory must not hide Claude history');
    assert.equal((await listClaudeSessions(path.join(temp,'missing'),temp)).sessions.length,2,'Missing terminal directory must not block browsing');
    const emptyConfig=path.join(temp,'no-history');process.env.CLAUDE_CONFIG_DIR=emptyConfig;
    assert.deepEqual((await listClaudeSessions(cwd,temp)).sessions,[]);
    console.log('PASS: local Claude history, previews, malformed records, all-project discovery, original working directories and empty history');
  } finally { if(saved===undefined) delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=saved;fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
