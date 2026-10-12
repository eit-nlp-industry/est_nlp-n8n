import { mkdir, writeFile } from 'node:fs/promises';

const markerPath = new URL('../dist/.dev-ready', import.meta.url);

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(markerPath, `${Date.now()}\n`);
