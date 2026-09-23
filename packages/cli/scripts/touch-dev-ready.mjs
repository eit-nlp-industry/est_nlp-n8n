import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const markerPath = resolve('dist/.dev-ready');

await mkdir(dirname(markerPath), { recursive: true });
await writeFile(markerPath, `${Date.now()}\n`);
