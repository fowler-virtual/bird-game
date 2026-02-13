import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages: https://<user>.github.io/bird-game/
  base: process.env.GITHUB_PAGES === 'true' ? '/bird-game/' : './',
  server: {
    port: 5174,
    strictPort: true, // 5174が使用中なら起動しない＝古いプロセスの停止を促す
    host: true, // エミュレーター (10.0.2.2:5174) から接続できるように 0.0.0.0 で listen
  },
});
