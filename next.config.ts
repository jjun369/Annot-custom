import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Runtime library paths are intentionally dynamic. Do not let file tracing
  // copy development/release artifacts back into the standalone server.
  outputFileTracingExcludes: {
    '*': [
      './dist/**',
      './docs/**',
      './tests/**',
      './screenshots/**',
      './.git/**',
    ],
  },
};

export default nextConfig;
