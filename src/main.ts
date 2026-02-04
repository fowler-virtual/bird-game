import { GameStore } from './store/GameStore';
import { initTitleUI, showTitleUI } from './titleUI';

try {
  GameStore.load();
} catch (e) {
  console.error('[Bird Game] GameStore.load failed:', e);
}

// createPhaserGame / destroyPhaserGame は phaserBoot.ts にあり、titleUI と GameScene から直接 import する
export { createPhaserGame, destroyPhaserGame } from './phaserBoot';

// 初回表示: DOM タイトルのみ。接続成功後に titleUI が showGameShell() → createPhaserGame() を呼ぶ
initTitleUI();
showTitleUI();
