import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { parsePlan } from './planner/plan-contract.js';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const fail = (status, message) => Object.assign(new Error(message), { status });
const json = (res, status, value) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
const equal = (a,b) => { const x=Buffer.from(a || ''), y=Buffer.from(b || ''); return x.length===y.length && timingSafeEqual(x,y); };
export async function createCookedServer({dataDir=process.env.COOKED_DATA_DIR || resolve(projectRoot,'data'), publicUrl=process.env.COOKED_PUBLIC_URL || ''}={}) {
  await mkdir(dataDir, {recursive:true, mode:0o700});
  const configPath = resolve(dataDir,'connection.json'), dbPath = resolve(dataDir,'plans.json');
  let config;
  try { config = JSON.parse(await readFile(configPath,'utf8')); }
  catch(e) {
    if(e.code!=='ENOENT') throw e;
    config = {writeToken: randomBytes(32).toString('hex'), readToken: randomBytes(32).toString('hex')};
    await writeFile(configPath,JSON.stringify(config),{mode:0o600,flag:'wx'});
  }
  if (!/^[a-f0-9]{64}$/.test(config.writeToken) || !/^[a-f0-9]{64}$/.test(config.readToken)) throw new Error('Invalid connection configuration.');
  let db;
  try { db=JSON.parse(await readFile(dbPath,'utf8')); }
  catch(e) { if(e.code!=='ENOENT') throw e; db={version:1,active:null,plans:{}}; }
  if (db.version!==1 || !db.plans || typeof db.plans!=='object') throw new Error('Invalid plan store.');
  let queue=Promise.resolve();
  const save = plan => {
    const task=queue.then(async()=>{
      const id=createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0,16);
      const record={id,plan,savedAt:new Date().toISOString()};
      const next={...db,active:id,plans:{...db.plans,[id]:record}};
      const tmp=`${dbPath}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(tmp,JSON.stringify(next),{mode:0o600});
      await rename(tmp,dbPath);
      db=next;
      return record;
    });
    queue=task.catch(()=>{});
    return task;
  };
  const root=resolve(projectRoot,'planner');
  const server=createServer(async(req,res)=>{
    res.setHeader('cache-control','no-store');
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/health' && req.method==='GET') return json(res,200,{ok:true});
      if(url.pathname.startsWith('/api/')) {
        const token=(req.headers.authorization || '').replace(/^Bearer /,'');
        const writer=equal(token,config.writeToken), reader=equal(token,config.readToken);
        if(!writer&&!reader) throw fail(401,'Enter the connection key from the server terminal.');
        if(req.method==='GET' && url.pathname==='/api/connection') {
          if(!writer) throw fail(403,'This key can only read cooking plans.');
          return json(res,200,{readToken:config.readToken,publicUrl});
        }
        if(req.method==='GET' && url.pathname==='/api/active') return json(res,200,{record:db.active ? db.plans[db.active] : null});
        const match=url.pathname.match(/^\/api\/plans\/([a-f0-9]{16})$/);
        if(req.method==='GET' && match) {
          if(!db.plans[match[1]]) throw fail(404,'That cooking plan is no longer available.');
          return json(res,200,{record:db.plans[match[1]]});
        }
        if(req.method==='PUT' && url.pathname==='/api/active') {
          if(!writer) throw fail(403,'The Echo key cannot change the selected plan.');
          const origin=req.headers.origin;
          const allowed=publicUrl ? new URL(publicUrl).origin : `http://${req.headers.host}`;
          if(origin && origin!==allowed) throw fail(403,'Open the planner at its configured address.');
          if(!(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415,'Send a JSON cooking plan.');
          const chunks=[]; let size=0;
          for await(const chunk of req) { size+=chunk.length; if(size>131072) throw fail(413,'The plan must be smaller than 128 KB.'); chunks.push(chunk); }
          let parsed;
          try { parsed=parsePlan(Buffer.concat(chunks).toString('utf8')); } catch(e) { throw fail(400,e.message); }
          const record=await save(parsed.plan);
          return json(res,200,{record,warnings:parsed.warnings});
        }
        throw fail(404,'API route not found.');
      }
      if(req.method!=='GET' && req.method!=='HEAD') throw fail(405,'Method not allowed.');
      let name=decodeURIComponent(url.pathname);
      if(name==='/') name='/index.html';
      const file=resolve(root,`.${name}`);
      if(!file.startsWith(root+sep) || name.includes('\0')) throw fail(404,'Not found.');
      const body=await readFile(file);
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png','.ttf':'font/ttf'};
      res.writeHead(200,{'content-type':types[extname(file)] || 'application/octet-stream'});
      res.end(req.method==='HEAD'?undefined:body);
    } catch(e) {
      if(!res.headersSent) json(res,e.status || (e.code==='ENOENT' || e.code==='EISDIR'?404:500),{error:e.status?e.message:e.code==='ENOENT'?'Not found.':'The plan could not be saved or loaded. Please try again.'});
      else res.end();
    }
  });
  return {server,config};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const {server,config}=await createCookedServer();
  const port=Number(process.env.PORT || 4173), host=process.env.HOST || '127.0.0.1';
  server.listen(port,host,()=>{
    console.log(`COOKED! phone planner: http://localhost:${port}`);
    console.log(`Connection key (keep private): ${config.writeToken}`);
  });
}
