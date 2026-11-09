import {detectedSections, parseHeading, roomId} from './scan-sections.js';

export async function retryUncertainHeadings(worker, image, lines, width, height, singleLineMode, singleWordMode) {
  const {headings} = detectedSections(lines,height);
  const counts = new Map();
  for (const {room} of headings) {
    if (room && room !== 'CIC') counts.set(room,(counts.get(room) || 0)+1);
  }
  const uncertain = headings.filter(({room}) => !room || (counts.get(room) || 0) > 1);
  if (!uncertain.length) return;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const used = new Set(counts.keys());
  try {
    await worker.setParameters({tessedit_pageseg_mode:singleLineMode});
    for (const heading of uncertain) {
      const nearby = lines.filter(({text,bbox}) => bbox && parseHeading(text) &&
        Math.abs(bbox.y0-heading.y*height) <= Math.max(8,(bbox.y1-bbox.y0)*.8));
      if (!nearby.length) continue;
      const {bbox} = nearby.reduce((best,line) => (line.confidence || 0) > (best.confidence || 0) ? line : best);
      const lineHeight = bbox.y1-bbox.y0;
      const left = Math.max(0,bbox.x0-lineHeight*.5)/width*image.width;
      const right = Math.min(width,bbox.x1+lineHeight*1.5)/width*image.width;
      const top = Math.max(0,bbox.y0-lineHeight*.3)/height*image.height;
      const bottom = Math.min(height,bbox.y1+lineHeight*.3)/height*image.height;
      if (right<=left || bottom<=top) continue;
      const scale = Math.min(4,1000/(right-left));
      canvas.width = Math.max(1,Math.round((right-left)*scale));
      canvas.height = Math.max(1,Math.round((bottom-top)*scale));
      context.filter = 'grayscale(1) contrast(1.5)';
      context.drawImage(image,left,top,right-left,bottom-top,0,0,canvas.width,canvas.height);
      const {data} = await worker.recognize(canvas,{}, {text:true,blocks:true});
      let text = data.text, confidence = data.confidence;
      let corrected = parseHeading(text);
      const minimumConfidence = /^(?:1|I|L)F$/.test(heading.label) ? 90 : 75;
      const usable = candidate => candidate?.room &&
        (candidate.room === 'CIC' ? /^C(?:[0-9]+|IC|URIETHERAPIE)$/.test(candidate.label) : !used.has(candidate.room));
      if ((!usable(corrected) || confidence < minimumConfidence) && singleWordMode !== undefined && corrected) {
        const words=(data.blocks||[]).flatMap(block=>block.paragraphs||[])
          .flatMap(paragraph=>paragraph.lines||[]).flatMap(line=>line.words||[]);
        const word=words.find(item=>item.text.trim().toUpperCase()===corrected.label);
        if (word?.bbox && /^\d{1,2}$/.test(corrected.label)) {
          const number=document.createElement('canvas');
          const {x0,y0,x1,y1}=word.bbox;
          const w=x1-x0,h=y1-y0;
          if(w>0&&h>0) {
            number.width=w*2+36;
            number.height=h*2+36;
            const numberContext=number.getContext('2d');
            numberContext.fillStyle='#fff';
            numberContext.fillRect(0,0,number.width,number.height);
            numberContext.drawImage(canvas,x0,y0,w,h,18,18,w*2,h*2);
            try {
              await worker.setParameters({tessedit_pageseg_mode:singleWordMode,tessedit_char_whitelist:'0123456789'});
              const isolated=await worker.recognize(number,{}, {text:true,blocks:false});
              const token=isolated.data.text.trim();
              const room=/^\d{1,2}$/.test(token)?roomId(token):null;
              if(room && isolated.data.confidence>=85 && !used.has(room)){
                text='SALLE NUMERO '+token;
                corrected=parseHeading(text);
                confidence=isolated.data.confidence;
              }
            } finally {
              await worker.setParameters({tessedit_pageseg_mode:singleLineMode,tessedit_char_whitelist:''});
              number.width=number.height=1;
            }
          }
        }
      }
      if (!usable(corrected) || !Number.isFinite(confidence) || confidence < minimumConfidence) continue;
      for (const line of nearby) line.text = text;
      used.add(corrected.room);
    }
  } finally {
    canvas.width = canvas.height = 1;
  }
}
