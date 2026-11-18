import { fileURLToPath } from 'node:url';
import { resolve,dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=resolve(root,'.next-build');
if(dirname(target)!==root)throw new Error('Unexpected output directory');
if(process.platform==='win32'){
 const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve(root,'scripts/clean-build.ps1')],{stdio:'inherit',windowsHide:true});
 if(result.status!==0)process.exit(result.status||1);
}else rmSync(target,{recursive:true,force:true});
