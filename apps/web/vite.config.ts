import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // dev only; in the cluster Traefik routes /api to the api service
      '/api': 'http://localhost:8080',
    },
  },
});
