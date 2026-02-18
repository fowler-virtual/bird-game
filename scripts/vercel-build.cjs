/**
 * Vercel 用: フロントはビルドせず、dist にプレースホルダーだけ出力する。
 * Claim API は api/* が Serverless Function としてデプロイされる。
 */
const fs = require('fs');
const path = require('path');
const dist = path.join(process.cwd(), 'dist');
const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Bird Game</title></head>
<body><p>Claim API only. Frontend: GitHub Pages.</p></body></html>`;
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
console.log('skip frontend build for Vercel claim API; created dist/index.html placeholder');
