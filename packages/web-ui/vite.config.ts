import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true, // Allow ngrok and other external hosts
    fs: {
      allow: ['..', '../..']
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  },
  build: {
    target: 'esnext'
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['core']
  },
  assetsInclude: ['**/*.wasm']
});
