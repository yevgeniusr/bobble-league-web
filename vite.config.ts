import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { port: 5173, proxy: { '/socket.io': 'http://localhost:3000', '/healthz': 'http://localhost:3000' } },
  test: { include: ['../tests/**/*.test.ts'], environment: 'node' }
});
