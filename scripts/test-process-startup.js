// Startup forks inherit the host's name until exec; genuine workloads must remain visible.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'../electron/proc.js'),'utf8');
const files=new Map();
function add(pid,name,flags=0,foreground=pid) {
  files.set(`/proc/${pid}/comm`,name+'\n');
  files.set(`/proc/${pid}/stat`,`${pid} (${name}) S 1 ${pid} ${pid} 34816 ${foreground} ${flags} 0 0 0`);
}
add(101,'electron',0x40);add(102,'node',0x40);add(103,'zsh');
add(104,'zsh',0,105);add(105,'claude');add(106,'electron');
const fixture=vm.createContext({module:{exports:{}},process:{platform:'linux'},
  require:name=>name==='fs'?{readFileSync:file=>{if(!files.has(file))throw Error('ENOENT');return files.get(file);},readlinkSync:()=>'/host-directory',statSync:()=>({isDirectory:()=>true})}:require(name)});
vm.runInContext(source,fixture);
const info=pid=>JSON.parse(JSON.stringify(fixture.module.exports.runningProcessInfo(pid)));
assert.deepEqual(info(101),{running:false,name:null},'Forked Electron must not appear as a terminal workload');
assert.deepEqual(info(102),{running:false,name:null},'Forked Node must not appear as a terminal workload');
assert.deepEqual(info(103),{running:false,name:null},'Idle shells must remain idle');
assert.deepEqual(info(104),{running:true,name:'claude'},'Real foreground jobs must remain visible');
assert.deepEqual(info(106),{running:true,name:'electron'},'Do not blanket-hide real Electron commands');
add(101,'zsh');assert.deepEqual(info(101),{running:false,name:null},'Fork-to-shell transition must stay idle');
add(101,'claude');assert.deepEqual(info(101),{running:true,name:'claude'},'Direct agents must appear after exec');
add(107,'electron',0x40);
assert.equal(fixture.module.exports.processWorkingDirectory(107),null,'A startup fork must not leak the host runtime directory into new tabs');
console.log('PASS: pre-exec Electron/Node filtering, idle shells, foreground Claude and genuine Electron workloads');

(async()=>{
  if(process.platform!=='linux')return;
  const pty=require('node-pty'),{runningProcessInfo}=require('../electron/proc');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tv-process-startup-'));
  let terminal;
  const close=async()=>{
    if(!terminal)return;
    const current=terminal;terminal=null;
    await new Promise(resolve=>{const timer=setTimeout(resolve,1000);current.onExit(()=>{clearTimeout(timer);resolve();});current.kill();});
  };
  const ready=async marker=>{
    let output='';
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{subscription.dispose();reject(Error('Fixture did not start'));},5000);
      const subscription=terminal.onData(chunk=>{output+=chunk;if(output.includes(marker)){clearTimeout(timer);subscription.dispose();resolve();}});
      terminal.write(`printf 'READY:%s\\n' '${marker.slice(6)}'\r`);
    });
  };
  try {
    for(let i=0;i<20;i++) {
      terminal=pty.spawn('/bin/sh',['-i'],{cols:80,rows:24,cwd:temp,env:{...process.env,HOME:temp,ENV:'/dev/null'}});
      assert.equal(runningProcessInfo(terminal.pid).running,false,'Fresh PTY must not report the host runtime');
      await ready('READY:'+i);
      assert.deepEqual(runningProcessInfo(terminal.pid),{running:false,name:null});
      await close();
    }
    const script=path.join(temp,'busy.js');fs.writeFileSync(script,"console.log('BUSY_READY');process.stdin.resume();");
    let output='';
    terminal=pty.spawn(process.execPath,[script],{cols:80,rows:24,cwd:temp,env:process.env});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Busy fixture did not start')),5000);
      terminal.onData(chunk=>{output+=chunk;if(output.includes('BUSY_READY')){clearTimeout(timer);resolve();}});
    });
    assert.deepEqual(runningProcessInfo(terminal.pid),{running:true,name:'busy'});
    console.log('PASS: 20 real PTY shell startups remain idle; an executed workload is still detected');
  } finally {await close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
})().catch(error=>{console.error(error);process.exitCode=1;});
