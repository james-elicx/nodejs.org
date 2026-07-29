import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const outputDirectory = 'dist/client';
const fsAssetsOutputDirectory = join(outputDirectory, '_fs_');
const assetDirectories = ['pages', 'snippets'];

await Promise.all(
  assetDirectories.map(directory =>
    rm(join(outputDirectory, directory), { force: true, recursive: true })
  )
);
await rm(fsAssetsOutputDirectory, { force: true, recursive: true });
await mkdir(fsAssetsOutputDirectory, { recursive: true });

await Promise.all(
  assetDirectories.map(async source => {
    const destination = join(fsAssetsOutputDirectory, source);

    await cp(source, destination, { recursive: true });
  })
);
