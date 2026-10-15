const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPostgresStorage}=require('../postgres-storage');
test('Postgres commits hold row lock, merge current records and release client',async()=>{
 const statements=[];
 const base={sessions:[]};
 const client={async query(sql,args){statements.push(sql);if(sql.includes('FOR UPDATE'))return {rows:[{value:{sessions:[{token:'other'}]}}]};if(sql.startsWith('UPDATE'))assert.deepEqual(JSON.parse(args[0]).sessions.map(s=>s.token),['other','mine']);return {rows:[]};},release(){statements.push('release');}};
 const storage=createPostgresStorage({connect:async()=>client});
 await storage.commit(base,{sessions:[{token:'mine'}]});
 assert.deepEqual(statements,['BEGIN',"SET LOCAL lock_timeout = '10s'",'SELECT value FROM smartclass_state WHERE id=1 FOR UPDATE','UPDATE smartclass_state SET value=$1 WHERE id=1','COMMIT','release']);
});
test('Postgres conflicts roll back and release without updating data',async()=>{
 const statements=[];
 const client={async query(sql){statements.push(sql);return {rows:[{value:{users:[{id:'a',email:'a',name:'other'}]}}]};},release(){statements.push('release');}};
 await assert.rejects(createPostgresStorage({connect:async()=>client}).commit({users:[{id:'a',email:'a',name:'before'}]},{users:[{id:'a',email:'a',name:'mine'}]}),{status:409});
 assert.deepEqual(statements.slice(-2),['ROLLBACK','release']);
 assert.ok(!statements.some(s=>s.startsWith('UPDATE')));
});
