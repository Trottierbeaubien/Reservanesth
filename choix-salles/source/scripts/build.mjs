import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const name of ['index.html','sw.js','manifest.webmanifest','icon.svg','icon-180.png','icon-192.png','icon-512.png','icon-masque-hdq-180.png','icon-masque-hdq-192.png','icon-masque-hdq-512.png'])await copyFile('web/'+name,'dist/'+name);
await build({entryPoints:['web/main.js'],outfile:'dist/main.js',bundle:true,minify:true,format:'esm',target:['es2022']});
const revision=createHash('sha256').update(await readFile('dist/main.js')).digest('hex').slice(0,12);
await writeFile('dist/index.html',(await readFile('web/index.html','utf8')).replace('./main.js','./main.js?v='+revision));
const files=['model.ts','round.ts','runtime.ts','pdf.ts'];
for(const file of files){let text=await readFile('server/'+file,'utf8');text=text.replaceAll("from 'zod'","from 'npm:zod@3.25.76'").replaceAll("from '@supabase/supabase-js'","from 'npm:@supabase/supabase-js@2.119.0'").replaceAll("from '@block65/webcrypto-web-push'","from 'npm:@block65/webcrypto-web-push@2.0.0'").replaceAll("from 'pdf-lib'","from 'npm:pdf-lib@1.17.1'");await writeFile('supabase/functions/hdq-choice/'+file,text)}
await writeFile('supabase/functions/hdq-choice/index.ts',`import {createHandler} from './runtime.ts';\nDeno.serve(createHandler({supabaseUrl:Deno.env.get('SUPABASE_URL')!,serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,brevoKey:Deno.env.get('BREVO_API_KEY'),senderEmail:Deno.env.get('HDQ_SENDER_EMAIL'),senderName:Deno.env.get('HDQ_SENDER_NAME')}));\n`);
await writeFile('dist/visual-mobile.html',`<!doctype html><meta charset="utf-8"><title>Aperçu mobile HDQ</title><style>body{margin:0;background:#dce4eb;font:16px Arial}p{text-align:center}iframe{display:block;width:390px;height:844px;margin:12px auto;border:2px solid #8293a3;border-radius:18px;background:white}</style><p>Aperçu mobile · Données fictives</p><iframe title="Aperçu mobile de l’application" src="./?apercu=visuel"></iframe>`);
console.log('Static app and server files built.');
