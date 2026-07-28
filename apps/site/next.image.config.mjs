import { ENABLE_STATIC_EXPORT } from './next.constants.mjs';

const remotePatterns = [
  'https://avatars.githubusercontent.com/**',
  'https://bestpractices.coreinfrastructure.org/**',
  'https://raw.githubusercontent.com/nodejs/**',
  'https://user-images.githubusercontent.com/**',
  'https://website-assets.oramasearch.com/**',
];

export const getImagesConfig = () => {
  return {
    // We disable image optimisation during static export builds
    unoptimized: ENABLE_STATIC_EXPORT,
    // We add it to the remote pattern for the static images we use from multiple sources
    // to be marked as safe sources (these come from Markdown files)
    remotePatterns: remotePatterns.map(url => new URL(url)),
  };
};
