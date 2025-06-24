import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 3000,
    host: true,
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
