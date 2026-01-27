import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appVersion =
  process.env.APP_VERSION || process.env.npm_package_version || '0.0.0';
const devHost = process.env.VITE_HOST || 'localhost';
const devPort = Number(process.env.VITE_PORT) || 5173;
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:4285';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
