import Phaser from 'phaser';
import { GameStore } from '../store/GameStore';
import { MAX_LOFT_LEVEL } from '../types';
import {
  BG_CARD,
  BG_ELEVATED,
  BORDER,
  TEXT_PRIMARY,
  TEXT_MUTED,
  FONT_LABEL,
  FONT_BODY,
  FONT_BODY_LARGE,
  FONT_H2,
  TEXT_RESOLUTION,
} from '../theme';

const HEADER_Y = 28;
const PANEL_W = 320;
const PANEL_H = 340;
const ROW_H = 36;
const BTN_H = 28;
const PAD = 24;

export class DebugScene extends Phaser.Scene {
  private seedText!: Phaser.GameObjects.Text;
  private birdText!: Phaser.GameObjects.Text;
  private loftText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'DebugScene' });
  }

  /** ブラウザで見えているキャンバス領域の中央をシーン座標で返す（パネルを画面中央に出すため） */
  private getViewportCenter(): { x: number; y: number } {
    const w = this.scale.width;
    const h = this.scale.height;
    if (typeof window === 'undefined') return { x: w / 2, y: h / 2 };
    const canvas = this.scale.game?.canvas;
    const rect = canvas?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: w / 2, y: h / 2 };
    const viewX = window.innerWidth / 2;
    const viewY = window.innerHeight / 2;
    const tx = (viewX - rect.left) / rect.width;
    const ty = (viewY - rect.top) / rect.height;
    const cx = Phaser.Math.Clamp(tx, 0.2, 0.8) * w;
    const cy = Phaser.Math.Clamp(ty, 0.2, 0.8) * h;
    return { x: cx, y: cy };
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const vp = this.getViewportCenter();
    const cx = vp.x;
    const cy = vp.y;
    const left = cx - PANEL_W / 2 + PAD;
    const valueX = cx - 60;
    const btnX = cx + 70;

    const overlay = this.add
      .rectangle(cx, cy, w, h, 0x000000, 0.7)
      .setInteractive()
      .on('pointerdown', () => this.goBack());
    overlay.setDepth(0);
    const panelBg = this.add.rectangle(cx, cy, PANEL_W, PANEL_H, BG_CARD, 1).setStrokeStyle(1, BORDER);
    panelBg.setDepth(10);
    panelBg.setInteractive();

    const d = 11;
    this.add.text(cx, cy - PANEL_H / 2 + HEADER_Y + 12, 'Debug', { resolution: TEXT_RESOLUTION, fontSize: FONT_H2, color: TEXT_PRIMARY }).setOrigin(0.5, 0).setDepth(d);

    let y = cy - PANEL_H / 2 + 70;

    this.add.text(left, y, 'SEED', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED }).setOrigin(0, 0.5).setDepth(d);
    this.seedText = this.add.text(valueX, y, String(GameStore.state.seed), { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_PRIMARY }).setOrigin(0, 0.5).setDepth(d);
    this.add
      .rectangle(btnX, y, 56, BTN_H, BG_ELEVATED)
      .setStrokeStyle(1, BORDER)
      .setDepth(d)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.setSeed());
    this.add.text(btnX, y, 'Set', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_PRIMARY }).setOrigin(0.5).setDepth(d);
    y += ROW_H;

    this.add.text(left, y, '$SEED（オンチェーン・表示のみ）', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED }).setOrigin(0, 0.5).setDepth(d);
    this.birdText = this.add.text(valueX, y, String(GameStore.seedToken), { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_PRIMARY }).setOrigin(0, 0.5).setDepth(d);
    y += ROW_H;

    this.add.text(left, y, 'Loft Level', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED }).setOrigin(0, 0.5).setDepth(d);
    this.loftText = this.add.text(valueX, y, String(GameStore.state.loftLevel), { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_PRIMARY }).setOrigin(0, 0.5).setDepth(d);
    y += 20;
    for (let lv = 1; lv <= MAX_LOFT_LEVEL; lv++) {
      const lvX = cx - 90 + (lv - 1) * 36;
      this.add
        .rectangle(lvX, y, 28, 24, BG_ELEVATED)
        .setStrokeStyle(1, BORDER)
        .setDepth(d)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.setLoftLevel(lv));
      this.add.text(lvX, y, String(lv), { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_PRIMARY }).setOrigin(0.5).setDepth(d);
    }
    y += 48;

    const narrow = this.scale.displaySize.width < 768;
    const mobileBtnW = 140;
    this.add
      .rectangle(cx - 80, y, mobileBtnW, BTN_H, BG_ELEVATED)
      .setStrokeStyle(1, BORDER)
      .setDepth(d);
    this.add
      .text(cx - 80, y, `Layout: ${narrow ? 'narrow' : 'wide'}`, {
        resolution: TEXT_RESOLUTION,
        fontSize: FONT_LABEL,
        color: TEXT_MUTED,
      })
      .setOrigin(0.5)
      .setDepth(d);

    this.add
      .rectangle(cx + 80, y, 80, BTN_H, BG_ELEVATED)
      .setStrokeStyle(1, BORDER)
      .setDepth(d)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.goBack());
    this.add.text(cx + 80, y, 'Back', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY, color: TEXT_PRIMARY }).setOrigin(0.5).setDepth(d);
  }

  private setSeed(): void {
    this.openNumberInput('SEED', String(GameStore.state.seed), (n) => {
      GameStore.setState({ seed: n });
      GameStore.save();
      this.seedText.setText(String(n));
    });
  }

  /** prompt がブロックされる環境用に DOM input で数値入力 */
  private openNumberInput(_label: string, current: string, onConfirm: (n: number) => void): void {
    const el = document.createElement('input');
    el.type = 'number';
    el.min = '0';
    el.value = current;
    el.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;font-size:16px;padding:8px 12px;min-width:120px;';
    const outsideHandler = (e: MouseEvent) => {
      if (e.target !== el && !el.contains(e.target as Node)) done();
    };
    const done = () => {
      const n = Math.floor(Number(el.value));
      if (Number.isFinite(n) && n >= 0) onConfirm(n);
      el.remove();
      document.body.removeEventListener('click', outsideHandler);
    };
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        done();
      }
      if (e.key === 'Escape') {
        el.remove();
        document.body.removeEventListener('click', outsideHandler);
      }
    });
    setTimeout(() => document.body.addEventListener('click', outsideHandler), 100);
  }

  private setLoftLevel(level: number): void {
    if (level < 1 || level > MAX_LOFT_LEVEL) return;
    GameStore.setState({
      loftLevel: level,
      unlockedDeckCount: level * 2,
    });
    GameStore.save();
    this.loftText.setText(String(level));
    this.scene.get('GameScene')?.events.emit('refresh');
  }

  private goBack(): void {
    this.scene.stop('DebugScene');
  }
}
