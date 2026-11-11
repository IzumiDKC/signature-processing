// Deterministic ink extraction and bounded contour fitting. No generative model.
export const DEFAULTS = Object.freeze({ sensitivity: 55, minArea: 2, smoothing: 0.35, color: 'blue', width: 1200, height: 480, padding: 24 });

export function validateOptions(input = {}) {
  const o = { ...DEFAULTS, ...input };
  for (const [key, low, high] of [['sensitivity', 0, 100], ['minArea', 1, 50], ['smoothing', 0, 1], ['width', 64, 4096], ['height', 64, 4096], ['padding', 0, 200]]) {
    if (!Number.isFinite(o[key]) || o[key] < low || o[key] > high) throw new Error(`Thiết lập ${key} không hợp lệ.`);
  }
  if (!Number.isInteger(o.width) || !Number.isInteger(o.height) || !Number.isInteger(o.minArea)) throw new Error('Kích thước và lọc nhiễu phải là số nguyên.');
  if (o.width * o.height > 8_000_000 || o.padding * 2 >= Math.min(o.width, o.height)) throw new Error('Khung quá lớn hoặc lề quá rộng.');
  if (!['blue', 'black', 'auto'].includes(o.color)) throw new Error('Màu mực không hợp lệ.');
  return o;
}

function boxBlur(source, width, height, radius) {
  const temp = new Float32Array(source.length), dest = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < Math.min(width, radius + 1); x++) sum += source[y * width + x];
    for (let x = 0; x < width; x++) {
      temp[y * width + x] = sum / (Math.min(width - 1, x + radius) - Math.max(0, x - radius) + 1);
      if (x - radius >= 0) sum -= source[y * width + x - radius];
      if (x + radius + 1 < width) sum += source[y * width + x + radius + 1];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < Math.min(height, radius + 1); y++) sum += temp[y * width + x];
    for (let y = 0; y < height; y++) {
      dest[y * width + x] = sum / (Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1);
      if (y - radius >= 0) sum -= temp[(y - radius) * width + x];
      if (y + radius + 1 < height) sum += temp[(y + radius + 1) * width + x];
    }
  }
  return dest;
}

export function extractInk(data, width, height, options = {}) {
  const o = validateOptions(options), n = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || n > 1_600_000 || data.length !== n * 4) throw new Error('Dữ liệu ảnh không hợp lệ hoặc quá lớn.');
  const gray = new Float32Array(n), score = new Float32Array(n), mask = new Uint8Array(n), blueDiff = new Float32Array(n);
  // Composite transparent pixels onto paper before evaluating their RGB.
  const rgb = new Uint8ClampedArray(data.length);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[i * 4 + c] = 255 + a * (data[i * 4 + c] - 255);
    gray[i] = 0.299 * rgb[i * 4] + 0.587 * rgb[i * 4 + 1] + 0.114 * rgb[i * 4 + 2];
    blueDiff[i] = rgb[i * 4 + 2] - rgb[i * 4];
  }
  const paper = boxBlur(gray, width, height, Math.max(3, Math.round(Math.min(width, height) / 22)));
  // A bluish paper cast is not ink. Subtract the median paper chroma before
  // selecting blue strokes, then adapt the threshold to the measured ink range.
  const bluePaper = Math.max(0, blueDiff.slice().sort()[Math.floor(n / 2)]);
  const baseThreshold = 18 - o.sensitivity * 0.15;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 4], g = rgb[i * 4 + 1], b = rgb[i * 4 + 2];
    const blue = b >= g - 8 ? Math.max(0, b - r - bluePaper) * 1.3 : 0;
    score[i] = Math.max(0, paper[i] - gray[i], blue, gray[i] < 90 ? (90 - gray[i]) * 1.7 : 0);
  }
  const candidates = score.filter(value => value >= baseThreshold).sort();
  const reference = candidates.length ? candidates[Math.floor((candidates.length - 1) * 0.9)] : 0;
  const threshold = Math.max(baseThreshold, reference * (0.5 - o.sensitivity * 0.004));
  for (let i = 0; i < n; i++) mask[i] = score[i] >= threshold ? 1 : 0;
  const seen = new Uint8Array(n), queue = new Int32Array(n);
  let components = 0, count = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let seed = 0; seed < n; seed++) {
    if (!mask[seed] || seen[seed]) continue;
    let head = 0, tail = 1;
    queue[0] = seed; seen[seed] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const q = p + dy * width + dx;
        if (mask[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; }
      }
    }
    if (tail < o.minArea) {
      for (let k = 0; k < tail; k++) { mask[queue[k]] = 0; score[queue[k]] = 0; }
      continue;
    }
    components++; count += tail;
    for (let k = 0; k < tail; k++) {
      const x = queue[k] % width, y = Math.floor(queue[k] / width);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (count < 8) throw new Error('Không tìm đủ nét mực. Thử tăng độ nhạy hoặc dùng ảnh gốc rõ hơn.');
  if (count / n > 0.6) throw new Error('Vùng tối chiếm gần hết ảnh. Hãy dùng ảnh chữ ký trên nền sáng hoặc cắt sát vùng ký.');
  // Sub-threshold samples remain for subpixel edge interpolation. Only small
  // rejected components were zeroed above; they cannot reappear in the trace.
  const colors = [];
  for (let i = 0; i < n; i++) if (mask[i]) colors.push([gray[i], rgb[i * 4], rgb[i * 4 + 1], rgb[i * 4 + 2]]);
  colors.sort((a, b) => a[0] - b[0]);
  const darkest = colors.slice(0, Math.max(1, Math.ceil(colors.length * 0.15)));
  const autoColor = [1, 2, 3].map(c => Math.round(darkest.reduce((s, p) => s + p[c], 0) / darkest.length));
  const inkColor = o.color === 'auto' ? autoColor : o.color === 'black' ? [22, 28, 36] : [30, 59, 138];
  const warnings = [];
  if (Math.min(width, height) < 180) warnings.push('Ảnh gốc nhỏ. Kiểm tra các nét mảnh trước khi sử dụng.');
  if (x0 <= 1 || y0 <= 1 || x1 >= width - 2 || y1 >= height - 2) warnings.push('Chữ ký sát mép ảnh. Kiểm tra nét bị cắt hoặc viền giấy.');
  if (components > 50) warnings.push('Nhiều vùng mực rời; kiểm tra chấm nhiễu và nét đứt.');
  if (count / n > 0.25) warnings.push('Vùng mực lớn; có thể lẫn chữ in, dấu mộc hoặc bóng nền.');
  return { score, mask, width, height, threshold, bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], components, count, inkColor, warnings };
}

export function vectorize(ink, options, tracer) {
  const o = validateOptions(options), [x, y, w, h] = ink.bbox;
  // Supersample the measured ink field before fitting curves. Preserve holes;
  // never dilate, join components or extrapolate missing strokes.
  const factor = Math.max(1, Math.min(4, Math.floor(Math.sqrt(900_000 / ((w + 4) * (h + 4))))));
  const tw = (w + 4) * factor, th = (h + 4) * factor;
  const pixels = new Uint8ClampedArray(tw * th * 4);
  const read = (ix, iy) => ix >= 0 && iy >= 0 && ix < ink.width && iy < ink.height ? ink.score[iy * ink.width + ix] : 0;
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    const sx = x - 2 + (i + 0.5) / factor - 0.5, sy = y - 2 + (j + 0.5) / factor - 0.5;
    const ix = Math.floor(sx), iy = Math.floor(sy), dx = sx - ix, dy = sy - iy;
    const value = read(ix, iy) * (1 - dx) * (1 - dy) + read(ix + 1, iy) * dx * (1 - dy)
      + read(ix, iy + 1) * (1 - dx) * dy + read(ix + 1, iy + 1) * dx * dy;
    const v = value >= ink.threshold ? 0 : 255, p = (j * tw + i) * 4;
    pixels[p] = pixels[p + 1] = pixels[p + 2] = v; pixels[p + 3] = 255;
  }
  const traceOptions = {
    pal: [{ r: 255, g: 255, b: 255, a: 255 }, { r: 0, g: 0, b: 0, a: 255 }],
    colorsampling: 0, colorquantcycles: 1, pathomit: 0, rightangleenhance: false,
    ltres: 0.02 + o.smoothing * 0.35, qtres: 0.02 + o.smoothing * 6,
    strokewidth: 0, linefilter: false, roundcoords: 3, viewbox: true, desc: false,
  };
  const td = tracer.imagedataToTracedata({ data: pixels, width: tw, height: th }, traceOptions);
  td.layers[0] = []; // Exclude the paper layer completely, including invisible paths.
  const [r, g, b] = ink.inkColor;
  td.palette[1] = { r, g, b, a: 255 };
  const traced = tracer.getsvgstring(td, traceOptions);
  const paths = traced.slice(traced.indexOf('>') + 1, traced.lastIndexOf('</svg>'));
  if (!paths.includes('<path')) throw new Error('Không tạo được đường vector; thử tăng độ nhạy.');
  const scale = Math.min((o.width - 2 * o.padding) / tw, (o.height - 2 * o.padding) / th);
  const tx = (o.width - tw * scale) / 2, ty = (o.height - th * scale) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}"><title>Chữ ký đã tách nền</title><g transform="translate(${tx.toFixed(5)} ${ty.toFixed(5)}) scale(${scale.toFixed(7)})">${paths}</g></svg>`;
  return { svg, warnings: ink.warnings, components: ink.components, inkPixels: ink.count, color: `rgb(${r},${g},${b})`, bbox: ink.bbox };
}

export function outputStem(name, used) {
  let stem = name.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 120) || 'signature';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  let result = stem, n = 2;
  while (used.has(result.toLowerCase())) result = `${stem}__${n++}`;
  used.add(result.toLowerCase());
  return result;
}
