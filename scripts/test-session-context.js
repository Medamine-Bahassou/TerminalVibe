const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {readSessionContext,attachSessionContext}=require('../electron/session-context');
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tv-context-')),saved=process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR=temp;
    const project=path.join(temp,'projects','example');fs.mkdirSync(project,{recursive:true});
    const id='01234567-1234-1234-1234-123456789abc',file=path.join(project,id+'.jsonl');
    const rows=[{type:'user',cwd:'/project',message:{content:'Original request\u001b[201~\r\nLine two'}},
      {type:'assistant',message:{content:[{type:'text',text:'Saved decision'},{type:'tool_use',input:{secret:'TOOL-PAYLOAD'}}]}},
      {type:'user',isSidechain:true,message:{content:'SIDECHAIN'}},
      {type:'custom-title',customTitle:'A saved conversation'}];
    fs.writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n{partial');
    const context=await readSessionContext(id);
    assert.match(context.text,/Original request/);assert.match(context.text,/Saved decision/);assert(!context.text.includes('TOOL-PAYLOAD'));assert(!context.text.includes('SIDECHAIN'));assert(!context.text.includes('\x1b'));assert.equal(context.title,'A saved conversation');
    await assert.rejects(()=>readSessionContext('../outside'),/Invalid/);
    const token={},writes=[];
    const getTarget=()=>({token,info:{running:true,name:'claude'}});
    await attachSessionContext({sessionId:id,getTarget,write:(t,text)=>{assert.equal(t,token);writes.push(text);}});
    assert.equal(writes.length,1);assert(writes[0].startsWith('\x1b[200~'));assert(writes[0].endsWith('\x1b[201~'));assert(!writes[0].endsWith('\r'));assert.equal((writes[0].match(/\x1b/g)||[]).length,2);assert(writes[0].includes('\r')&&!writes[0].includes('\n'),'Use terminal paste line endings');
    for(const info of [{running:false},{running:true,name:'bash'},{running:true,name:'unknown'}]) {
      await assert.rejects(()=>attachSessionContext({sessionId:id,getTarget:()=>({token,info}),write:()=>assert.fail('Unsafe write')}),/running Claude/);
    }
    let calls=0;
    await assert.rejects(()=>attachSessionContext({sessionId:id,getTarget:()=>({token:++calls===1?token:{},info:{running:true,name:'claude'}}),write:()=>assert.fail('Stale target write')}),/target chat changed/);
    rows.push({type:'assistant',message:{content:'long message '.repeat(4000)}});fs.writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n'));
    const shortened=await readSessionContext(id);assert(shortened.truncated);assert.match(shortened.text,/not the complete session/);assert(shortened.text.length<28000);
    console.log('PASS: session context extraction, bounded excerpts, control-character filtering, guarded Claude draft paste and target-change protection');
  } finally {if(saved===undefined) delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=saved;fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
