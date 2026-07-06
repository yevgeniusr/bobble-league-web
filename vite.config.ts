import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  // Generated art (ability icons, sprites, models) lives in repo-root public/;
  // vite copies it into dist/client so /assets/... resolves in dev and production.
  publicDir: '../public',
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { port: 5173, proxy: { '/socket.io': 'http://localhost:3000', '/healthz': 'http://localhost:3000' } },
  test: { include: ['../tests/**/*.test.ts'], environment: 'node' }
});
