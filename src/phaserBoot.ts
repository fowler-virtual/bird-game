/**
 * Phaser ゲームの作成・破棄。titleUI から呼ぶため main と分離し循環参照を避ける。
 */

import Phaser from 'phaser';
import { setDisconnectCallback } from './domShell';
import { GameScene } from './scenes/GameScene';
import { GachaScene } from './scenes/GachaScene';
import { DebugScene } from './scenes/DebugScene';
import { BG_PRIMARY_HEX } from './theme';

declare global {
  interface Window {
    __phaserGame?: Phaser.Game;
  }
}

/** 多重起動ガード（2回目以降は何もしない） */
let _phaserCreateStarted = false;

/**
 * Phaser ゲームを生成する。接続成功後・シェル表示後にのみ呼ぶ。
 * boot 時に親 #app が既に表示されているため、getParentBounds() が正しいサイズを返し、
 * 初回表示のキャンバスサイズがタブ切替 2 回目以降と一致する。
 */
export function createPhaserGame(): Phaser.Game | undefined {
  if (window.__phaserGame) return window.__phaserGame;
  if (_phaserCreateStarted) return undefined;
  _phaserCreateStarted = true;
  try {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: 800,
      height: 800,
      parent: 'app',
      backgroundColor: BG_PRIMARY_HEX,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [GameScene, GachaScene, DebugScene],
    });
    window.__phaserGame = game;
    return game;
  } finally {
    _phaserCreateStarted = false;
  }
}

export function destroyPhaserGame(): void {
  const game = window.__phaserGame;
  if (game) {
    try {
      game.destroy(true);
    } catch (_e) {
      /* 既に破棄済みなど */
    }
  }
  window.__phaserGame = undefined;
  _phaserCreateStarted = false;
  setDisconnectCallback(null);
}
