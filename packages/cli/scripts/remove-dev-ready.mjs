import { rm } from 'node:fs/promises';

await rm(new URL('../dist/.dev-ready', import.meta.url), { force: true });
