// Only printed room headings and their positions are retained; case text is discarded.
export const ROOM_IDS=['08','09','11','28','30','34','40','42','46','48','CIC'];
export function roomId(token){const value=String(token).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,'');if(/^(?:C\d*|CIC|CURIETHERAPIE)$/.test(value))return 'CIC';const numeric=value.replace(/O/g,'0').replace(/[IL]/g,'1');if(/^\d{1,2}$/.test(numeric)){const n=String(Number(numeric)).padStart(2,'0');return ROOM_IDS.includes(n)?n:null}return null}
export function parseHeading(text){const normalized=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[º°]/g,'O').replace(/[^A-Z0-9\s]/g,' ');const match=normalized.match(/\bSALLE\s*(?:NUM[E3]R[O0]|N\s*O)\s*([A-Z][A-Z0-9]*|\d{1,2}[A-Z]?)\b/);if(!match)return null;return {label:match[1],room:roomId(match[1])}}
export function detectedSections(lines,height){
 if(!Number.isFinite(height)||height<=0)return {sections:{},headings:[]};
 const candidates=lines.map(line=>{const h=parseHeading(line.text);const b=line.bbox;if(!h||!b||!Number.isFinite(b.y0)||!Number.isFinite(b.y1))return null;return {...h,y:Math.max(0,b.y0),height:Math.max(1,b.y1-b.y0),confidence:line.confidence||0}}).filter(Boolean).sort((a,b)=>a.y-b.y);
 const headings=[];for(const h of candidates){const previous=headings.at(-1);if(previous&&h.label===previous.label&&h.y-previous.y<Math.max(8,h.height*.7)){if(h.confidence>previous.confidence)headings[headings.length-1]=h;continue}headings.push(h)}
 const sections={};for(let i=0;i<headings.length;i++){const h=headings[i];if(!h.room)continue;const top=Math.max(0,h.y-h.height*.35),next=headings[i+1],bottom=next?Math.max(top,next.y-next.height*.35):height;if(bottom-top<2)continue;(sections[h.room]??=[]).push([top/height,Math.min(1,bottom/height)])}
 return {sections,headings:headings.map(({label,room,y})=>({label,room,y:y/height}))};
}
export function linesFromBlocks(blocks){return (blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(p=>(p.lines||[]).map(line=>({text:line.text,bbox:line.bbox,confidence:line.confidence}))))}
export function sectionsFor(sections,crops,id){const current=sections?.[id];if(current?.length)return current.map(c=>c.slice());if(crops?.[id])return [crops[id].slice()];return []}

export async function refineHeadingLines(worker,image,width,height,lines){
 for(const line of lines){const heading=parseHeading(line.text);if(!heading||!(!heading.room&&/^\d/.test(heading.label)||heading.room&&(line.confidence||0)<80))continue;const b=line.bbox,h=Math.max(10,b.y1-b.y0),top=Math.max(0,Math.round(b.y0-h*.25)),left=Math.max(0,Math.round(b.x0-h*.5));const rectangle={left,top,width:Math.min(width-left,Math.round((b.x1-b.x0)+h*3)),height:Math.min(height-top,Math.round(h*1.5))};const refined=await worker.recognize(image,{rectangle},{text:true,blocks:false});if(parseHeading(refined.data.text)?.room)line.text=refined.data.text;}
 return lines;
}
