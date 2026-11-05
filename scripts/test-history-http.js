const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),cp=require('child_process');
const {once}=require('events');
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tv-history-http-'));
  let child;
  try {
    const config=path.join(temp,'claude'),project=path.join(config,'projects','test-project');fs.mkdirSync(project,{recursive:true});
    fs.writeFileSync(path.join(project,'01234567-1234-1234-1234-123456789abc.jsonl'),JSON.stringify({type:'user',cwd:temp,message:{content:'Saved Claude conversation'}}));
    const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
    child=cp.spawn(process.execPath,[path.join(__dirname,'../electron/dev-server.js')],{env:{...process.env,APP_PORT:String(port),CLAUDE_CONFIG_DIR:config,HOME:temp,USERPROFILE:temp},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Static server did not start')),5000);
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('Static server exited '+code));});
      child.stdout.on('data',()=>{clearTimeout(timer);resolve();});
    });
    const url=`http://127.0.0.1:${port}/api/claude-sessions?cwd=${encodeURIComponent('/unrelated/directory')}`;
    const response=await fetch(url);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/json/);
    const data=await response.json();assert.equal(data.scope,'all-projects');assert.equal(data.sessions.length,1);assert.equal(data.sessions[0].cwd,temp);
    assert.equal((await fetch(url,{headers:{Origin:`http://127.0.0.1:${port}`}})).status,200);
    assert.equal((await fetch(url,{headers:{Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await fetch(url,{method:'POST'})).status,405);
    console.log('PASS: frontend dev-server session API, all-project history, JSON responses and origin/method checks');
  } finally {if(child && child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
