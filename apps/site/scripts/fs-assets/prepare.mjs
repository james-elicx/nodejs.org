import { cp, rm } from 'node:fs/promises';

const source = '.wrangler/fs-assets-polyfilling';
const destination = '.vinext-fs-assets';

// The Cloudflare Vite development runtime uses `.wrangler` for its own state
// and clears this generated module tree before Vite loads the application.
// Preserve the generator output at a stable path used by both dev and build.
await rm(destination, { force: true, recursive: true });
await cp(source, destination, { recursive: true });
