import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point workspace packages at source so `pnpm dev` needs no build step.
      '@liha-cli/shared': resolve('../../packages/shared/src/index.ts'),
      '@liha-cli/webmcp': resolve('../../packages/webmcp/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
