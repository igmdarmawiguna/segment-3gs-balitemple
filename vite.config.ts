import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: { ignored: ['**/server/**', '**/dist/**', '**/*.ply'] },
  },
  optimizeDeps: { entries: ['index.html'] },
});
