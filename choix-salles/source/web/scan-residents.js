const aliases = {RI:'R1', RL:'R1', RS:'R5'};

export function residentLabels(lines) {
  const labels = new Set();
  for (const {text, confidence} of lines) {
    if (!Number.isFinite(confidence) || confidence < 45) continue;
    const normalized = text.toUpperCase().replace(/\bR\s+([1-5ILS])\b/g, 'R$1').trim();
    const tokens = normalized.split(/[\s.,;/+|]+/).filter(Boolean);
    for (const token of tokens) {
      if (/^(?:R[1-5]|EXT)$/.test(token)) labels.add(token);
      else if (tokens.length === 1 && Object.hasOwn(aliases,token)) labels.add(aliases[token]);
    }
  }
  return [...labels].sort();
}

function prepareInk(source, blueOnly) {
  const prepared = new ImageData(new Uint8ClampedArray(source.data),source.width,source.height);
  let ink = 0;
  for (let i=0;i<prepared.data.length;i+=4) {
    const [r,g,b] = [source.data[i],source.data[i+1],source.data[i+2]];
    const blue = b-r>=12 && b-g>=3 && r<200;
    const gray = .299*r+.587*g+.114*b;
    const level = blueOnly ? (blue ? 0 : 255) : Math.max(0,Math.min(255,(gray-110)*2.8+38));
    if (level<110) ink++;
    prepared.data[i]=prepared.data[i+1]=prepared.data[i+2]=level;
    prepared.data[i+3]=255;
  }
  return {prepared,ink};
}

function inkGroups({data,width,height}) {
  const rows = new Uint32Array(height);
  for (let y=0;y<height;y++) {
    for (let x=0;x<width;x++) if (data[(y*width+x)*4] < 105) rows[y]++;
  }
  const groups = [];
  let top = -1, last = -1;
  for (let y=0;y<=height;y++) {
    if (y<height && rows[y]>=2) {
      if (top<0) top=y;
      last=y;
      continue;
    }
    if (top<0 || (y<height && y-last<=4)) continue;
    const h = last-top+1;
    if (h>=8 && h<=height*.55) {
      const columns = new Uint8Array(width);
      for(let yy=top;yy<=last;yy++) for(let x=0;x<width;x++) {
        if(data[(yy*width+x)*4]<105) columns[x]=1;
      }
      let left=-1, right=-1;
      for(let x=0;x<=width;x++) {
        if(x<width && columns[x]) {
          if(left<0) left=x;
          right=x;
          continue;
        }
        if(left<0 || (x<width && x-right<=Math.max(4,h*.45))) continue;
        const w=right-left+1;
        if(w>=h*.55 && w<=h*4) groups.push({left,top,w,h});
        left=-1;
      }
    }
    top=-1;
  }
  return groups;
}

async function readIsolatedInk(worker, mask, singleLineMode, sparseMode) {
  const source=document.createElement('canvas');
  source.width=mask.width;
  source.height=mask.height;
  source.getContext('2d').putImageData(mask,0,0);
  const crop=document.createElement('canvas');
  const context=crop.getContext('2d');
  const tags=new Set();
  try {
    await worker.setParameters({tessedit_pageseg_mode:singleLineMode});
    for (const {left,top,w,h} of inkGroups(mask).slice(0,12)) {
      const scale=Math.max(1,70/h);
      crop.width=Math.ceil(w*scale)+36;
      crop.height=Math.ceil(h*scale)+36;
      context.fillStyle='white';
      context.fillRect(0,0,crop.width,crop.height);
      context.drawImage(source,left,top,w,h,18,18,w*scale,h*scale);
      const {data}=await worker.recognize(crop,{}, {text:true,blocks:false});
      for(const tag of residentLabels([{text:data.text,confidence:data.confidence}])) tags.add(tag);
    }
    return tags;
  } finally {
    source.width=source.height=crop.width=crop.height=1;
    await worker.setParameters({tessedit_pageseg_mode:sparseMode});
  }
}

export async function readRoomResidents(worker, image, sections, linesFromBlocks, singleLineMode, sparseMode) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d',{willReadFrequently:true});
  const left = Math.floor(image.width * .69);
  const width = Math.max(1,Math.floor(image.width * .965)-left);
  const result = {};
  try {
    for (const [room, bands] of Object.entries(sections)) {
      const tags = new Set();
      for (const [start, end] of bands) {
        const top = Math.floor(image.height * start);
        const height = Math.max(1,Math.floor(image.height * (end - start)));
        const scale = Math.min(3.5, 1400 / width, 2200 / height);
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        context.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height);
        const original = context.getImageData(0,0,canvas.width,canvas.height);
        for (const blueOnly of [false,true]) {
          const {prepared,ink} = prepareInk(original,blueOnly);
          if (ink < 12) continue;
          context.putImageData(prepared,0,0);
          const output = await worker.recognize(canvas, {}, {blocks:true, text:false});
          const detected=residentLabels(linesFromBlocks(output.data.blocks));
          for (const label of detected) tags.add(label);
          if (blueOnly && !detected.length) {
            for (const label of await readIsolatedInk(worker,prepared,singleLineMode,sparseMode)) tags.add(label);
          }
        }
      }
      if (tags.size) result[room] = [...tags].sort();
    }
    return result;
  } finally {
    canvas.width = canvas.height = 1;
  }
}
