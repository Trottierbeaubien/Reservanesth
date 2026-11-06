import {z} from 'zod';
import {initial,ROOM_IDS,NOTES,canManage,nextChooser,person,eligible,type Programme} from './model.ts';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const address=z.union([z.literal(''),z.string().email().max(254)]);
const setup=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),directory:z.array(z.object({id,name:z.string().trim().min(1).max(100),email:address})).min(1).max(100),ranks:z.array(z.object({personId:z.string().max(80),note:z.enum(['','Absent','académique','administratif','CMS'])})).length(14),openRooms:z.array(z.enum(['08','09','11','28','30','34','40','42','46','48','CIC'])).min(1).max(11),roles:z.object({garde:z.string(),veineux:z.string(),hbo:z.string(),preop:z.string()}),clinicOpen:z.boolean()});
export const actionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare'),revision:z.number().int(),setup}),
 z.object({action:z.literal('start'),revision:z.number().int()}),
 z.object({action:z.literal('choice'),revision:z.number().int(),room:z.string(),personId:id,delegated:z.boolean().default(false)}),
 z.object({action:z.literal('correct'),revision:z.number().int(),room:z.string(),personId:z.string().max(80)}),
 z.object({action:z.literal('crop'),revision:z.number().int(),room:z.string(),crop:z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)]),scanId:z.string()}),
 z.object({action:z.literal('reset'),revision:z.number().int()}),
 z.object({action:z.literal('remind'),revision:z.number().int()}),
]);
export class RoundError extends Error{constructor(message:string,public status=400){super(message)}}
export type Event={id:string,email:string,kind:'turn'|'assignment'|'clinic',title:string,body:string,roundId:string,createdAt:number,badge:number,revision:number};
function fail(message:string,status=400):never{throw new RoundError(message,status)}
export function transition(current:Programme,raw:unknown,email:string,now=Date.now(),mutationId=crypto.randomUUID()):{data:Programme,events:Event[]}{
 const parsed=actionSchema.safeParse(raw);if(!parsed.success)fail('Données invalides. Vérifiez la préparation de la journée.');
 const body=parsed.data,d=structuredClone(current),events:Event[]=[];const previous=nextChooser(d),revision=body.revision+1;
 const event=(recipient:string,kind:Event['kind'],title:string,message:string,badge=0)=>{if(recipient)events.push({id:mutationId+'-'+events.length,email:recipient,kind,title,body:message,roundId:d.roundId,createdAt:now,badge,revision})};
 const manager=()=>{if(!canManage(d,email))fail('Cette action est réservée à la personne qui a démarré la ronde.',403)};
 if(body.action==='prepare'){
  if(d.roundStart)fail('La ronde est démarrée. Terminez-la ou ouvrez une nouvelle sélection avant de modifier les rangs.',409);
  const s=body.setup,ids=s.directory.map(p=>p.id),emails=s.directory.map(p=>p.email.toLowerCase()).filter(Boolean),names=s.directory.map(p=>p.name.toLowerCase());
  if(new Set(ids).size!==ids.length||new Set(emails).size!==emails.length||new Set(names).size!==names.length)fail('Chaque membre doit avoir un nom, un identifiant et une adresse uniques.');
  const ranked=s.ranks.map(r=>r.personId).filter(Boolean);
  if(new Set(ranked).size!==ranked.length)fail('Une personne ne peut figurer qu’une seule fois dans les rangs.');
  if(ranked.some(p=>!ids.includes(p))||Object.values(s.roles).some(p=>p&&!ids.includes(p)))fail('Une affectation désigne une personne absente de la liste d’équipe.');
  const day=new Date(s.date+'T12:00:00Z');if(Number.isNaN(day.valueOf())||day.toISOString().slice(0,10)!==s.date)fail('La date est invalide.');
  Object.assign(d,s,{directory:s.directory.map(p=>({...p,email:p.email.toLowerCase()})),openRooms:[...new Set(s.openRooms)],assignments:{},delays:{},audit:[],roundOwner:'',roundId:'',roundStart:0,lastChoice:0});
  if(!s.clinicOpen)d.roles.preop='';
 }else if(body.action==='start'){
  if(d.roundStart)fail('La ronde a déjà été démarrée.',409);
  if(!d.scan)fail('Ajoutez le programme avant de démarrer la ronde.');
  const active=eligible(d);if(!active.length)fail('Ajoutez au moins une personne sans note dans les rangs.');
  if(active.length>d.openRooms.length)fail('Il y a plus de personnes à choisir que de salles ouvertes. Vérifiez les rangs et les salles.');
  const requiredEmails=d.clinicOpen?active:d.directory.map(p=>p.id);const missing=requiredEmails.filter(id=>!person(d,id)?.email);if(missing.length)fail('Complétez les adresses de connexion nécessaires aux choix et à l’appel clinique avant de démarrer.');
  d.roundOwner=email;d.roundId=mutationId;d.roundStart=now;d.lastChoice=now;d.assignments={};d.delays={};d.audit=[];
  if(!d.clinicOpen){const ranked=new Set(d.ranks.map(r=>r.personId));for(const p of d.directory)if(!ranked.has(p.id))event(p.email,'clinic','Clinique préop — volontaires','La clinique préop n’est pas ouverte pour le '+d.date+'. Si vous souhaitez la faire, répondez par texto au groupe. Premier arrivé, premier servi; aucun choix dans l’application.');}
 }else if(body.action==='choice'){
  if(!d.roundStart)fail('La ronde n’est pas encore démarrée.',409);
  if(!d.openRooms.includes(body.room))fail('Cette salle n’est pas ouverte.');
  if(d.assignments[body.room])fail('Cette salle vient déjà d’être choisie.',409);
  if(body.personId!==previous)fail('Il faut attendre le tour de cette personne.',409);
  const target=person(d,body.personId)!;
  if(body.delegated){if(d.roundOwner!==email)fail('Seule la personne qui a démarré la ronde peut choisir pour un collègue.',403)}
  else if(target.email!==email)fail('Ce n’est pas votre tour. Le responsable peut choisir pour le collègue injoignable.',403);
  d.assignments[body.room]=body.personId;d.delays[body.personId]=Math.max(0,now-d.lastChoice);d.lastChoice=now;
  d.audit.push({at:now,actor:email,personId:body.personId,room:body.room,delegated:body.delegated});
  event(target.email,'assignment','Votre affectation est confirmée',body.delegated?'Le responsable a choisi la salle '+body.room+' pour vous. Consultez l’application pour le détail.':'Votre choix de la salle '+body.room+' est enregistré.');
 }else if(body.action==='correct'){
  if(!d.roundStart)fail('La ronde n’est pas encore démarrée.',409);manager();
  if(!ROOM_IDS.includes(body.room))fail('Salle invalide.');
  if(body.personId&&(!d.openRooms.includes(body.room)||!eligible(d).includes(body.personId)))fail('Choisissez une personne active dans les rangs et une salle ouverte.');
  if(body.personId&&Object.entries(d.assignments).some(([room,p])=>room!==body.room&&p===body.personId))fail('Cette personne a déjà une salle.',409);
  const old=d.assignments[body.room];if(old)delete d.delays[old];
  if(body.personId){d.assignments[body.room]=body.personId;event(person(d,body.personId)!.email,'assignment','Affectation corrigée','Le responsable vous a affecté à la salle '+body.room+'.');}else delete d.assignments[body.room];
  if(old&&old!==body.personId)event(person(d,old)?.email||'','assignment','Affectation corrigée','Le responsable a retiré votre affectation à la salle '+body.room+'. Consultez la ronde.');
  d.audit.push({at:now,actor:email,personId:body.personId,room:body.room,delegated:true});d.lastChoice=now;
 }else if(body.action==='crop'){
  manager();if(!d.scan||body.scanId!==d.scan.key||!ROOM_IDS.includes(body.room)||body.crop[1]-body.crop[0]<.001)fail('Repères invalides ou programme remplacé.');d.crops[body.room]=body.crop;
 }else if(body.action==='reset'){
  manager();if(previous&&d.roundStart)event(person(d,previous)?.email||'','assignment','Nouvelle ronde','La ronde précédente est terminée. Votre choix précédent n’est plus en attente.');const directory=d.directory;Object.assign(d,initial(),{directory});
 }else if(body.action==='remind'){
  manager();if(!d.roundStart||!previous)fail('Aucun choix en attente.');if(now-d.lastReminder<60000)fail('Attendez une minute avant de relancer la notification.',429);d.lastReminder=now;
 }
 const next=nextChooser(d);
 if(d.roundStart&&next&&(body.action==='start'||body.action==='remind'||next!==previous))event(person(d,next)!.email,'turn','C’est à votre tour','Choisissez votre salle pour le '+d.date+'.',1);
 d.lastMutationId=mutationId;return {data:d,events};
}
