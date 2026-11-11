const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listClaudeSessions, findClaudeImage, findClaudePaste, findCodexImage } = require('../electron/claude-sessions');
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
    const img=d=>({type:'image',source:{type:'base64',media_type:'image/png',data:d}});
    const imgId='11111111-1234-1234-1234-123456789abc';
    fs.writeFileSync(path.join(dir,imgId+'.jsonl'),[
      {type:'user',cwd,message:{content:[{type:'text',text:'[Image #1] [Image #2] look'},img('AAA'),img('BBB')]}},
      {type:'user',cwd,message:{content:[{type:'tool_result',content:[img('TOOL')]}]}},
      {type:'user',cwd,imagePasteIds:[5],message:{content:[img('EEE')]}},
      {type:'user',cwd,message:{content:[{type:'image',source:{type:'base64',media_type:'text/html',data:'X'}}]}},
    ].map(r=>JSON.stringify(r)).join('\n')+'\n{broken "image"');
    assert.equal((await findClaudeImage({sessionId:imgId,n:2},temp)).data,'BBB','Images count up per session');
    assert.equal((await findClaudeImage({sessionId:imgId,n:5},temp)).data,'EEE','imagePasteIds wins');
    assert.equal((await findClaudeImage({cwd,n:1},temp)).data,'AAA','Falls back to the newest transcript in the cwd');
    assert.equal(await findClaudeImage({sessionId:imgId,n:6},temp),null,'Non-image media types are refused');
    assert.equal(await findClaudeImage({sessionId:imgId,n:9},temp),null);
    const elsewhere=path.join(config,'projects','elsewhere');fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere,'22222222-1234-1234-1234-123456789abc.jsonl'),JSON.stringify({type:'user',message:{content:[{type:'text',text:'[Image #1] other'},img('ZZZ')]}})+'\n');
    const prompt='[Image #1]   [Image #2] look';
    assert.equal((await findClaudeImage({cwd:path.join(temp,'stale'),n:2,prompt},temp)).data,'BBB','Stale cwd: the visible prompt finds the right transcript');
    assert.equal((await findClaudeImage({cwd:path.join(temp,'stale'),n:1,prompt},temp)).data,'AAA','A newer session with the same image number is not used');
    assert.equal(await findClaudeImage({cwd:path.join(temp,'stale'),n:1},temp),null,'Unmatched transcripts from other projects are never trusted');
    assert.equal(await findClaudeImage({sessionId:'../etc',n:9},temp),null,'Non-UUID session ids are ignored, not read');
    fs.mkdirSync(path.join(config,'paste-cache'));fs.writeFileSync(path.join(config,'paste-cache','abcdef0123456789.txt'),'from\ncache');
    fs.writeFileSync(path.join(config,'history.jsonl'),[
      {display:'fix [Pasted text #2 +1 lines]',pastedContents:{2:{id:2,type:'text',content:'old\nfix'}}},
      {display:'fix [Pasted text #2 +1 lines]',pastedContents:{2:{id:2,type:'text',content:'new\nfix'}}},
      {display:'[Pasted text #1 +1 lines] why',pastedContents:{1:{id:1,type:'text',contentHash:'abcdef0123456789'}}},
      {display:'[Pasted text #3 +0 lines]',pastedContents:{3:{id:3,type:'text',contentHash:'../../etc/passwd'}}},
    ].map(r=>JSON.stringify(r)).join('\n')+'\n{bad pastedContents');
    assert.equal(await findClaudePaste({n:2,lines:1,prompt:'fix  [Pasted text #2 +1 lines]'},temp),'new\nfix','Newest matching prompt wins');
    assert.equal(await findClaudePaste({n:1,lines:1,prompt:'[Pasted text #1 +1 lines] why'},temp),'from\ncache','contentHash reads paste-cache');
    assert.equal(await findClaudePaste({n:4,lines:1,prompt:'[Pasted text #4 +1 lines] why'},temp),'from\ncache','A recalled prompt (renumbered paste) still matches');
    assert.equal(await findClaudePaste({n:1,lines:5,prompt:'[Pasted text #1 +1 lines] why'},temp),null,'Line count must match');
    assert.equal(await findClaudePaste({n:1,lines:1,prompt:'something else'},temp),null,'Prompt must match');
    assert.equal(await findClaudePaste({n:1,lines:1},temp),null,'No prompt, no guess');
    assert.equal(await findClaudePaste({n:3,lines:0,prompt:'[Pasted text #3 +0 lines]'},temp),null,'Hashes must not escape paste-cache');
    const codexDay=path.join(temp,'.codex','sessions','2026','11','11');fs.mkdirSync(codexDay,{recursive:true});
    const codexMsg=(text,id,data)=>JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[
      {type:'input_text',text:`<image name=[Image #${id}] path="x.png">`},{type:'input_image',image_url:`data:image/png;base64,${data}`},
      {type:'input_text',text:'</image>'},{type:'input_text',text}]}});
    fs.writeFileSync(path.join(codexDay,'rollout-a.jsonl'),[codexMsg('[Image #1] first',1,'C1'),codexMsg('[Image #1] second',1,'C2'),'{bad "input_image"'].join('\n'));
    assert.equal((await findCodexImage({n:1,prompt:'[Image #1] second'},temp)).data,'C2','Codex: the message matching the prompt');
    assert.equal((await findCodexImage({n:1,prompt:'[Image #1]  first'},temp)).data,'C1','Codex: each message keeps its own #1');
    assert.equal(await findCodexImage({n:2,prompt:'[Image #1] first'},temp),null);
    assert.equal(await findCodexImage({n:1},temp),null,'Codex: no prompt, no guess');
    const emptyConfig=path.join(temp,'no-history');process.env.CLAUDE_CONFIG_DIR=emptyConfig;
    assert.deepEqual((await listClaudeSessions(cwd,temp)).sessions,[]);
    console.log('PASS: local Claude history, previews, malformed records, all-project discovery, original working directories and empty history');
  } finally { if(saved===undefined) delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=saved;fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
