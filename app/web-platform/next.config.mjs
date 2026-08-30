/**
 * Static export so the site can later be published as plain files
 * (e.g. GitHub Pages) with no server. Set NEXT_PUBLIC_BASE_PATH when
 * deploying under a sub-path, e.g. NEXT_PUBLIC_BASE_PATH=/vibex.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  outputFileTracingRoot: new URL('.', import.meta.url).pathname,
  reactStrictMode: true,
};

export default nextConfig;
