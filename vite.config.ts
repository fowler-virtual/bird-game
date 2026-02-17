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
    port: 5174,
    strictPort: false, // 5174が使用中なら次のポートで起動（ターミナルに表示）
    host: true, // エミュレーター (10.0.2.2:5174) から接続できるように 0.0.0.0 で listen
  },
  preview: {
    port: 5174,
    strictPort: false,
    host: true,
  },
});
