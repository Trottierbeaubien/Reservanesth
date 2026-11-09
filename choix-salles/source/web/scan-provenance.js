// Exact matches only. This initial list is deliberately limited to familiar
// Canadian cities outside Quebec. Unknown or ambiguous names remain unmarked.
const outsideQuebec = new Set([
  'OTTAWA', 'TORONTO', 'VANCOUVER', 'CALGARY', 'EDMONTON', 'WINNIPEG',
  'REGINA', 'SASKATOON', 'HALIFAX', 'MONCTON', 'FREDERICTON',
  'CHARLOTTETOWN', 'YELLOWKNIFE', 'WHITEHORSE', 'IQALUIT', 'EDMUNDSTON',
]);

const normalizeCity = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().replace(/\s+/g, ' ').toUpperCase();

export function outOfProvinceRooms(lines, sections, width, height) {
  const starts = lines.filter(({text, bbox}) => bbox && bbox.x0 < width * .095 &&
    /^\s*(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(text));
  const cities = lines.filter(({text, bbox, confidence}) => bbox && confidence >= 80 &&
    bbox.x0 >= width * .13 && bbox.x1 <= width * .29 &&
    outsideQuebec.has(normalizeCity(text)));

  return Object.entries(sections).filter(([, bands]) => bands.some(([top, bottom]) =>
    cities.some(({bbox}) => {
      if (bbox.y0 < top * height || bbox.y1 > bottom * height) return false;
      const lineHeight = bbox.y1 - bbox.y0;
      // The location is printed below the case's time row.
      return starts.some(start => {
        const delta = bbox.y0 - start.bbox.y0;
        return start.bbox.y0 >= top * height && delta >= lineHeight &&
          delta <= 6 * lineHeight;
      });
    })
  )).map(([id]) => id);
}
