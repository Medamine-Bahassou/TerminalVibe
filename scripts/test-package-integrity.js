const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),asar=require('@electron/asar');
const {verifyPackage}=require('../scripts/verify-package');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tv-archive-test-'));
 try {
 const src=path.join(root,'src');fs.mkdirSync(src);
 fs.writeFileSync(path.join(src,'package.json'),JSON.stringify({main:'main.js'})); fs.writeFileSync(path.join(src,'main.js'),'console.log(1);');
 const archive=path.join(root,'app.asar');await asar.createPackage(src,archive);verifyPackage(archive);
 const data=fs.readFileSync(archive);data[data.length-1]^=1;fs.writeFileSync(archive,data);
 assert.throws(()=>verifyPackage(archive),/Corrupt packaged file/);
 console.log('PASS: valid archives accepted and corrupted archives rejected');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
