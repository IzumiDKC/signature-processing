import { mkdir, cp, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
await mkdir(path.join(out, 'vendor'), { recursive: true });
for (const entry of await readdir(path.join(root, 'src'))) {
  await cp(path.join(root, 'src', entry), path.join(out, entry), { recursive: true });
}
await copyFile(path.join(root, 'node_modules/imagetracerjs/imagetracer_v1.2.6.js'), path.join(out, 'vendor/imagetracer.js'));
await copyFile(path.join(root, 'node_modules/imagetracerjs/LICENSE'), path.join(out, 'vendor/LICENSE-imagetracer.txt'));
console.log(`Static site built: ${out}`);
