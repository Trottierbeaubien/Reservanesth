export function residentLabels(lines) {
  const labels = new Set();
  for (const {text, confidence} of lines) {
    if (confidence < 55) continue;
    const normalized = text.toUpperCase().replace(/\bR\s+([1-5])\b/g, 'R$1').trim();
    const tokens = normalized.split(/[\s.,;/+|]+/).filter(Boolean);
    if (!tokens.length || !tokens.every(token => /^(?:R[1-5]|EXT)$/.test(token))) continue;
    for (const token of tokens) labels.add(token);
  }
  return [...labels].sort();
}

export async function readRoomResidents(worker, image, sections, linesFromBlocks) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const left = Math.floor(image.width * .58);
  const width = image.width - left;
  const result = {};
  try {
    for (const [room, bands] of Object.entries(sections)) {
      const tags = new Set();
      for (const [start, end] of bands) {
        const top = Math.floor(image.height * start);
        const height = Math.max(1, Math.floor(image.height * (end - start)));
        const scale = Math.min(2.5, 1050 / width, 1800 / height);
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        context.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height);
        const output = await worker.recognize(canvas, {}, {blocks:true, text:false});
        for (const label of residentLabels(linesFromBlocks(output.data.blocks))) tags.add(label);
      }
      if (tags.size) result[room] = [...tags].sort();
    }
    return result;
  } finally {
    canvas.width = canvas.height = 1;
  }
}
