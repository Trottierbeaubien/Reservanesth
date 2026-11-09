import {detectedSections, parseHeading} from './scan-sections.js';

export async function retryUncertainHeadings(worker, image, lines, width, height, singleLineMode) {
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
      const {data} = await worker.recognize(canvas,{}, {text:true,blocks:false});
      const corrected = parseHeading(data.text);
      const minimumConfidence = /^(?:1|I|L)F$/.test(heading.label) ? 90 : 75;
      if (!corrected?.room || !Number.isFinite(data.confidence) || data.confidence < minimumConfidence) continue;
      // CIC may include several separately printed C-room headings.
      if (corrected.room !== 'CIC' && used.has(corrected.room)) continue;
      if (corrected.room === 'CIC' && !/^C(?:[0-9]+|IC|URIETHERAPIE)$/.test(corrected.label)) continue;
      for (const line of nearby) line.text = data.text;
      used.add(corrected.room);
    }
  } finally {
    canvas.width = canvas.height = 1;
  }
}
