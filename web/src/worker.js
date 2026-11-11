import './vendor/imagetracer.js';
import { extractInk, vectorize } from './engine.js';

self.onmessage = ({ data: { id, rgba, width, height, options } }) => {
  try {
    const ink = extractInk(new Uint8ClampedArray(rgba), width, height, options);
    self.postMessage({ id, result: vectorize(ink, options, self.ImageTracer) });
  } catch (error) {
    self.postMessage({ id, error: error.message || 'Không thể xử lý ảnh này.' });
  }
};
