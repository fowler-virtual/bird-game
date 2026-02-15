import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages: https://<user>.github.io/bird-game/
  base: process.env.GITHUB_PAGES === 'true' ? '/bird-game/' : './',
  resolve: {
    alias: { buffer: 'buffer/' },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  server: {
    port: 5175,
    strictPort: false,
    host: true,
  },
  preview: {
    port: 5175,
    strictPort: false,
    host: true,
  },
});
