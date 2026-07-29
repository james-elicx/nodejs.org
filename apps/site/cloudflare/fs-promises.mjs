import assetFiles from 'virtual:nodejs-org-cloudflare-fs-assets';

const assetFileSet = new Set(assetFiles);

const normalizeAssetPath = path => {
  const normalizedPath = String(path).replaceAll('\\', '/');
  const assetPath = normalizedPath.match(
    /(?:^|\/)(?:pages|snippets)\/.+$/
  )?.[0];

  return assetPath?.replace(/^\//, '') ?? normalizedPath.replace(/^\/+/, '');
};

const createFsError = (code, syscall, path) => {
  const error = new Error(
    `${code}: no such file or directory, ${syscall} '${path}'`
  );
  error.code = code;
  error.path = path;
  error.syscall = syscall;
  return error;
};

export async function readFile(path) {
  const assetPath = normalizeAssetPath(path);

  if (!assetFileSet.has(assetPath)) {
    throw createFsError('ENOENT', 'open', path);
  }

  const { env } = await import('cloudflare:workers');
  const response = await env.ASSETS.fetch(
    new URL(`/_fs_/${assetPath}`, 'http://assets.local')
  );

  if (!response.ok) {
    throw createFsError('ENOENT', 'open', path);
  }

  // Every indexed asset is repository-owned Markdown or a shell snippet, so
  // its size is bounded at build time and callers always request UTF-8 text.
  return response.text();
}

export function glob(pattern, options = {}) {
  if (Array.isArray(pattern)) {
    throw new Error('only a single pattern is supported');
  }

  if (!options.cwd) {
    throw new Error('calling glob without a cwd is not supported');
  }

  const extension = pattern.match(/^\*\*\/\*\.(?<extension>\w+)$/)?.groups
    ?.extension;
  const extensions = extension
    ? [extension]
    : pattern
        .match(/^\*\*\/\*\.(?<extensions>{\w+(,\w+)*})$/)
        ?.groups?.extensions?.slice(1, -1)
        .split(',');

  if (!extensions) {
    throw new Error(`pattern ${JSON.stringify(pattern)} is not supported`);
  }

  const directory = `${normalizeAssetPath(options.cwd).replace(/\/+$/, '')}/`;
  const matches = assetFiles
    .filter(
      path =>
        path.startsWith(directory) &&
        extensions.some(extension => path.endsWith(`.${extension}`))
    )
    .map(path => path.slice(directory.length));

  return (async function* () {
    yield* matches;
  })();
}
