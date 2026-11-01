import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any folder (GitHub Pages, Netlify).
  base: './',
  server: { host: true },
  build: { chunkSizeWarningLimit: 800 },
});
