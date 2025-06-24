import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'TldrawWorker',
      fileName: 'index',
      formats: ['es']
    },
    rollupOptions: {
      external: ['core']
    }
  },
  worker: {
    format: 'es'
  }
});
