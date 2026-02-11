import { GameStore } from './store/GameStore';
import { initTitleUI, showTitleUI, hideTitleUI } from './titleUI';
import { setupAccountChangeReload } from './wallet';
import { createPhaserGame } from './phaserBoot';
import { hasNetworkStateContract, getLoftLevelRaw } from './networkState';

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
  // 接続済み: オンチェーン未登録（初回ログイン）なら TOP を表示し、登録済みならゲーム画面へ
  showTitleUI();
  const addr = GameStore.walletAddress;
  const goToGame = (): void => {
    hideTitleUI();
    createPhaserGame();
  };
  if (!hasNetworkStateContract()) {
    goToGame();
  } else {
    getLoftLevelRaw(addr!)
      .then((raw) => {
        if (raw > 0) goToGame();
      })
      .catch(() => {
        goToGame();
      });
  }
}
