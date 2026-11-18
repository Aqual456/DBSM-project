import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve('docs/diagrams');
const manifest=JSON.parse(readFileSync(resolve(out,'diagram-manifest.json'),'utf8'));
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><html><body style="margin:0"><iframe id="editor" style="width:100vw;height:100vh;border:0" src="https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=atlas&libraries=1&offline=1"></iframe><script>window.events=[];window.addEventListener('message',e=>{if(e.origin!=='https://embed.diagrams.net')return;try{events.push(JSON.parse(e.data));}catch{}});window.send=(d)=>document.querySelector('iframe').contentWindow.postMessage(JSON.stringify(d),'https://embed.diagrams.net');</script></body></html>`);});
await new Promise(r=>server.listen(3179,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 await page.route('https://embed.diagrams.net/**',async route=>{try{const response=await fetch(route.request().url());await route.fulfill({status:response.status,contentType:response.headers.get('content-type')||'application/octet-stream',body:Buffer.from(await response.arrayBuffer())});}catch(e){console.log('Asset failed',route.request().url(),e.message);await route.abort();}});
 page.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url());});
 page.on('pageerror',e=>console.log('Page error',e.message));
 page.on('console',m=>{if(m.type()==='error')console.log('Browser:',m.text().slice(0,180));});
 await page.goto('http://127.0.0.1:3179');
 await page.waitForFunction(()=>events.some(x=>x.event==='init'),null,{timeout:90000}).catch(async e=>{console.log('Events',await page.evaluate(()=>events));await page.screenshot({path:resolve(out,'exports','drawio-connection-debug.png')});throw e;});
 console.log('Native draw.io editor initialized');
 const requested=process.argv.slice(2);const pages=requested.length?manifest.pages.filter(p=>requested.includes(p.stem)):manifest.pages;
 for(const item of pages){
  const xml=readFileSync(resolve(out,'pages',item.stem+'.drawio'),'utf8');
  await page.evaluate(xml=>{events=[];send({action:'load',xml,title:'ReliefFlow',autosave:0,saveAndExit:0});},xml);
  await page.waitForFunction(()=>events.some(x=>x.event==='load'),{timeout:45000});
  await page.evaluate(()=>{events=[];send({action:'export',format:'svg',border:40,scale:1,background:'#ffffff',theme:'light'});});
  await page.waitForFunction(()=>events.some(x=>x.event==='export'||x.error),{timeout:60000});
  const result=await page.evaluate(()=>events.find(x=>x.event==='export'||x.error));
  if(result.error)throw new Error(JSON.stringify(result));
  const data=result.data;
  const svg=data.startsWith('data:')?(data.includes(';base64,')?Buffer.from(data.split(',')[1],'base64').toString('utf8'):decodeURIComponent(data.slice(data.indexOf(',')+1))):data;
  if(!svg.includes('<svg'))throw new Error('Invalid SVG response');
  writeFileSync(resolve(out,'exports',item.stem+'.svg'),svg);
  console.log('Exported',item.stem,'bytes',svg.length);
 }
 await page.screenshot({path:resolve(out,'exports','drawio-editor-verification.png')});
}finally{await browser.close();await new Promise(r=>server.close(r));}




