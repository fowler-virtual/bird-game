import { GameStore } from './store/GameStore';
import { initTitleUI, showTitleUI, hideTitleUI } from './titleUI';
import { setupAccountChangeReload } from './wallet';
import { createPhaserGame } from './phaserBoot';

try {
  GameStore.load();
} catch (e) {
  console.error('[Bird Game] GameStore.load failed:', e);
}

// createPhaserGame / destroyPhaserGame は phaserBoot.ts にあり、titleUI と GameScene から直接 import する
export { createPhaserGame, destroyPhaserGame } from './phaserBoot';

// ウォレットのアカウント切り替え時にリロードして状態を切り替え（Connect 直後に accountsChanged でリロードすることがある）
setupAccountChangeReload();

initTitleUI();

if (!GameStore.walletConnected || !GameStore.walletAddress) {
  showTitleUI();
} else {
  showTitleUI();
  hideTitleUI();
  createPhaserGame();
}
