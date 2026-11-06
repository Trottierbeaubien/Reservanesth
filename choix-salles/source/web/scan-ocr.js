import {createWorker,PSM} from 'tesseract.js';
import {detectedSections,linesFromBlocks,refineHeadingLines} from './scan-sections.js';
export async function recogniseRoomSections(image,onProgress=()=>{}){
 const stripWidth=Math.round(image.width*.36),scale=Math.min(2.5,850/stripWidth,14000/image.height);
 const canvas=document.createElement('canvas');canvas.width=Math.round(stripWidth*scale);canvas.height=Math.round(image.height*scale);
 canvas.getContext('2d').drawImage(image,0,0,stripWidth,image.height,0,0,canvas.width,canvas.height);
 // The image stays in a local web worker. Only the public engine/language files are downloaded.
 const worker=await createWorker('fra',1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',langPath:'https://cdn.jsdelivr.net/npm/@tesseract.js-data/fra@1.0.0/4.0.0',logger:m=>onProgress(m.status==='recognizing text'?Math.round(m.progress*100):null)});
 try{
  await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
  let output=await worker.recognize(canvas,{}, {blocks:true,text:false});let lines=linesFromBlocks(output.data.blocks);let result=detectedSections(lines,canvas.height);
  if(result.headings.length<2){await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO});output=await worker.recognize(canvas,{}, {blocks:true,text:false});lines=linesFromBlocks(output.data.blocks);result=detectedSections(lines,canvas.height)}
  await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
  await refineHeadingLines(worker,canvas,canvas.width,canvas.height,lines);
  return detectedSections(lines,canvas.height);
 }finally{await worker.terminate();canvas.width=canvas.height=1}
}
