import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built site works from any static host or sub-path.
// 'three' -> the WebGPU build, so addons (OrbitControls) share one three.js instance with three/webgpu + three/tsl.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
