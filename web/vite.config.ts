import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.RICCON_API_TARGET ?? 'http://127.0.0.1:8787';
const wsTarget = apiTarget.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.RICCON_WEB_PORT ?? 5399),
    strictPort: true,
    proxy: {
      '/api': apiTarget,
      '/ws': { target: wsTarget, ws: true },
    },
  },
});
