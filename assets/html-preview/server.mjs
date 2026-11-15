import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2); const pi=args.indexOf('--port');
const port=Number(pi>=0?args[pi+1]:process.env.PORT||7100);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  try{
    const url=decodeURIComponent((req.url||'/').split('?')[0]);
    let file=path.resolve(root,'.'+(url==='/'?'/index.html':url));
    if(!file.startsWith(root)){res.writeHead(403);return res.end();}
    const info=await stat(file); if(info.isDirectory()) file=path.join(file,'index.html');
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');}
}).listen(port,'0.0.0.0',()=>console.log(`Preview: http://localhost:${port}`));
