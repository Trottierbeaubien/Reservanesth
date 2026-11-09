import {createClient} from '@supabase/supabase-js';
import {buildPushPayload} from '@block65/webcrypto-web-push';
import {initial,canManage,nextChooser,person,sortDirectory,type Programme} from './model.ts';
import {transition,RoundError,type Event} from './round.ts';
import {makePdf} from './pdf.ts';
const HOST='https://trottierbeaubien.github.io';
const WEB_PATH=HOST+'/Reservanesth/choix-salles/';
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function validPushEndpoint(endpoint:string){try{const u=new URL(endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(u.hostname)}catch{return false}}
export function createHandler(settings:{supabaseUrl:string,serviceKey:string,brevoKey?:string,senderEmail?:string,senderName?:string}){
 const db=createClient(settings.supabaseUrl,settings.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const must=(result:any)=>{if(result.error)throw new Error('Database operation failed');return result.data};
 async function state(){const rows=must(await db.from('hdq_state').select('revision,payload').eq('id',1));if(!rows?.length){must(await db.from('hdq_state').upsert({id:1,revision:0,payload:initial()},{onConflict:'id',ignoreDuplicates:true}));return state()}return{revision:Number(rows[0].revision),data:rows[0].payload as Programme}}
 async function commit(revision:number,data:Programme,events:Event[]=[],clear=false,reset=false){return !!must(await db.rpc('hdq_commit',{p_revision:revision,p_payload:data,p_events:events,p_clear_turn:clear,p_reset:reset}))}
 async function vapid(){let rows=must(await db.from('hdq_runtime').select('value').eq('id','vapid'));if(!rows.length){const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const pub=await crypto.subtle.exportKey('raw',keys.publicKey),priv=await crypto.subtle.exportKey('jwk',keys.privateKey);must(await db.from('hdq_runtime').upsert({id:'vapid',value:{publicKey:b64(new Uint8Array(pub)),privateKey:priv.d,subject:WEB_PATH}},{onConflict:'id',ignoreDuplicates:true}));rows=must(await db.from('hdq_runtime').select('value').eq('id','vapid'))}return rows[0].value}
 async function dispatch(events:Event[]){
  if(!events.length)return;
  const keys=await vapid();
  await Promise.all(events.map(async e=>{try{
   const subs=must(await db.from('hdq_subscriptions').select('endpoint,payload').eq('email',e.email));let status=subs.length?'sent':'no-device';
   await Promise.all(subs.map(async (s:any)=>{try{const payload=await buildPushPayload({data:JSON.stringify({...e,url:WEB_PATH}),options:{ttl:3600}},s.payload,keys);const response=await fetch(s.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(7000)});if(response.status===404||response.status===410){await db.from('hdq_subscriptions').delete().eq('endpoint',s.endpoint);status='expired'}else if(!response.ok)status='failed'}catch{status='failed'}}));
   await db.from('hdq_notifications').update({push_status:status}).eq('id',e.id);
  }catch{/* The durable in-app notification remains pending. */}}));
 }
 async function mailSettings(){const rows=must(await db.from('hdq_runtime').select('value').eq('id','mail'));const saved=rows[0]?.value||{};return {apiKey:settings.brevoKey||saved.apiKey||'',senderEmail:settings.senderEmail||saved.senderEmail||'',senderName:settings.senderName||saved.senderName||'Anesthésiologie HDQ',to:saved.to||[],cc:saved.cc||[],fullTo:saved.fullTo||[],fullCc:saved.fullCc||[]}}
 async function snapshot(email:string,userId:string,isOwner=false){const s=await state();s.data.directory=sortDirectory(s.data.directory);const next=nextChooser(s.data),me=s.data.directory.find(p=>p.email===email);const notifications=must(await db.from('hdq_notifications').select('id,kind,payload,read,push_status').eq('email',email).order('created_at',{ascending:false}).limit(30));const mail=await mailSettings();return {...s,email,userId,isOwner,mailConfig:isOwner?{...mail,apiKey:undefined}:undefined,canManage:canManage(s.data,email),isStarter:!!s.data.roundStart&&s.data.roundOwner===email,myPersonId:me?.id||null,nextPersonId:next,pendingChoice:!!s.data.roundStart&&!!next&&(s.data.testMode?s.data.testRecipient===email:!!me&&next===me.id),notifications,emailReady:!!mail.apiKey&&!!mail.senderEmail&&!!mail.to.length&&!!mail.fullTo.length}}
 return async function handler(request:Request):Promise<Response>{
  const origin=request.headers.get('origin');const cors:Record<string,string>={'Access-Control-Allow-Origin':HOST,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-revision','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Expose-Headers':'Content-Disposition','Vary':'Origin','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:cors});
  if(origin&&origin!==HOST)return reply({error:'Origine non autorisée.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  try{
   const authorization=request.headers.get('authorization')||'';if(!authorization.startsWith('Bearer '))return reply({error:'Connectez-vous.'},401);
   const auth=await db.auth.getUser(authorization.slice(7));const user=auth.data?.user,email=user?.email?.toLowerCase();
   if(auth.error||!user||!email||!user.email_confirmed_at)return reply({error:'Session expirée. Reconnectez-vous.'},401);
   const membership=must(await db.from('hdq_members').select('is_owner').eq('email',email).eq('active',true).limit(1));
   if(!membership.length)return reply({error:'Votre compte n’est pas autorisé dans cette application. Demandez au responsable de vous ajouter à l’équipe.'},403);
   const action=new URL(request.url).searchParams.get('action')||'state';
   if(request.method==='GET'&&action==='state')return reply(await snapshot(email,user.id,!!membership[0].is_owner));
   if(request.method==='GET'&&action==='public-key')return reply({publicKey:(await vapid()).publicKey});
   if(request.method==='GET'&&action==='scan'){
    const s=await state();if(!s.data.scan)return reply({error:'Aucun programme partagé.'},404);
    const file=must(await db.storage.from('hdq-programmes').download(s.data.scan.key));return new Response(file,{headers:{...cors,'Content-Type':s.data.scan.type}});
   }
   if(request.method==='GET'&&action==='pdf'){
    const s=await state(),full=new URL(request.url).searchParams.get('full')==='1';let scan:Uint8Array|undefined;
    if(full&&s.data.scan)scan=new Uint8Array(await must(await db.storage.from('hdq-programmes').download(s.data.scan.key)).arrayBuffer());
    const bytes=await makePdf(s.data,full,scan);return new Response(bytes as BodyInit,{headers:{...cors,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="HDQ_'+s.data.date+(full?'_complet':'')+'.pdf"'}});
   }
   if(request.method==='PUT'&&action==='scan'){
    const s=await state();if(s.data.testMode&&s.data.testRecipient!==email)return reply({error:'Cet essai est réservé au coordonnateur.'},403);if(!canManage(s.data,email))return reply({error:'Seul le responsable de la ronde peut remplacer le programme.'},403);
    if(Number(request.headers.get('x-revision'))!==s.revision)return reply({error:'La ronde a changé. Actualisez et réessayez.'},409);
    const max=15*1024*1024;if(Number(request.headers.get('content-length')||0)>max)return reply({error:'Maximum 15 Mo.'},413);
    const reader=request.body?.getReader();if(!reader)return reply({error:'Image manquante.'},400);const chunks:Uint8Array[]=[];let size=0;
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();return reply({error:'Maximum 15 Mo.'},413)}chunks.push(value)}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    const type=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':null;
    if(!type)return reply({error:'Le programme doit être une image JPEG ou PNG.'},400);
    const key='current/'+crypto.randomUUID()+(type==='image/png'?'.png':'.jpg');must(await db.storage.from('hdq-programmes').upload(key,bytes,{contentType:type,upsert:false}));
    const old=s.data.scan?.key;s.data.scan={key,type,updatedAt:Date.now()};s.data.crops={};s.data.sections={};
    if(!await commit(s.revision,s.data)){await db.storage.from('hdq-programmes').remove([key]);return reply({error:'La ronde a changé pendant l’importation. Réessayez.'},409)}
    if(old)await db.storage.from('hdq-programmes').remove([old]);return reply(await snapshot(email,user.id,!!membership[0].is_owner));
   }
   if(request.method!=='POST')return reply({error:'Action inconnue.'},404);
   if(Number(request.headers.get('content-length')||0)>100000)return reply({error:'Requête trop grande.'},413);
   const raw=await request.text();if(raw.length>100000)return reply({error:'Requête trop grande.'},413);let body:any;try{body=JSON.parse(raw)}catch{return reply({error:'Requête invalide.'},400)}
   if(action==='subscribe'){
    const sub=body.subscription;if(!sub||typeof sub.endpoint!=='string'||!validPushEndpoint(sub.endpoint)||!/^[-_A-Za-z0-9]{80,100}$/.test(sub.keys?.p256dh||'')||!/^[-_A-Za-z0-9]{20,30}$/.test(sub.keys?.auth||''))return reply({error:'Abonnement aux notifications invalide.'},400);
    const existing=must(await db.from('hdq_subscriptions').select('endpoint').eq('email',email));if(existing.length>=5&&!existing.some((x:any)=>x.endpoint===sub.endpoint))return reply({error:'Maximum cinq appareils par personne.'},400);
    must(await db.from('hdq_subscriptions').upsert({endpoint:sub.endpoint,email,payload:{endpoint:sub.endpoint,expirationTime:sub.expirationTime||null,keys:sub.keys}},{onConflict:'endpoint'}));return reply({ok:true});
   }
   if(action==='unsubscribe'){if(typeof body.endpoint!=='string')return reply({error:'Abonnement invalide.'},400);must(await db.from('hdq_subscriptions').delete().eq('endpoint',body.endpoint).eq('email',email));return reply({ok:true});}
   if(action==='read'){
    if(typeof body.id!=='string'||body.id.length>150)return reply({error:'Notification invalide.'},400);must(await db.from('hdq_notifications').update({read:true}).eq('id',body.id).eq('email',email));return reply({ok:true});
   }
   if(action==='mail-config'){
    if(!membership[0].is_owner)return reply({error:'La connexion Brevo est réservée au propriétaire de l’application.'},403);
    const valid=(email:unknown)=>typeof email==='string'&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if(!valid(body.senderEmail)||typeof body.senderName!=='string'||body.senderName.length>100||typeof body.apiKey!=='string'||body.apiKey.length>512)return reply({error:'Paramètres Brevo invalides.'},400);
    for(const field of ['to','cc','fullTo','fullCc'])if(!Array.isArray(body[field])||body[field].length>20||body[field].some((e:unknown)=>!valid(e)))return reply({error:'Liste de destinataires invalide.'},400);
    if(!body.to.length||!body.fullTo.length)return reply({error:'Indiquez un destinataire pour chaque PDF.'},400);
    const previous=await mailSettings();const value={apiKey:body.apiKey||previous.apiKey,senderEmail:body.senderEmail,senderName:body.senderName,to:body.to,cc:body.cc,fullTo:body.fullTo,fullCc:body.fullCc};
    if(!value.apiKey)return reply({error:'Renseignez la clé API Brevo.'},400);
    must(await db.from('hdq_runtime').upsert({id:'mail',value},{onConflict:'id'}));return reply({ok:true});
   }
   if(action==='email'){
    const mail=await mailSettings();const s=await state();if(s.data.testMode){mail.to=[s.data.testRecipient!];mail.cc=[];mail.fullTo=[s.data.testRecipient!];mail.fullCc=[]}if(!s.data.roundStart||s.data.roundOwner!==email)return reply({error:'Seul le responsable de la ronde peut envoyer les PDF.'},403);
    if(nextChooser(s.data))return reply({error:'Attendez la fin des choix avant d’envoyer les PDF.'},409);
    if(!mail.apiKey||!mail.senderEmail||!mail.to.length||!mail.fullTo.length)return reply({error:'Brevo doit être configuré côté serveur avant l’envoi. Les PDF peuvent déjà être téléchargés.'},503);
    const id=s.data.roundId+'-'+s.revision;const last=must(await db.from('hdq_deliveries').select('id,status,created_at,detail').order('created_at',{ascending:false}).limit(1));
    if(last[0]?.id===id&&last[0]?.status==='sent')return reply({error:'Ces PDF ont déjà été envoyés.'},409);
    if(last[0]&&Date.now()-Date.parse(last[0].created_at)<60000)return reply({error:'Attendez une minute avant un nouvel envoi.'},429);
    const retryTest = s.data.testMode && last[0]?.id === id &&
      last[0].status === 'needs-review' && last[0].detail?.sent === 0;
    const lock = retryTest
      ? await db.from('hdq_deliveries').update({status:'sending',created_at:new Date().toISOString()})
          .eq('id',id).eq('status','needs-review').select('id').maybeSingle()
      : await db.from('hdq_deliveries').insert({id,status:'sending'});
    if(lock.error || (retryTest && !lock.data))
      return reply({error:'Cet envoi est déjà en cours ou nécessite une vérification.'},409);
    const summary=await makePdf(s.data,false);let image:Uint8Array|undefined;if(s.data.scan)image=new Uint8Array(await must(await db.storage.from('hdq-programmes').download(s.data.scan.key)).arrayBuffer());const full=await makePdf(s.data,true,image);
    const content=(bytes:Uint8Array)=>{let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out)};
    const recipients=[{to:mail.to,cc:mail.cc,bytes:summary,label:''},{to:mail.fullTo,cc:mail.fullCc,bytes:full,label:' (COMPLET)'}];
    let sent=0;let refusal='';try{for(const r of recipients){const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':mail.apiKey,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:mail.senderEmail,name:mail.senderName||'Anesthésiologie HDQ'},to:r.to.map((email:string)=>({email})),cc:r.cc.map((email:string)=>({email})),subject:(s.data.testMode?'ESSAI — ':'')+'Planification des effectifs – Anesthésiologie – '+s.data.date+r.label,textContent:'Bonjour,\n\nVeuillez trouver ci-joint la planification des effectifs en anesthésiologie pour le '+s.data.date+'.\n\nService d’Anesthésiologie – Hôtel-Dieu de Québec',attachment:[{content:content(r.bytes),name:'HDQ_'+s.data.date+(r.label?'_complet':'')+'.pdf'}],headers:{'idempotencyKey':id+'-'+sent}}),signal:AbortSignal.timeout(15000)});if(!response.ok){
      const problem=await response.json().catch(()=>({}));
      const description=String(problem?.message||'');
      if (/sender|expéditeur/i.test(description)) {
       refusal='Brevo a refusé l’adresse d’expéditeur. Vérifiez-la dans Brevo.';
      } else if (response.status===401 || response.status===403) {
       refusal='Brevo a refusé la connexion. Vérifiez que la clé API autorise l’envoi de courriels transactionnels.';
      } else {
       refusal='Brevo a refusé l’envoi (code '+response.status+').';
      }
      throw Error('Email request failed');
    }sent++;await db.from('hdq_deliveries').update({detail:{sent}}).eq('id',id)}await db.from('hdq_deliveries').update({status:'sent'}).eq('id',id);return reply({ok:true,sent})}catch{await db.from('hdq_deliveries').update({status:'needs-review',detail:{sent}}).eq('id',id);return reply({error:(refusal?refusal+' ':'')+'Envois confirmés : '+sent+'/2. Vérifiez Brevo avant de réessayer.'},502)}
   }
   const s=await state();if(body.revision!==s.revision)return reply({error:'La ronde a changé. Actualisez et réessayez.'},409);
   if(s.data.testMode&&s.data.testRecipient!==email)return reply({error:'Cet essai est réservé au coordonnateur.'},403);if(body.action==='prepare'&&typeof body.setup?.testMode==='boolean'&&body.setup.testMode!==!!s.data.testMode&&!membership[0].is_owner)return reply({error:'Seul le propriétaire peut changer le mode essai.'},403);
   const result=transition(s.data,body,email);const oldNext=nextChooser(s.data),next=nextChooser(result.data);const reset=body.action==='reset';
   if(!await commit(s.revision,result.data,result.events,oldNext!==next||reset||body.action==='start',reset))return reply({error:'Un autre choix vient d’être enregistré. Actualisez et réessayez.'},409);
   if(reset&&s.data.scan)await db.storage.from('hdq-programmes').remove([s.data.scan.key]);
   await dispatch(result.events);return reply(await snapshot(email,user.id,!!membership[0].is_owner));
  }catch(error){if(error instanceof RoundError)return reply({error:error.message},error.status);console.error('HDQ operation failed',error instanceof Error?error.name:'error');return reply({error:'Impossible de terminer cette action. Actualisez avant de réessayer.'},503)}
 };
}
