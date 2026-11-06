import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {ROOM_IDS,person,type Programme} from './model.ts';
const safe=(s:unknown)=>String(s??'').replace(/\u202f|\u00a0/g,' ').replace(/[‐‑–—]/g,'-').replace(/[’‘]/g,"'").replace(/[^\x20-\x7e\xa0-\xff]/g,'');
const delay=(ms:number|undefined)=>ms===undefined?'':Math.floor(ms/3600000)+':'+String(Math.floor(ms/60000)%60).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0');
export async function makePdf(d:Programme,full:boolean,scan?:Uint8Array){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);let page=doc.addPage([842,595]);
 const text=(value:unknown,x:number,y:number,size=10,heavy=false)=>page.drawText(safe(value),{x,y,size,font:heavy?bold:font,color:rgb(.08,.2,.2)});
 text('PLANIFICATION DES EFFECTIFS - ANESTHESIOLOGIE HDQ',30,560,17,true);text('Journee operatoire : '+d.date+(d.testMode?' - ESSAI DU COORDONNATEUR':''),30,536,12);
 const rowHeight=25,startY=505,cols=full?[30,115,300,350,535,690]:[30,170],headers=full?['SALLES','ANESTHESIOLOGISTES','RANG','NOM','NOTES','DELAIS']:['SALLES','ANESTHESIOLOGISTES'];
 const rows=ROOM_IDS.map(id=>({label:id==='CIC'?'CIC - Curietherapie':'Salle '+Number(id),value:d.openRooms.includes(id)?(person(d,d.assignments[id])?.name||'A determiner'):'Non ouvert'}));
 rows.push(...[{key:'preop',label:'Clinique pre-op'},{key:'hbo',label:'Hors-bloc'},{key:'veineux',label:'Acces veineux'},{key:'garde',label:'Garde'}].map(r=>({label:r.label,value:r.key==='preop'&&!d.clinicOpen?'Non ouvert':person(d,r.key==='preop'?d.assignments.PREOP:d.roles[r.key])?.name||'A determiner'})));
 headers.forEach((h,i)=>text(h,cols[i],startY,10,true));
 for(let i=0;i<rows.length;i++){const y=startY-22-i*rowHeight;page.drawLine({start:{x:30,y:y-8},end:{x:full?810:500,y:y-8},thickness:.4,color:rgb(.8,.85,.82)});text(rows[i].label,cols[0],y,9);text(rows[i].value,cols[1],y,9);if(full&&i<14){const r=d.ranks[i];text(i+1,cols[2],y,9);text(person(d,r.personId)?.name||'',cols[3],y,9);text(r.note,cols[4],y,9);text(delay(d.delays[r.personId]),cols[5],y,9)}}
 text('Genere le '+new Intl.DateTimeFormat('fr-CA',{dateStyle:'short',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date()),30,45,8);
 if(full&&scan&&d.scan){const image=d.scan.type==='image/png'?await doc.embedPng(scan):await doc.embedJpg(scan);const width=555,scale=width/image.width,totalHeight=image.height*scale,available=760;
 for(let offset=0;offset<totalHeight;offset+=available){page=doc.addPage([595,842]);const h=Math.min(available,totalHeight-offset);page.drawImage(image,{x:20,y:802-totalHeight+offset,width,height:totalHeight});page.drawRectangle({x:0,y:802,width:595,height:40,color:rgb(1,1,1)});page.drawRectangle({x:0,y:0,width:595,height:42,color:rgb(1,1,1)});page.drawText('Programme operatoire - '+d.date+' - '+(Math.floor(offset/available)+1),{x:20,y:820,size:8,font});}}
 return doc.save();
}
