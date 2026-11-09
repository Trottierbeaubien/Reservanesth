export const ROOM_IDS=['08','09','11','28','30','34','40','42','46','48','CIC'];
export const CHOICE_IDS=[...ROOM_IDS,'PREOP'];
export function choiceLabel(id:string){return id==='PREOP'?'Clinique préop':id==='CIC'?'CIC — Curiethérapie':'Salle '+Number(id)}
export const NOTES=['','Absent','académique','administratif','CMS'];
export type Person={id:string,name:string,email:string};
export type Rank={personId:string,note:string};
export type Programme={schemaVersion:2,date:string,directory:Person[],ranks:Rank[],openRooms:string[],roles:Record<string,string>,clinicOpen:boolean,assignments:Record<string,string>,crops:Record<string,[number,number]>,sections?:Record<string,[number,number][]>,testMode?:boolean,testRecipient?:string,scan:null|{key:string,type:string,updatedAt:number,roomDetectionDone?:boolean,roomDetectionVersion?:number,hpRooms?:string[],residents?:Record<string,string[]>,verifiedSections?:Record<string,[number,number][]>},roundStart:number,lastChoice:number,roundOwner:string,roundId:string,delays:Record<string,number>,audit:{at:number,actor:string,personId:string,room:string,delegated:boolean,automatic?:boolean}[],lastReminder:number,lastMutationId:string,previousDemoAssignments?:unknown};
export function initial():Programme{
 return {schemaVersion:2,date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000)),directory:[],ranks:Array.from({length:14},()=>({personId:'',note:''})),openRooms:ROOM_IDS.filter(r=>!['09','CIC'].includes(r)),roles:{garde:'',veineux:'',hbo:'',preop:''},clinicOpen:false,assignments:{},crops:{},scan:null,roundStart:0,lastChoice:0,roundOwner:'',roundId:'',delays:{},audit:[],lastReminder:0,lastMutationId:''};
}
export function normalize(data:any):Programme{
 if(data?.schemaVersion===2)return data;
 return {...initial(),scan:data?.scan||null,crops:data?.crops||{},previousDemoAssignments:data?.assignments||{}};
}
export function nextChooser(d:Programme){return d.ranks.find(r=>r.personId&&!r.note&&!Object.values(d.assignments).includes(r.personId))?.personId||null}
export function person(d:Programme,id:string){return d.directory.find(p=>p.id===id)}
export function canManage(d:Programme,email:string){return !d.roundStart||d.roundOwner===email}
export function eligible(d:Programme){return d.ranks.filter(r=>r.personId&&!r.note).map(r=>r.personId)}

const nameCollator=new Intl.Collator('fr-CA',{sensitivity:'base',numeric:true});
export function personLabel(p:{name:string}){const words=p.name.trim().split(/\s+/);return words.length>1?words.at(-1)+', '+words.slice(0,-1).join(' '):p.name}
export function sortDirectory<T extends {name:string}>(people:T[]):T[]{return people.slice().sort((a,b)=>!a.name.trim()?1:!b.name.trim()?-1:nameCollator.compare(personLabel(a),personLabel(b)))}

export function availableChoices(d:Programme){return [...d.openRooms.filter(id=>ROOM_IDS.includes(id)),...(d.clinicOpen?['PREOP']:[])]}
