import test from 'node:test';import assert from 'node:assert/strict';import {detectedSections,parseHeading,sectionsFor} from '../web/scan-sections.js';import fs from 'node:fs';import ts from 'typescript';
const exports={};new Function('exports',ts.transpileModule(fs.readFileSync('server/model.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports);
const line=(text,y0,y1=y0+20)=>({text,bbox:{x0:10,x1:300,y0,y1},confidence:95});
test('tri français par nom de famille sans changer les rangs ni les objets',()=>{let team=[{id:'1',name:'Samuel Tétreault'},{id:'2',name:'Jean Beaubien'},{id:'3',name:'Éric Camiré'},{id:'4',name:'Myriam Boivin'},{id:'5',name:'Nicolas Côte'}];let saved=structuredClone(team);assert.deepEqual(exports.sortDirectory(team).map(p=>p.name),['Jean Beaubien','Myriam Boivin','Éric Camiré','Nicolas Côte','Samuel Tétreault']);assert.deepEqual(team,saved);assert.equal(exports.personLabel(team[1]),'Beaubien, Jean')});
test('en-têtes accentués, 08/O8 et C regroupés, IF exclu',()=>{assert.equal(parseHeading('SALLE NUMÉRO 08').room,'08');assert.equal(parseHeading('SALLE NUMERO O8').room,'08');assert.equal(parseHeading('SALLE NUMÉRO C').room,'CIC');assert.equal(parseHeading('SALLE NUMÉRO C2').room,'CIC');assert.equal(parseHeading('SALLE NUMERO IF').room,null);assert.equal(parseHeading('Commentaire : salle 8'),null)});
test('chaque bande commence à son en-tête et s’arrête au suivant, y compris IF',()=>{const r=detectedSections([line('SALLE NUMÉRO 08',100),line('SALLE NUMÉRO 48',500),line('SALLE NUMÉRO IF',800)],1000);assert.ok(r.sections['08'][0][0]<.1);assert.equal(r.sections['08'][0][1],r.sections['48'][0][0]);assert.ok(r.sections['48'][0][1]<.8);assert.equal(Object.keys(r.sections).length,2)});
test('toutes les sections C sont réunies sans inclure les salles intercalées',()=>{const r=detectedSections([line('SALLE NUMÉRO C',100),line('SALLE NUMÉRO 08',300),line('SALLE NUMÉRO C',600),line('SALLE NUMÉRO C1',800)],1000);assert.equal(r.sections.CIC.length,3);assert.ok(r.sections.CIC[0][1]<.3);assert.ok(r.sections.CIC[1][0]>.5);assert.equal(r.sections.CIC[2][1],1);assert.equal(sectionsFor(r.sections,{},'CIC').length,3)});
test('aucune division arbitraire si une salle n’a pas été repérée',()=>{assert.deepEqual(sectionsFor({}, {},'40'),[]);assert.deepEqual(sectionsFor({}, {'40':[.2,.4]},'40'),[[.2,.4]])});

test('repérage automatique du scan déjà chargé, même avec des sections partielles',async()=>{const {needsAutomaticRoomDetection}=await import('../web/scan-auto.js');const data={scan:{key:'current.jpg'},sections:{'08':[[0,.1]]}};const attempted=new Set();assert.equal(needsAutomaticRoomDetection(data,true,attempted),true);assert.equal(needsAutomaticRoomDetection(data,false,attempted),false);attempted.add('current.jpg');assert.equal(needsAutomaticRoomDetection(data,true,attempted),false);data.scan={key:'new.jpg'};assert.equal(needsAutomaticRoomDetection(data,true,attempted),true);data.scan.roomDetectionDone=true;assert.equal(needsAutomaticRoomDetection(data,true,attempted),true);data.scan.roomDetectionVersion=2;assert.equal(needsAutomaticRoomDetection(data,true,attempted),false)});
test('C2 et C3 font deux bandes de la même salle CIC',()=>{const r=detectedSections([line('SALLE NUMÉRO 08',100),line('SALLE NUMÉRO C2',300),line('SALLE NUMÉRO C3',700)],1000);assert.equal(r.sections.CIC.length,2);assert.equal(Object.keys(r.sections).length,2)});
test('les deux lectures du même en-tête ne créent pas deux bandes',()=>{const r=detectedSections([line('SALLE NUMÉRO C2',300,325),{...line('SALLE NUMÉRO C2',303,323),confidence:99},line('SALLE NUMÉRO 08',600)],1000);assert.equal(r.sections.CIC.length,1);assert.equal(r.headings.length,2)});

test('C1 relue comme CI se fusionne avec C2 sous CIC',()=>{
  const sections=detectedSections([line('SALLE NUMÉRO CI',100),line('SALLE NUMÉRO C2',450)],1000).sections;
  assert.equal(sections.CIC.length,2);
});

test('un en-tête C1 mal lu est relu et fusionné avec le bloc C2',async()=>{
  const {retryUncertainHeadings}=await import('../web/scan-heading-retry.js');
  const lines=[line('SALLE NUMÉRO 48',700),line('SALLE NUMÉRO 01',810),line('SALLE NUMÉRO C2',900)];
  const savedDocument=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({drawImage(){}})})};
  try {
    const worker={setParameters:async()=>{},recognize:async()=>({data:{text:'SALLE NUMERO C1',confidence:94}})};
    await retryUncertainHeadings(worker,{width:1000,height:1000},lines,1000,1000,7);
    assert.equal(detectedSections(lines,1000).sections.CIC.length,2);
  } finally {
    globalThis.document=savedDocument;
  }
});

test('le titre Curiethérapie identifie une salle dont le numéro est mal lu',()=>{
  assert.equal(parseHeading('SALLE NUMÉRO 01 CURIETHÉRAPIE I').room,'CIC');
});

test('les badges de formation acceptent les mentions sur la même ligne que du texte',async()=>{
  const {residentLabels}=await import('../web/scan-residents.js');
  assert.deepEqual(residentLabels([
    {text:'Annotation R1',confidence:78},
    {text:'RS',confidence:62},
    {text:'EXT.',confidence:76},
    {text:'R3',confidence:20},
  ]),['EXT','R1','R5']);
});
