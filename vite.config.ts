import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'apps/web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    fs: { allow: ['apps/web', 'packages/shared', 'node_modules'] },
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 3001}` },
    },
  },
});
