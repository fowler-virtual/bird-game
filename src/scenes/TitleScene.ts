import Phaser from 'phaser';
import { GameStore } from '../store/GameStore';
import { initTitleUI, showTitleUI, hideTitleUI, pendingStartGameScene, resetTitleUIState } from '../titleUI';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    GameStore.walletConnected = false;
    GameStore.walletAddress = null;
    resetTitleUIState();
    initTitleUI(); // 初回のみリスナー登録。Disconnect 後も外さないので再接続で確実に反応する
    showTitleUI();
  }

  update(): void {
    if (pendingStartGameScene) {
      resetTitleUIState();
      this.scene.start('GameScene');
    }
  }

  shutdown(): void {
    hideTitleUI();
  }
}
