import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import fs from 'node:fs';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
function load(file,deps={}){const e={};new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>deps[n]||require(n),e);return e}
const model=load('server/model.ts'),{transition}=load('server/round.ts',{'./model.ts':model}),leader='responsable@example.invalid';
function sample(){const d=model.initial();d.directory=Array.from({length:5},(_,i)=>({id:'p'+i,name:'Médecin '+i,email:'p'+i+'@example.invalid'}));d.ranks=Array.from({length:14},(_,i)=>({personId:i<3?'p'+i:'',note:i===1?'Absent':''}));d.scan={key:'synthetic.jpg',type:'image/jpeg',updatedAt:1};return d}
const go=(d,body,email=leader,now=100000)=>transition(d,{revision:0,...body},email,now,crypto.randomUUID());
test('14 rangs manuels, exclusions, appel clinique hors rangs',()=>{let d=sample();let r=go(d,{action:'start'});assert.equal(r.data.roundOwner,leader);assert.equal(model.nextChooser(r.data),'p0');assert.equal(r.events.filter(e=>e.kind==='clinic').length,2);assert.deepEqual(r.events.filter(e=>e.kind==='clinic').map(e=>e.email),['p3@example.invalid','p4@example.invalid']);for(const note of ['Absent','académique','administratif','CMS']){d.ranks[0].note=note;assert.equal(model.nextChooser(d),'p2')}});
test('choix exclusivement au tour et par la bonne personne',()=>{const d=go(sample(),{action:'start'}).data;assert.throws(()=>go(d,{action:'choice',room:'08',personId:'p2'},'p2@example.invalid'),/attendre/);assert.throws(()=>go(d,{action:'choice',room:'08',personId:'p0'},'p2@example.invalid'),/votre tour/);const r=go(d,{action:'choice',room:'08',personId:'p0'},'p0@example.invalid',115000);assert.equal(r.data.assignments['08'],'p0');assert.equal(r.data.delays.p0,15000);assert.equal(model.nextChooser(r.data),'p2');assert.equal(r.events.find(e=>e.kind==='turn').email,'p2@example.invalid')});
test('choix délégué au responsable, trace et notification',()=>{const d=go(sample(),{action:'start'}).data;assert.throws(()=>go(d,{action:'choice',room:'08',personId:'p0',delegated:true},'p2@example.invalid'),/Seule/);const r=go(d,{action:'choice',room:'08',personId:'p0',delegated:true},leader,120000);assert.equal(r.data.audit[0].delegated,true);assert.equal(r.data.audit[0].actor,leader);assert.ok(r.events.find(e=>e.kind==='assignment').body.includes('responsable'));assert.throws(()=>go(r.data,{action:'choice',room:'08',personId:'p2'},'p2@example.invalid'),/déjà/)});
test('double affectation et clinique ouverte sans appel',()=>{let d=sample(),settings={date:d.date,directory:d.directory,ranks:d.ranks,openRooms:d.openRooms,roles:{garde:'p0',veineux:'p0',hbo:'p2',preop:'p0'},clinicOpen:true};d=go(d,{action:'prepare',setup:settings}).data;assert.equal(d.roles.garde,d.roles.veineux);const r=go(d,{action:'start'});assert.equal(model.nextChooser(r.data),'p0');assert.equal(r.events.filter(e=>e.kind==='clinic').length,0)});
test('correction réservée au responsable et retour au bon rang',()=>{let d=go(sample(),{action:'start'}).data;d=go(d,{action:'choice',room:'08',personId:'p0'},'p0@example.invalid').data;assert.throws(()=>go(d,{action:'correct',room:'08',personId:''},'p2@example.invalid'),/réservée/);const r=go(d,{action:'correct',room:'08',personId:''});assert.equal(model.nextChooser(r.data),'p0');assert.ok(r.events.some(e=>e.kind==='turn'&&e.email==='p0@example.invalid'))});
test('nouvelle ronde efface tout sauf le répertoire général',()=>{let d=go(sample(),{action:'start'}).data;d=go(d,{action:'choice',room:'08',personId:'p0'},'p0@example.invalid').data;d.crops['08']=[0,.2];const r=go(d,{action:'reset'});assert.equal(r.data.scan,null);assert.deepEqual(r.data.assignments,{});assert.deepEqual(r.data.crops,{});assert.equal(r.data.ranks.filter(x=>x.personId).length,0);assert.equal(r.data.roundStart,0);assert.equal(r.data.directory.length,5);assert.equal(r.events[0].badge,0)});
test('préparation invalide, adresses manquantes et double démarrage refusés',()=>{let d=sample();d.directory[0].email='';assert.throws(()=>go(d,{action:'start'}),/adresses/);d=go(sample(),{action:'start'}).data;assert.throws(()=>go(d,{action:'start'}),/déjà/);assert.throws(()=>go(d,{action:'prepare',setup:{}}),/invalides/)});
test('CIC facultative, 1F exclue, aucun changement du document source',()=>{let d=sample();assert.ok(!model.ROOM_IDS.includes('1F'));d.openRooms.push('CIC');d=go(d,{action:'start'}).data;const before=structuredClone(d);const r=go(d,{action:'choice',room:'CIC',personId:'p0'},'p0@example.invalid');assert.equal(r.data.assignments.CIC,'p0');assert.deepEqual(d,before)});
test('essai : tous les tours simulables par le responsable, notifications uniquement à lui',()=>{let d=sample();d.testMode=true;d.testRecipient=leader;d.directory.forEach(p=>p.email='');let r=go(d,{action:'start'});assert.ok(r.events.length>=1);assert.ok(r.events.every(e=>e.email===leader));d=r.data;r=go(d,{action:'choice',room:'08',personId:'p0'});assert.equal(r.data.assignments['08'],'p0');assert.ok(r.events.every(e=>e.email===leader));assert.equal(r.events.filter(e=>e.kind==='turn').length,1);assert.throws(()=>go(r.data,{action:'choice',room:'11',personId:'p2'},'colleague@example.invalid'),/responsable/);const reset=go(r.data,{action:'reset'}).data;assert.equal(reset.testMode,true);assert.equal(reset.testRecipient,leader)});
test('le coordonnateur reçoit le suivi en mode équipe',()=>{let d=go(sample(),{action:'start'}).data;let r=go(d,{action:'choice',room:'08',personId:'p0'},'p0@example.invalid');assert.ok(r.events.some(e=>e.kind==='progress'&&e.email===leader&&e.body.includes('p2')===false));assert.ok(r.events.some(e=>e.kind==='turn'&&e.email==='p2@example.invalid'))});
test('sections multiples CIC partagées, anciennes découpes protégées et scan vérifié',()=>{let d=sample();let r=go(d,{action:'sections',scanId:'synthetic.jpg',sections:{CIC:[[.1,.2],[.5,.7]],'08':[[.2,.5]]}});assert.equal(r.data.sections.CIC.length,2);assert.deepEqual(r.data.crops.CIC,[.1,.2]);assert.throws(()=>go(r.data,{action:'crop',room:'CIC',scanId:'synthetic.jpg',crop:[.1,.7]}),/fusionnée/);assert.throws(()=>go(r.data,{action:'roomSections',room:'CIC',scanId:'old.jpg',sections:[[.1,.2]]}),/remplacé/);assert.throws(()=>go(d,{action:'sections',scanId:'synthetic.jpg',sections:{CIC:[[.8,.2]]}}),/invalides/)});
test('le repérage ouvre CIC et retire les salles absentes sans toucher aux rangs',()=>{const d=sample(),ranks=structuredClone(d.ranks);assert.equal(d.openRooms.includes('CIC'),false);const r=go(d,{action:'sections',scanId:'synthetic.jpg',sections:{'08':[[.1,.3]],CIC:[[.3,.6],[.6,.9]]}});assert.deepEqual(r.data.openRooms,['08','CIC']);assert.equal(r.data.scan.roomDetectionDone,true);assert.deepEqual(r.data.ranks,ranks);assert.equal(r.data.sections.CIC.length,2)});
test('clinique ouverte : un choix de rang, un seul titulaire et passage au suivant',()=>{let d=sample();d.clinicOpen=true;d=go(d,{action:'start'}).data;let r=go(d,{action:'choice',room:'PREOP',personId:'p0'},'p0@example.invalid');assert.equal(r.data.assignments.PREOP,'p0');assert.equal(r.data.roles.preop,'p0');assert.equal(model.nextChooser(r.data),'p2');assert.throws(()=>go(r.data,{action:'choice',room:'PREOP',personId:'p2'},'p2@example.invalid'),/déjà/);assert.equal(model.choiceLabel('PREOP'),'Clinique préop')});
test('clinique fermée exclue du choix; la correction de sa réservation rend son tour',()=>{let d=go(sample(),{action:'start'}).data;assert.throws(()=>go(d,{action:'choice',room:'PREOP',personId:'p0'},'p0@example.invalid'),/pas ouverte/);d.clinicOpen=true;d=go(d,{action:'choice',room:'PREOP',personId:'p0'},'p0@example.invalid').data;const r=go(d,{action:'correct',room:'PREOP',personId:''});assert.equal(r.data.roles.preop,'');assert.equal(model.nextChooser(r.data),'p0')});
test('la clinique compte comme une place supplémentaire, sans section OCR',()=>{const d=sample();d.openRooms=['08'];d.clinicOpen=true;assert.deepEqual(model.availableChoices(d),['08','PREOP']);const r=go(d,{action:'start'});assert.ok(r.data.roundStart);assert.equal(r.events.some(e=>e.kind==='clinic'),false)});

test('la dernière salle est attribuée et annoncée sans tour supplémentaire',()=>{
  const d=sample();
  d.openRooms=['08','11'];
  const started=go(d,{action:'start'}).data;
  const result=go(started,{action:'choice',room:'08',personId:'p0'},'p0@example.invalid');
  assert.deepEqual(result.data.assignments,{'08':'p0','11':'p2'});
  assert.equal(model.nextChooser(result.data),null);
  assert.equal(result.data.audit.at(-1).automatic,true);
  assert.ok(result.events.some(e=>e.email==='p2@example.invalid'&&e.kind==='assignment'&&e.body.includes('Salle 11')&&e.badge===0));
  assert.ok(!result.events.some(e=>e.kind==='turn'));
});

test('le dernier participant choisit encore si plusieurs salles restent ouvertes',()=>{
  const d=sample();
  d.openRooms=['08','11','28'];
  const started=go(d,{action:'start'}).data;
  const result=go(started,{action:'choice',room:'08',personId:'p0'},'p0@example.invalid');
  assert.equal(model.nextChooser(result.data),'p2');
  assert.deepEqual(result.data.assignments,{'08':'p0'});
  assert.ok(result.events.some(e=>e.email==='p2@example.invalid'&&e.kind==='turn'));
});

test('une seule affectation possible à l’ouverture fonctionne aussi en essai',()=>{
  const d=sample();
  d.openRooms=[];
  d.clinicOpen=true;
  d.ranks[2].note='Absent';
  d.testMode=true;
  d.testRecipient=leader;
  const result=go(d,{action:'start'});
  assert.equal(result.data.assignments.PREOP,'p0');
  assert.equal(result.data.roles.preop,'p0');
  assert.equal(model.nextChooser(result.data),null);
  assert.ok(result.events.some(e=>e.kind==='assignment'&&e.body.includes('Clinique préop')));
  assert.ok(result.events.every(e=>e.email===leader));
});
