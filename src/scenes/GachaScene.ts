import Phaser from 'phaser';
import { RARITY_TEXTURE_KEYS } from '../types';
import { GameStore } from '../store/GameStore';
import { connectWallet, hasWallet } from '../wallet';
import {
  BG_PRIMARY,
  BG_CARD,
  BG_ELEVATED,
  BORDER,
  TEXT_PRIMARY,
  TEXT_MUTED,
  ACCENT_HEX,
  DANGER_HEX,
  SUCCESS,
  FONT_LABEL,
  FONT_BODY,
  FONT_BODY_LARGE,
  FONT_H3,
  TEXT_RESOLUTION,
} from '../theme';

const GACHA_COST = 10;
const HEADER_Y = 28;
const RESULT_IMAGE_Y = 95;
const RESULT_IMAGE_SIZE = 72;

export class GachaScene extends Phaser.Scene {
  private currencyText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private resultImage: Phaser.GameObjects.Image | null = null;
  private hintModalObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: 'GachaScene' });
  }

  create(): void {
    this.add
      .rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, BG_PRIMARY)
      .setDepth(-2);

    console.log('[STORE] GachaScene create', GameStore.state, GameStore.birdCurrency);

    GameStore.applyAccrual();
    GameStore.save();

    this.add.text(24, HEADER_Y, '$Bird', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_MUTED }).setOrigin(0, 0.5);
    this.currencyText = this.add.text(70, HEADER_Y, String(GameStore.birdCurrency), { resolution: TEXT_RESOLUTION, fontSize: FONT_H3, color: TEXT_PRIMARY }).setOrigin(0, 0.5);

    const btnX = this.scale.width / 2;
    const btnY = 140;
    this.add
      .rectangle(btnX, btnY, 160, 36, BG_ELEVATED)
      .setStrokeStyle(1, BORDER)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.doPull());
    const pullLabel = GameStore.state.hasFreeGacha ? 'Pull once (free)' : `Pull (${GACHA_COST} $Bird)`;
    this.add.text(btnX, btnY, pullLabel, { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_PRIMARY }).setOrigin(0.5);

    this.messageText = this.add.text(btnX, btnY + 44, '', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: DANGER_HEX }).setOrigin(0.5);

    this.resultImage = this.add
      .image(btnX, RESULT_IMAGE_Y, 'rarity-common')
      .setDisplaySize(RESULT_IMAGE_SIZE, RESULT_IMAGE_SIZE)
      .setVisible(false);

    const backX = this.scale.width - 44;
    this.add.rectangle(backX, HEADER_Y, 40, 24, BG_ELEVATED).setStrokeStyle(1, BORDER).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.goBack());
    this.add.text(backX, HEADER_Y, 'Back', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_PRIMARY }).setOrigin(0.5);
  }

  private goBack(): void {
    GameStore.save();
    this.scene.get('GameScene')?.events.emit('refresh');
    this.scene.stop('GachaScene');
  }

  private doPull(): void {
    this.messageText.setText('');
    this.messageText.setColor('#fc8181');
    if (this.resultImage) this.resultImage.setVisible(false);

    if (!GameStore.walletConnected) {
      if (!hasWallet()) {
        this.messageText.setText('No wallet. Install MetaMask first.');
        return;
      }
      connectWallet().then((result) => {
        if (result.ok) {
          GameStore.setWalletConnected(true, result.address);
          this.doPull();
        } else {
          this.messageText.setText(`Connection failed: ${result.error}`);
        }
      });
      return;
    }

    const gachaResult = GameStore.pullGacha(1);
    if (!gachaResult.ok) {
      this.messageText.setText(gachaResult.error ?? 'Error');
      return;
    }

    const bird = gachaResult.birds[0];
    this.currencyText.setText(String(GameStore.birdCurrency));
    if (this.resultImage && bird) {
      this.resultImage.setTexture(RARITY_TEXTURE_KEYS[bird.rarity]);
      this.resultImage.setVisible(true);
    }
    this.messageText.setColor(ACCENT_HEX);
    this.messageText.setText(bird?.rarity ?? '');

    if (!GameStore.state.hasShownPlacementHint) {
      this.showPlacementHint();
    }
  }

  private showPlacementHint(): void {
    if (this.hintModalObjects.length > 0) return;

    const w = this.scale.width;
    const h = this.scale.height;
    const depth = 500;

    const bg = this.add
      .rectangle(w / 2, h / 2, w, h, 0x000000, 0.5)
      .setDepth(depth)
      .setInteractive();
    this.hintModalObjects.push(bg);

    const box = this.add.rectangle(w / 2, h / 2, 320, 120, BG_CARD, 1).setStrokeStyle(1, BORDER).setDepth(depth + 1);
    this.hintModalObjects.push(box);

    const msg = this.add
      .text(w / 2, h / 2 - 24, 'Added to standby.\nPlace on deck to earn SEED.', {
        resolution: TEXT_RESOLUTION,
        fontSize: FONT_BODY,
        color: TEXT_PRIMARY,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(depth + 2);
    this.hintModalObjects.push(msg);

    const deployBtn = this.add
      .rectangle(w / 2, h / 2 + 28, 100, 28, SUCCESS)
      .setDepth(depth + 2)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        GameStore.setState({ hasShownPlacementHint: true });
        GameStore.save();
        this.hintModalObjects.forEach((o) => (o as unknown as { destroy?: () => void }).destroy?.());
        this.hintModalObjects = [];
        this.scene.get('GameScene')?.events.emit('refresh');
        this.scene.stop('GachaScene');
      });
    const deployLabel = this.add.text(w / 2, h / 2 + 28, 'To Deck', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY, color: TEXT_PRIMARY }).setOrigin(0.5).setDepth(depth + 2);
    this.hintModalObjects.push(deployBtn, deployLabel);
  }
}
