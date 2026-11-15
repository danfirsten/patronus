import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built site works from any static host or sub-path.
// three >= r172: 'three', 'three/webgpu' and addons share one three.core.js, so no alias is needed.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
