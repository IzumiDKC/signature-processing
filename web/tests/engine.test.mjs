import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULTS, extractInk, vectorize, outputStem, validateOptions } from '../src/engine.js';
const require = createRequire(import.meta.url);
const tracer = require('imagetracerjs');

function image(width = 180, height = 100, color = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color, i * 4);
  return { data, width, height };
}
function set(img, x, y, color = [30, 55, 130, 255]) { img.data.set(color, (y * img.width + x) * 4); }
function mark() {
  const img = image();
  for (let x = 25; x < 150; x++) { const y = Math.round(50 + Math.sin(x / 20) * 20); set(img, x, y); set(img, x, y + 1); }
  return img;
}
const extract = (img, opts) => extractInk(img.data, img.width, img.height, opts);

test('blank and hidden RGB never produce invented ink', () => {
  assert.throws(() => extract(image()), /Không tìm đủ/);
  assert.throws(() => extract(image(100, 100, [0, 0, 0, 0])), /Không tìm đủ/);
  assert.throws(() => extract(image(100, 100, [180, 180, 180, 255])), /Không tìm đủ/);
});
test('faint blue and thin marks remain detectable', () => {
  const img = mark();
  for (let p = 0; p < img.data.length; p += 4) if (img.data[p] < 100) img.data.set([231, 239, 248, 255], p);
  assert.ok(extract(img, { sensitivity: 80, minArea: 1 }).count > 150);
});
test('small isolated noise is removed without extending bounds', () => {
  const img = mark(); set(img, 1, 1);
  assert.ok(extract(img).bbox[0] >= 20);
});
test('blue paper cast is removed while existing ink stays', () => {
  const img = image(180, 100, [236, 240, 248, 255]);
  for (let x = 25; x < 150; x++) for (let y = 48; y < 51; y++) set(img, x, y);
  const ink = extract(img, { sensitivity: 75 });
  assert.ok(ink.count < 1000);
  assert.equal(ink.components, 1);
});
test('vector is actual paths without embedded raster or paper layer', () => {
  const ink = extract(mark());
  const result = vectorize(ink, DEFAULTS, tracer);
  assert.match(result.svg, /viewBox="0 0 1200 480"/);
  assert.match(result.svg, /<path/);
  assert.match(result.svg, /Q/);
  assert.doesNotMatch(result.svg, /<image|data:image|rgb\(255,255,255\)/);
  assert.match(result.svg, /rgb\(30,59,138\)/);
  assert.ok(result.warnings.some(w => w.includes('Ảnh gốc nhỏ')));
});
test('separate marks remain separate; holes are carried by compound paths', () => {
  const img = image();
  for (let y = 25; y < 75; y++) for (let x = 30; x < 90; x++) if (x < 35 || x >= 85 || y < 30 || y >= 70) set(img, x, y);
  for (let y = 40; y < 55; y++) for (let x = 130; x < 135; x++) set(img, x, y);
  const ink = extract(img);
  assert.equal(ink.components, 2);
  const result = vectorize(ink, DEFAULTS, tracer);
  assert.ok((result.svg.match(/<path/g) || []).length >= 2);
  assert.ok((result.svg.match(/M /g) || []).length >= 3);
});
test('auto color uses dark ink, not white edge pixels', () => {
  const ink = extract(mark(), { color: 'auto' });
  assert.ok(Math.max(...ink.inkColor) < 160);
});
test('settings validation rejects oversized output and invalid margins', () => {
  assert.throws(() => validateOptions({ width: 4096, height: 4096 }));
  assert.throws(() => validateOptions({ width: 64, padding: 35 }));
  assert.throws(() => validateOptions({ smoothing: NaN }));
});
test('output names retain identity and never collide across case or suffix', () => {
  const used = new Set();
  const names = ['a/1899.JPG', '1899.png', '1899__2.jpg', 'CON.png', 'unsafe?.png', ''].map(n => outputStem(n, used));
  assert.deepEqual(names, ['1899', '1899__2', '1899__2__2', '_CON', 'unsafe_', 'signature']);
  assert.equal(outputStem('CON.backup.png', used), '_CON.backup');
});
