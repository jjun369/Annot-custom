import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // The Mobile Bridge renders deliberate PDF regions in the Node route. Keep
  // the native canvas binding external so the Windows standalone output keeps
  // its platform binary instead of attempting to bundle it into server code.
  serverExternalPackages: ['@napi-rs/canvas', '@pdf-lib/fontkit', 'pdf-lib'],
  // Runtime library paths are intentionally dynamic. Do not let file tracing
  // copy development/release artifacts back into the standalone server.
  outputFileTracingExcludes: {
    '*': [
      './dist/**',
      './dist-*',
      './docs/**',
      './tests/**',
      './screenshots/**',
      './tmp/**',
      './.git/**',
    ],
  },
};

export default nextConfig;
