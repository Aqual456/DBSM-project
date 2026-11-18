import {chromium} from '@playwright/test';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve('docs/diagrams/exports');const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.emulateMedia({colorScheme:'light'});
 for(const file of readdirSync(out).filter(f=>f.endsWith('.svg'))){
  const svg=readFileSync(resolve(out,file),'utf8');
  const w=Number(svg.match(/width="([0-9.]+)px"/)[1]);const h=Number(svg.match(/height="([0-9.]+)px"/)[1]);
  await page.setViewportSize({width:Math.ceil(w),height:Math.min(1200,Math.ceil(h))});
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0;background:white}svg{display:block}</style></head><body>'+svg+'</body></html>');
  await page.screenshot({path:resolve(out,file.replace('.svg','.png')),fullPage:true});
  const previewWidth=1600,previewHeight=Math.ceil(h*previewWidth/w);
  await page.setViewportSize({width:previewWidth,height:Math.min(1200,previewHeight)});
  await page.addStyleTag({content:`svg{width:${previewWidth}px!important;height:${previewHeight}px!important}`});
  await page.screenshot({path:resolve(out,file.replace('.svg','.preview.png')),fullPage:true});
  console.log('Rasterized',file,w,h);
 }
}finally{await browser.close();}
