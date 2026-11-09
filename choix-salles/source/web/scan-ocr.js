import {retryUncertainHeadings} from './scan-heading-retry.js';
import {readRoomResidents} from './scan-residents.js';
import {outOfProvinceRooms} from './scan-provenance.js';
import {createWorker,PSM} from 'tesseract.js';
import {detectedSections,linesFromBlocks,refineHeadingLines,ROOM_IDS} from './scan-sections.js';
export async function recogniseRoomSections(image,onProgress=()=>{},expectedRooms=ROOM_IDS){
 const stripWidth=Math.round(image.width*.36),scale=Math.min(2.5,850/stripWidth,14000/image.height);
 const canvas=document.createElement('canvas');canvas.width=Math.round(stripWidth*scale);canvas.height=Math.round(image.height*scale);
 canvas.getContext('2d').drawImage(image,0,0,stripWidth,image.height,0,0,canvas.width,canvas.height);
 // The image stays in a local web worker. Only the public engine/language files are downloaded.
 let pass=0;let tileProgress=0;const worker=await createWorker('fra',1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',langPath:'https://cdn.jsdelivr.net/npm/@tesseract.js-data/fra@1.0.0/4.0.0',logger:m=>onProgress(m.status==='recognizing text'?Math.min(100,Math.round(pass<2?pass*25+m.progress*25:pass===2?50+tileProgress*40:90+m.progress*10)):null)});
 try{
  await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
  let output=await worker.recognize(canvas,{}, {blocks:true,text:false});let lines=linesFromBlocks(output.data.blocks);
  pass=1;await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO});output=await worker.recognize(canvas,{}, {blocks:true,text:false});lines=lines.concat(linesFromBlocks(output.data.blocks));
  // Local overlapping crops keep small headings large enough on long phone scans.
  // Coordinates are mapped back into the same full-height reference as the first passes.
  pass=2;
  const sourceWidth=Math.round(image.width*.42),tileScale=Math.min(3,1200/sourceWidth),sourceHeight=Math.min(image.height,Math.round(1600/tileScale)),step=Math.max(1,Math.round(sourceHeight*.85));
  const starts=[];for(let y=0;y<image.height;y+=step){starts.push(y);if(y+sourceHeight>=image.height)break}
  const tile=document.createElement('canvas');
  await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
  for(let i=0;i<starts.length;i++){
   const y=starts[i],h=Math.min(sourceHeight,image.height-y);tile.width=Math.round(sourceWidth*tileScale);tile.height=Math.round(h*tileScale);
   tile.getContext('2d').drawImage(image,0,y,sourceWidth,h,0,0,tile.width,tile.height);
   const found=await worker.recognize(tile,{}, {blocks:true,text:false});
   for(const line of linesFromBlocks(found.data.blocks)){const b=line.bbox;if(!b)continue;lines.push({...line,bbox:{x0:b.x0/tileScale*scale,x1:b.x1/tileScale*scale,y0:(y+b.y0/tileScale)*scale,y1:(y+b.y1/tileScale)*scale}})}
   tileProgress=(i+1)/starts.length;onProgress(Math.round(50+tileProgress*40));
  }
  tile.width=tile.height=1;
  pass=3;
  await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
  await refineHeadingLines(worker,canvas,canvas.width,canvas.height,lines);
  try {
    await retryUncertainHeadings(worker,image,lines,image.width*scale,canvas.height,PSM.SINGLE_LINE,PSM.SINGLE_WORD);
  } catch {
    // The first-pass sections are still usable if an isolated heading cannot be read.
  }
  const result = detectedSections(lines,canvas.height,expectedRooms);
  let residents;
  try {
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
    residents = await readRoomResidents(worker,image,result.sections,linesFromBlocks,PSM.SINGLE_LINE,PSM.SPARSE_TEXT);
  } catch {
    // A failed annotation read must not prevent saving the room boundaries.
  }
  return {...result, residents, hpRooms: outOfProvinceRooms(lines,result.sections,image.width*scale,canvas.height)};
 }finally{await worker.terminate();canvas.width=canvas.height=1}
}
