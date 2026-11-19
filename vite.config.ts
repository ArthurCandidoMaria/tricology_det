import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Em produção o nginx faz o proxy de /api e /storage para o backend.
  // No dev o Vite precisa fazer o mesmo, senão as chamadas caem no próprio
  // dev server e retornam 404.
  const backendTarget = env.BACKEND_URL || `http://localhost:${env.BACKEND_PORT || 8000}`;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
    server: {
      proxy: {
        '/api': { target: backendTarget, changeOrigin: true },
        '/storage': { target: backendTarget, changeOrigin: true },
      },
    },
  };
});
