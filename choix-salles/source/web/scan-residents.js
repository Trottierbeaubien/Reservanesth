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

export async function readRoomResidents(worker, image, sections, linesFromBlocks) {
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
          for (const label of residentLabels(linesFromBlocks(output.data.blocks))) tags.add(label);
        }
      }
      if (tags.size) result[room] = [...tags].sort();
    }
    return result;
  } finally {
    canvas.width = canvas.height = 1;
  }
}
