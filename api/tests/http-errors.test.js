'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const multer=require('multer');
const {mount,classify}=require('../security/http-errors');
test('HTTP errors return bounded public messages',()=>{
  assert.equal(classify({code:'LIMIT_FILE_SIZE'})[0],413);
  assert.equal(classify({code:'UPLOAD_FORMAT'})[0],415);
  assert.equal(classify({type:'encoding.unsupported'})[0],415);
  assert.equal(classify({type:'entity.parse.failed'})[0],400);
  assert.deepEqual(classify(new Error('private internal data')),[500,'Erreur interne du serveur']);
});
test('unknown API routes, malformed JSON and upload limits return JSON on disposable HTTP server',async()=>{
  const app=express();
  app.use(express.json({limit:'1kb',inflate:false}));
  app.post('/api/json',(req,res)=>res.json({success:true}));
  app.post('/api/upload',multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:8}}).array('documents',1),(req,res)=>res.json({success:true}));
  mount(app);
  const server=await new Promise(resolve=>{const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));});
  const base='http://127.0.0.1:'+server.address().port;
  try {
    const cases=[
      ['/api/missing',{},404],
      ['/api/json',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'},400],
      ['/api/json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:'x'.repeat(2048)})},413]
    ];
    const form=new FormData();form.append('documents',new Blob(['too many bytes']),'test.txt');
    cases.push(['/api/upload',{method:'POST',body:form},413]);
    for(const [url,opts,status] of cases){const r=await fetch(base+url,opts);assert.equal(r.status,status);assert.match(r.headers.get('content-type'),/application\/json/);assert.equal((await r.json()).success,false);}
  }finally{await new Promise(resolve=>server.close(resolve));}
});
