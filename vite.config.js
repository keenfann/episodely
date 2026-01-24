import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appVersion = process.env.npm_package_version || '0.0.0';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4285',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
