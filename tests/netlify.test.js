const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'netlify-handler-'));
const { db } = require('../server');
const { handler } = require('../netlify/functions/api');
after(async () => { await db.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });
async function call(route, { method='GET', body='', headers={}, binary=false }={}) {
  const result = await handler({ httpMethod:method, path:'/api'+route, rawUrl:'https://example.netlify.app/api'+route, headers:{host:'example.netlify.app','x-forwarded-proto':'https',...headers}, body, isBase64Encoded:binary, queryStringParameters:{}, requestContext:{} }, {});
  result.text = result.isBase64Encoded ? Buffer.from(result.body,'base64').toString() : result.body;
  return result;
}
test('Lambda handler preserves JSON, sessions, multipart bytes, authorization and errors', async () => {
  assert.equal((await call('/health')).statusCode,200);
  assert.equal((await call('/state')).statusCode,401);
  const login = await call('/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://example.netlify.app'},body:JSON.stringify({email:'student@smartclass.local',password:'password123'})});
  assert.equal(login.statusCode,200);
  const cookie=(Object.entries(login.headers).find(([key])=>key.toLowerCase()==='set-cookie')?.[1] || Object.entries(login.multiValueHeaders).find(([key])=>key.toLowerCase()==='set-cookie')[1][0]).split(';')[0];
  assert.equal((await call('/state',{headers:{cookie}})).statusCode,200);
  const content=Buffer.from([0,255,128,13,10,65]);
  const boundary='testBoundary';
  const multipart=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.zip"\r\nContent-Type: application/zip\r\n\r\n`),content,Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const upload=await call('/upload',{method:'POST',headers:{cookie,'content-type':`multipart/form-data; boundary=${boundary}`},body:multipart.toString('base64'),binary:true});
  assert.equal(upload.statusCode,200,upload.text);
  const id=JSON.parse(upload.text).id;
  const download=await call('/files/'+id,{headers:{cookie}});
  assert.equal(download.statusCode,200);
  assert.deepEqual(Buffer.from(download.body,'base64'),content);
  assert.equal((await call('/missing',{headers:{cookie}})).statusCode,404);
  assert.equal((await call('/logout',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'})).statusCode,200);
  assert.equal((await call('/state',{headers:{cookie}})).statusCode,401);
});

test('Netlify without durable credentials fails closed and never creates SQLite',()=>{
 const {spawnSync}=require('node:child_process');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'netlify-no-db-'));
 try {
  const result=spawnSync(process.execPath,['-e',`const {createStorage}=require('./storage');const storage=createStorage(()=>({}));if(storage.persistent)process.exit(2);storage.middleware({}, {status(code){if(code!==503)process.exit(3);return this;},json(){console.log('closed');}},()=>process.exit(4));`],{cwd:path.join(__dirname,'..'),env:{...process.env,NETLIFY:'true',DATABASE_URL:'',BLOB_READ_WRITE_TOKEN:'',DATA_DIR:directory},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/closed/);
  assert.deepEqual(fs.readdirSync(directory),[]);
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
