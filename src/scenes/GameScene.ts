import Phaser from 'phaser';
import { GameStore } from '../store/GameStore';
import { hideTitleUI, showTitleUI } from '../titleUI';
import { destroyPhaserGame } from '../phaserBoot';
import { isShellVisible, updateShellStatus, setCanvasCardDeckView, setDisconnectCallback, getLastCanvasCardSize } from '../domShell';
import { revokeWalletPermissions } from '../wallet';
import {
  getBirdById,
  getActiveSlotIndices,
  getActiveBirdsInDeck,
  evaluateSetBonus,
  getProductionRatePerHour,
  getNetworkSharePercent,
  DECK_SLOT_IDS,
  getNextUnlockCost,
  isSlotActive,
  getActiveSlotsByLoftLevel,
  MAX_LOFT_LEVEL,
  RARITY_TEXTURE_KEYS,
  getBirdTypeKeyForInventoryCell,
  type BirdTypeKey,
  type BirdRarity,
  type GameState,
} from '../types';
import {
  BG_PRIMARY,
  BG_CARD,
  BG_ELEVATED,
  BG_HOVER,
  BORDER,
  BORDER_SUBTLE,
  TEXT_PRIMARY,
  TEXT_MUTED,
  ACCENT,
  ACCENT_HEX,
  SUCCESS,
  SET_BONUS_GLOW,
  FONT_LABEL,
  FONT_BODY,
  FONT_BODY_LARGE,
  FONT_H3,
  FONT_H2,
  FONT_H1,
  TEXT_RESOLUTION,
} from '../theme';

const ACCRUAL_INTERVAL_MS = 2000;
const HEADER_Y = 28;
const LEFT_PANEL_WIDTH = 220;
/** この幅未満でドロワー＋フル幅コンテンツ、以上で左パネル常時表示（HyperFarm のように自動判定） */
const MOBILE_BREAKPOINT = 768;
const LOFT_COLS = 4;
const LOFT_ROWS = 2;
const LOFT_CELL = 88;
const LOFT_GAP = 16;
const LOFT_BIRD_SIZE = 72;
const PANEL_PADDING = 20;
const PANEL_TOP = 32;
const DECK_SLOTS = 8;
const DECK_HEADER_H = 44;
/** デッキ: 4列×2行。スタンバイ: 5列×8行。 */
const DECK_COLS = 4;
const SLOT_GAP = 10;

const INVENTORY_COLS = 5;
const INVENTORY_ROWS = 8;
const INVENTORY_CELLS_TOTAL = INVENTORY_COLS * INVENTORY_ROWS;

/** 鳥アイコンは外枠内に収める余白（px） */
const BIRD_INSET = 6;

/** 切り分け用: true にするとコンソールに Farming/Deck 表示まわりの診断ログを出す */
const DEBUG_LAYOUT = true;

/** デッキ画面で親サイズに合わせる際のフォールバック高さ。 */
const DECK_VIEW_FALLBACK_H = 1100;

/** resize でレイアウト/再描画を走らせない。停止後 1 回だけ。 */
const RESIZE_DEBOUNCE_MS = 120;

/** デッキレイアウトのヒステリシス: 幅が狭い→縦並びに切り替えるしきい値。これ未満で縦並び。 */
const DECK_LAYOUT_MOBILE_MAX = 820;
/** 幅が広い→横並びに戻すしきい値。これ以上で横並び。MOBILE_MAX と WIDE_MIN の間では前回のレイアウトを維持し、ギリギリでチラつかないようにする。 */
const DECK_LAYOUT_WIDE_MIN = 880;
const DECK_PANEL_PADDING = 24;
const DECK_PANEL_GAP = 16;
const DECK_BOTTOM_PADDING = 24;

type Screen = 'main' | 'deck';

export class GameScene extends Phaser.Scene {
  private screen: Screen = 'main';
  private mainPanel!: Phaser.GameObjects.Container;
  private deckPanel!: Phaser.GameObjects.Container;

  private seedText!: Phaser.GameObjects.Text;
  private networkShareText!: Phaser.GameObjects.Text;
  private productionPerDayText!: Phaser.GameObjects.Text;
  private accrualDeltaText: Phaser.GameObjects.Text | null = null;
  private accrualDeltaTimer: Phaser.Time.TimerEvent | null = null;
  private lastAccrualCheckTime = 0;
  private birdSprites: Phaser.GameObjects.Image[] = [];
  private loftContainer: Phaser.GameObjects.Container | null = null;
  private loftLevelText!: Phaser.GameObjects.Text;
  private loftSlotsText!: Phaser.GameObjects.Text;
  private upgradeLoftBtn: Phaser.GameObjects.Rectangle | null = null;
  private upgradeLoftLabel: Phaser.GameObjects.Text | null = null;

  private deckSeedText!: Phaser.GameObjects.Text;
  private birdText!: Phaser.GameObjects.Text;
  private deckTexts: Phaser.GameObjects.Text[] = [];
  private deckImages: Phaser.GameObjects.Image[] = [];
  private slotZones: Phaser.GameObjects.Rectangle[] = [];
  private slotGlows: Phaser.GameObjects.Rectangle[] = [];
  private deckSectionTitle: Phaser.GameObjects.Text | null = null;
  private standbySectionTitle: Phaser.GameObjects.Text | null = null;
  private standbySectionHint: Phaser.GameObjects.Text | null = null;
  private deckPanelBg: Phaser.GameObjects.Rectangle | null = null;
  private leftPanel!: Phaser.GameObjects.Container;
  private rightPanel!: Phaser.GameObjects.Container;
  private deckLeftPanelBg: Phaser.GameObjects.Rectangle | null = null;
  private deckRightPanelBg: Phaser.GameObjects.Rectangle | null = null;
  private deckStandbyWrapper: Phaser.GameObjects.Container | null = null;
  private deckHeaderBar: Phaser.GameObjects.Rectangle | null = null;
  private deckHeaderLine: Phaser.GameObjects.Rectangle | null = null;
  private inventoryContainer: Phaser.GameObjects.Container | null = null;
  private standbyMaskGraphics: Phaser.GameObjects.Graphics | null = null;
  private standbyScrollZone: Phaser.GameObjects.Rectangle | null = null;
  private standbyScrollY = 0;
  private standbyScrollStartY = 0;
  private standbyScrollStartPointer = 0;
  private selectedBirdTypeKey: BirdTypeKey | null = null;
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  /** Deck 時のみ: 前回 setParentSize した親サイズ。ループ防止＋Adopt 復帰時は 0 にして再取得させる */
  private lastDeckParentW = 0;
  private lastDeckParentH = 0;
  /** 前回の Deck レイアウトが横並びだったか。ヒステリシス用。null は未確定。 */
  private lastDeckLayoutWide: boolean | null = null;
  private slotPickerObjects: Phaser.GameObjects.GameObject[] = [];
  private unlockModalObjects: Phaser.GameObjects.GameObject[] = [];
  private leftPanelContainer!: Phaser.GameObjects.Container;
  private leftPanelBg!: Phaser.GameObjects.Rectangle;
  private drawerCloseBtn: Phaser.GameObjects.Rectangle | null = null;
  private drawerCloseLabel: Phaser.GameObjects.Text | null = null;
  private rightAreaBg!: Phaser.GameObjects.Rectangle;
  private drawerBackdrop: Phaser.GameObjects.Rectangle | null = null;
  private menuDomBtn: HTMLButtonElement | null = null;
  private drawerOpen = false;
  constructor() {
    super({ key: 'GameScene' });
  }

  /** 現在ブラウザに見えているキャンバス領域の「画面中央」に近いシーン座標を返す（モーダル配置用） */
  private getViewportCenter(): { x: number; y: number } {
    const w = this.scale.width;
    const h = this.scale.height;
    if (typeof window === 'undefined') return { x: w / 2, y: h / 2 };
    const canvas = this.scale.game?.canvas;
    const rect = canvas?.getBoundingClientRect();
    if (!rect || rect.height <= 0) {
      return { x: w / 2, y: h / 2 };
    }
    const viewCenterY = window.innerHeight / 2;
    const t = (viewCenterY - rect.top) / rect.height;
    // 画面外すぎないように 20%〜80% の範囲にクランプ
    const ty = Phaser.Math.Clamp(t, 0.2, 0.8);
    return { x: w / 2, y: ty * h };
  }

  preload(): void {
    let base = '/';
    try {
      const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
      if (typeof env?.BASE_URL === 'string') base = env.BASE_URL;
    } catch {
      /* use '/' */
    }
    this.load.image('rarity-common', base + 'common.png');
    this.load.image('rarity-uncommon', base + 'uncommon.png');
    this.load.image('rarity-rare', base + 'rare.png');
    this.load.image('rarity-epic', base + 'epic.png');
    this.load.image('rarity-legendary', base + 'legendary.png');
  }

  create(): void {
    setDisconnectCallback(() => this.doDisconnect());
    hideTitleUI();
    // 再接続で同じシーンが再利用されるため、破棄済み参照を捨てる
    this.slotPickerObjects = [];
    this.unlockModalObjects = [];

    GameStore.applyAccrual();
    GameStore.save();

    this.mainPanel = this.add.container(0, 0);
    this.buildMainPanel();
    this.deckPanel = this.add.container(0, 0);
    this.buildDeckPanel();
    this.deckPanel.setVisible(false);

    this.renderMainUI();
    this.renderDeckUI();
    this.lastAccrualCheckTime = Date.now();

    this.events.on('refresh', () => {
      this.renderMainUI();
      this.renderDeckUI();
    });
    this.scale.on('resize', this.onResize, this);

    this.mainPanel.setDepth(10);
    this.deckPanel.setDepth(10);
    this.events.once('postupdate', () => {
      this.applyMainLayout();
      this.renderMainUI();
      this.applyDeckLayout();
      this.renderDeckUI();
      this.syncScaleAfterShellVisible();
    });
  }

  /**
   * ゲームはシェル表示後に createPhaserGame() で作成されるため、boot 時点で親 #app は既に表示済み。
   * 念のため resizeInterval を短くし、getParentBounds() + refresh() を 1 回実行する。
   */
  private syncScaleAfterShellVisible(): void {
    (this.scale as Phaser.Scale.ScaleManager & { resizeInterval: number }).resizeInterval = 100;
    this.scale.getParentBounds();
    try {
      this.scale.refresh();
    } catch (_e) {
      /* 握りつぶす */
    }
    this.forceLayoutAndRender();
  }

  shutdown(): void {
    if (this.resizeDebounceTimer != null) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = undefined;
    }
    const win = typeof window !== 'undefined' ? (window as unknown as { __gameScene?: GameScene }) : null;
    if (win && win.__gameScene === this) win.__gameScene = undefined;
    const btn = document.getElementById('game-mobile-menu-btn');
    if (btn) btn.remove();
    this.menuDomBtn = null;
  }

  private buildMainPanel(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.leftPanelContainer = this.add.container(0, 0);
    this.leftPanelBg = this.add
      .rectangle(LEFT_PANEL_WIDTH / 2, h / 2, LEFT_PANEL_WIDTH, h, BG_CARD, 1)
      .setStrokeStyle(1, BORDER_SUBTLE);
    this.leftPanelContainer.add(this.leftPanelBg);

    const titleY = PANEL_TOP + 8;
    const title = this.add
      .text(PANEL_PADDING, titleY, 'CURRENT SEED', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED })
      .setOrigin(0, 0.5);
    this.leftPanelContainer.add(title);

    const valueY = titleY + 36;
    this.seedText = this.add
      .text(PANEL_PADDING, valueY, '0', { resolution: TEXT_RESOLUTION, fontSize: FONT_H1, color: ACCENT_HEX })
      .setOrigin(0, 0.5);
    this.leftPanelContainer.add(this.seedText);

    const subY = valueY + 32;
    this.accrualDeltaText = this.add
      .text(PANEL_PADDING, valueY + 22, '', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: ACCENT_HEX })
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.leftPanelContainer.add(this.accrualDeltaText!);

    const statY = subY;
    this.networkShareText = this.add
      .text(PANEL_PADDING, statY, 'Network Share: 0.00000%', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED })
      .setOrigin(0, 0.5);
    this.leftPanelContainer.add(this.networkShareText);

    const prodY = statY + 18;
    this.productionPerDayText = this.add
      .text(PANEL_PADDING, prodY, 'SEED/day: 0', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED })
      .setOrigin(0, 0.5);
    this.leftPanelContainer.add(this.productionPerDayText);

    const btnW = LEFT_PANEL_WIDTH - PANEL_PADDING * 2;
    const loftSectionY = prodY + 36;
    this.leftPanelContainer.add(
      this.add.text(PANEL_PADDING, loftSectionY, 'Loft', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED }).setOrigin(0, 0.5)
    );
    this.loftLevelText = this.add
      .text(PANEL_PADDING, loftSectionY + 20, 'Lv.1', { resolution: TEXT_RESOLUTION, fontSize: FONT_H3, color: TEXT_PRIMARY })
      .setOrigin(0, 0.5);
    this.leftPanelContainer.add(this.loftLevelText);
    this.loftSlotsText = this.add
      .text(PANEL_PADDING, loftSectionY + 38, '2/8 slots', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED })
      .setOrigin(0, 0.5);
    this.leftPanelContainer.add(this.loftSlotsText);
    const upgradeBtnY = loftSectionY + 68;
    this.upgradeLoftBtn = this.add
      .rectangle(PANEL_PADDING + btnW / 2, upgradeBtnY, btnW, 32, BG_ELEVATED, 1)
      .setStrokeStyle(1, BORDER)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.upgradeLoftBtn && this.upgradeLoftBtn!.visible && this.upgradeLoftBtn!.setFillStyle(BG_HOVER))
      .on('pointerout', () => this.upgradeLoftBtn && this.upgradeLoftBtn!.setFillStyle(BG_ELEVATED))
      .on('pointerdown', () => this.doUpgradeLoft());
    this.leftPanelContainer.add(this.upgradeLoftBtn);
    this.upgradeLoftLabel = this.add
      .text(PANEL_PADDING + btnW / 2, upgradeBtnY - 2, 'Upgrade', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY, color: TEXT_PRIMARY })
      .setOrigin(0.5);
    this.leftPanelContainer.add(this.upgradeLoftLabel);
    const btnH = 40;
    const debugBtnY = h - 172;
    const debugBtn = this.add
      .rectangle(PANEL_PADDING + btnW / 2, debugBtnY, btnW, btnH, BG_ELEVATED, 1)
      .setStrokeStyle(1, BORDER)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => debugBtn.setFillStyle(BG_HOVER))
      .on('pointerout', () => debugBtn.setFillStyle(BG_ELEVATED))
      .on('pointerdown', () => {
        this.setDrawerOpen(false);
        this.scene.launch('DebugScene');
        this.scene.bringToTop('DebugScene');
      });
    const debugLabel = this.add.text(PANEL_PADDING + btnW / 2, debugBtnY, 'Debug', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_PRIMARY }).setOrigin(0.5);
    this.leftPanelContainer.add([debugBtn, debugLabel]);

    const gachaBtnY = h - 120;
    const gachaBtn = this.add
      .rectangle(PANEL_PADDING + btnW / 2, gachaBtnY, btnW, btnH, BG_ELEVATED, 1)
      .setStrokeStyle(1, BORDER)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => gachaBtn.setFillStyle(BG_HOVER))
      .on('pointerout', () => gachaBtn.setFillStyle(BG_ELEVATED))
      .on('pointerdown', () => {
        this.setDrawerOpen(false);
        this.scene.launch('GachaScene');
        this.scene.bringToTop('GachaScene');
      });
    const gachaLabel = this.add.text(PANEL_PADDING + btnW / 2, gachaBtnY, 'Adopt', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_PRIMARY }).setOrigin(0.5);
    this.leftPanelContainer.add([gachaBtn, gachaLabel]);

    const deckBtnY = gachaBtnY + btnH + 12;
    const deckBtn = this.add
      .rectangle(PANEL_PADDING + btnW / 2, deckBtnY, btnW, btnH, BG_ELEVATED, 1)
      .setStrokeStyle(1, BORDER)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => deckBtn.setFillStyle(BG_HOVER))
      .on('pointerout', () => deckBtn.setFillStyle(BG_ELEVATED))
      .on('pointerdown', () => this.showDeck());
    const deckLabel = this.add.text(PANEL_PADDING + btnW / 2, deckBtnY, 'Deck', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_PRIMARY }).setOrigin(0.5);
    this.leftPanelContainer.add([deckBtn, deckLabel]);

    const disconnectBtnY = deckBtnY + btnH + 12;
    const disconnectBtn = this.add
      .rectangle(PANEL_PADDING + btnW / 2, disconnectBtnY, btnW, btnH, BG_ELEVATED, 1)
      .setStrokeStyle(1, BORDER)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => disconnectBtn.setFillStyle(BG_HOVER))
      .on('pointerout', () => disconnectBtn.setFillStyle(BG_ELEVATED))
      .on('pointerdown', () => this.doDisconnect());
    const disconnectLabel = this.add.text(PANEL_PADDING + btnW / 2, disconnectBtnY, 'Disconnect', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_PRIMARY }).setOrigin(0.5);
    this.leftPanelContainer.add([disconnectBtn, disconnectLabel]);

    const closeBtnY = HEADER_Y;
    const closeBtnX = w - 44;
    this.drawerCloseBtn = this.add
      .rectangle(closeBtnX, closeBtnY, 56, 32, BG_ELEVATED, 1)
      .setStrokeStyle(1, BORDER)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.setDrawerOpen(false))
      .on('pointerover', () => this.drawerCloseBtn?.setFillStyle(BG_HOVER))
      .on('pointerout', () => this.drawerCloseBtn?.setFillStyle(BG_ELEVATED));
    this.drawerCloseLabel = this.add.text(closeBtnX, closeBtnY, 'Close', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY, color: TEXT_PRIMARY }).setOrigin(0.5);
    this.leftPanelContainer.add([this.drawerCloseBtn, this.drawerCloseLabel]);
    this.drawerCloseBtn.setVisible(false);
    this.drawerCloseLabel.setVisible(false);

    this.rightAreaBg = this.add
      .rectangle(LEFT_PANEL_WIDTH + (w - LEFT_PANEL_WIDTH) / 2, h / 2, w - LEFT_PANEL_WIDTH, h, BG_PRIMARY, 1);
    this.mainPanel.add(this.rightAreaBg);

    this.loftContainer = this.add.container(LEFT_PANEL_WIDTH + (w - LEFT_PANEL_WIDTH) / 2, h / 2);
    this.mainPanel.add(this.loftContainer);

    this.drawerBackdrop = this.add
      .rectangle(w / 2, h / 2, w, h, 0x000000, 0.6)
      .setInteractive()
      .setVisible(false)
      .on('pointerdown', () => this.setDrawerOpen(false));
    this.drawerBackdrop.disableInteractive(); // 非表示の間は入力を受け取らない（左パネル・ガチャ等が押せるようにする）
    this.mainPanel.add(this.drawerBackdrop);

    this.mainPanel.add(this.leftPanelContainer);

    if (!this.useDomShell()) this.setupMobileMenuButton();
    (window as unknown as { __gameScene?: GameScene }).__gameScene = this;
    void this.showMain; // domShell.switchToTab から参照される

    this.applyMainLayout();
    if (typeof this.scale.refresh === 'function') this.scale.refresh();
  }

  /** DOM シェル（ヘッダー＋タブ）表示時は左パネル非表示・キャンバスはコンテナ幅に合わせる */
  private useDomShell(): boolean {
    return isShellVisible();
  }

  /** ビューポート幅のみで判定。Farming 復帰時は scale.displaySize が未更新だとずれるため、DOM シェル時はキャンバス親の幅で判定。 */
  private isNarrowViewport(): boolean {
    if (this.useDomShell() && this.screen === 'main') {
      const el = typeof document !== 'undefined' ? document.getElementById('shell-canvas-card') : null;
      const w = el?.getBoundingClientRect()?.width;
      if (typeof w === 'number' && w > 0) return w < MOBILE_BREAKPOINT;
    }
    return this.scale.displaySize.width < MOBILE_BREAKPOINT;
  }

  /** 狭いビューポート用: メニューボタン（フロート・自動レイアウト） */
  private setupMobileMenuButton(): void {
    if (typeof document === 'undefined') return;
    const app = document.getElementById('app');
    if (!app) return;
    const existing = document.getElementById('game-mobile-menu-btn');
    if (existing) existing.remove();
    const btn = document.createElement('button');
    btn.id = 'game-mobile-menu-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Menu');
    btn.textContent = '\u2630';
    btn.style.cssText =
      'position:fixed;right:16px;top:16px;width:48px;height:48px;z-index:9999;' +
      'background:#1a1a22;color:#f4f4f5;border:1px solid #252530;font-size:22px;' +
      'cursor:pointer;display:none;padding:0;line-height:1;pointer-events:auto;' +
      'border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.4);transition:transform 0.15s, box-shadow 0.15s;';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const scene = (window as unknown as { __gameScene?: GameScene }).__gameScene;
      if (scene && typeof scene.toggleDrawer === 'function') scene.toggleDrawer();
    });
    btn.addEventListener('touchstart', () => { btn.style.transform = 'scale(0.96)'; });
    btn.addEventListener('touchend', () => { btn.style.transform = ''; });
    btn.addEventListener('mouseenter', () => { btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.5)'; });
    btn.addEventListener('mouseleave', () => { btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)'; });
    app.appendChild(btn);
    this.menuDomBtn = btn;
    (window as unknown as { __gameScene?: GameScene }).__gameScene = this;
  }

  private setDrawerOpen(open: boolean): void {
    this.drawerOpen = open;
    if (this.isNarrowViewport()) {
      this.leftPanelContainer.x = open ? 0 : -LEFT_PANEL_WIDTH;
      if (this.drawerBackdrop) {
        this.drawerBackdrop.setVisible(open);
        if (open) this.drawerBackdrop.setInteractive().on('pointerdown', () => this.setDrawerOpen(false));
        else this.drawerBackdrop.disableInteractive();
      }
    } else {
      this.leftPanelContainer.x = 0;
      if (this.drawerBackdrop) {
        this.drawerBackdrop.setVisible(false);
        this.drawerBackdrop.disableInteractive();
      }
    }
  }

  private toggleDrawer(): void {
    if (!this.isNarrowViewport()) return;
    this.setDrawerOpen(!this.drawerOpen);
  }

  /** Main (Farming) は常にゲームサイズ 800x800 でレイアウト。タブ復帰時も scale が未更新だとアイコンサイズがずれるため固定値を使用。 */
  private applyMainLayout(): void {
    const w = 800;
    const h = 800;
    const useShell = this.useDomShell();
    const narrow = this.isNarrowViewport();
    const contentLeft = useShell ? 0 : (narrow ? 0 : LEFT_PANEL_WIDTH);
    const contentWidth = useShell ? w : (narrow ? w : w - LEFT_PANEL_WIDTH);
    const loftCenterX = contentLeft + contentWidth / 2;
    const loftCenterY = h / 2;

    this.leftPanelContainer.setVisible(!useShell);
    this.rightAreaBg.setPosition(loftCenterX, loftCenterY);
    this.rightAreaBg.setSize(contentWidth, h);
    this.loftContainer!.setPosition(loftCenterX, loftCenterY);

    if (this.menuDomBtn) this.menuDomBtn.style.display = useShell ? 'none' : (narrow ? 'block' : 'none');

    if (narrow) {
      if (!this.drawerOpen) {
        this.leftPanelContainer.x = -LEFT_PANEL_WIDTH;
        this.leftPanelBg.setSize(LEFT_PANEL_WIDTH, h);
        this.leftPanelBg.setPosition(LEFT_PANEL_WIDTH / 2, h / 2);
        if (this.drawerCloseBtn) this.drawerCloseBtn.setVisible(false);
        if (this.drawerCloseLabel) this.drawerCloseLabel.setVisible(false);
        if (this.drawerBackdrop) {
          this.drawerBackdrop.setVisible(false);
          this.drawerBackdrop.disableInteractive();
        }
      } else {
        this.leftPanelContainer.x = 0;
        this.leftPanelBg.setSize(w, h);
        this.leftPanelBg.setPosition(w / 2, h / 2);
        if (this.drawerCloseBtn) {
          this.drawerCloseBtn.setVisible(true);
          this.drawerCloseBtn.setPosition(w - 44, HEADER_Y);
        }
        if (this.drawerCloseLabel) {
          this.drawerCloseLabel.setVisible(true);
          this.drawerCloseLabel.setPosition(w - 44, HEADER_Y);
        }
        if (this.drawerBackdrop) {
          this.drawerBackdrop.setVisible(true);
          this.drawerBackdrop.setInteractive().on('pointerdown', () => this.setDrawerOpen(false));
        }
      }
    } else {
      this.leftPanelContainer.x = 0;
      this.drawerOpen = false;
      this.leftPanelBg.setSize(LEFT_PANEL_WIDTH, h);
      this.leftPanelBg.setPosition(LEFT_PANEL_WIDTH / 2, h / 2);
      if (this.drawerCloseBtn) this.drawerCloseBtn.setVisible(false);
      if (this.drawerCloseLabel) this.drawerCloseLabel.setVisible(false);
      if (this.drawerBackdrop) {
        this.drawerBackdrop.setVisible(false);
        this.drawerBackdrop.disableInteractive();
      }
    }
  }

  /** リサイズ時は debounce し、停止後に 1 回だけ再配置/再描画。ドラッグ中の連続再描画を禁止。 */
  private onResize(): void {
    if (this.resizeDebounceTimer != null) clearTimeout(this.resizeDebounceTimer);
    this.resizeDebounceTimer = setTimeout(() => {
      this.resizeDebounceTimer = undefined;
      this.forceLayoutAndRender();
    }, RESIZE_DEBOUNCE_MS);
  }

  /** タブ切替後・リサイズ debounce 後。Deck 時は必ず親サイズを再取得してから 1 回だけ layout/render。 */
  forceLayoutAndRender(): void {
    if (DEBUG_LAYOUT) {
      const canvas = this.scale.game?.canvas;
      const parent = canvas?.parentElement;
      const deckRect = this.screen === 'deck' ? this.getDeckParentRect() : null;
      const scaleW = this.scale.width;
      const scaleH = this.scale.height;
      console.log('[BirdGame] forceLayoutAndRender', {
        screen: this.screen,
        deckParentRect: deckRect,
        'this.scale': { width: scaleW, height: scaleH },
        canvasHidden: parent?.classList?.contains('canvas-card-hidden') ?? null,
        canvasDisplay: canvas ? getComputedStyle(canvas).display : null,
      });
    }
    if (this.screen === 'deck') {
      this.clearDeckParentSizeCache();
      this.syncDeckScaleFromParent();
      this.applyDeckLayout();
      this.renderDeckUI();
    } else {
      this.applyMainLayout();
      this.renderMainUI();
    }
  }

  private doDisconnect(): void {
    this.setDrawerOpen(false);
    GameStore.disconnectWallet();
    destroyPhaserGame();
    showTitleUI();
    revokeWalletPermissions().catch(() => {}); // 次回 Connect でダイアログが出るようにするだけ。UI は待たない
  }

  /** Deck 時の親サイズ。幅は canvas に引きずられない shell-content-inner から取り、狭い幅で縦並びに切り替わるようにする。高さはカードから。 */
  private getDeckParentRect(): { w: number; h: number } {
    if (this.useDomShell() && typeof document !== 'undefined') {
      const inner = document.getElementById('shell-content-inner');
      const card = document.getElementById('shell-canvas-card');
      const innerR = inner?.getBoundingClientRect?.();
      const cardR = card?.getBoundingClientRect?.();
      if (innerR && innerR.width > 0) {
        const h = cardR && cardR.height > 0 ? Math.floor(cardR.height) : DECK_VIEW_FALLBACK_H;
        return {
          w: Math.max(1, Math.floor(innerR.width)),
          h: Math.max(1, h),
        };
      }
    }
    const parent = this.scale.game?.canvas?.parentElement;
    const rect = parent?.getBoundingClientRect?.();
    return {
      w: Math.max(1, Math.floor(rect?.width ?? 800)),
      h: Math.max(1, Math.floor(rect?.height ?? DECK_VIEW_FALLBACK_H)),
    };
  }

  private showDeck(): void {
    this.screen = 'deck';
    this.lastDeckLayoutWide = null;
    this.setDrawerOpen(false);
    this.mainPanel.setVisible(false);
    this.deckPanel.setVisible(true);
    if (this.menuDomBtn) this.menuDomBtn.style.display = 'none';
    if (this.useDomShell()) setCanvasCardDeckView(true);

    const scale = this.scale as Phaser.Scale.ScaleManager & { scaleMode: number };
    scale.scaleMode = Phaser.Scale.RESIZE;
    const { w, h } = this.getDeckParentRect();
    this.scale.setParentSize(w, h);
    try {
      this.scale.refresh();
    } catch (_e) {
      // RESIZE 直後は Phaser 内部で undefined.width になる場合がある
    }
    this.lastDeckParentW = w;
    this.lastDeckParentH = h;
    this.applyDeckLayout();
    this.renderDeckUI();
  }

  private showMain(): void {
    this.screen = 'main';
    this.hideSlotPicker();
    this.hideUnlockConfirm();
    this.deckPanel.setVisible(false);
    this.mainPanel.setVisible(true);
    if (this.useDomShell()) setCanvasCardDeckView(false);

    // Adopt から戻ったときは #app が display:none だったため getParentBounds() が 0x0 を返す。隠す前に保存したサイズを使う。
    if (this.useDomShell()) {
      const saved = getLastCanvasCardSize();
      if (saved && saved.width > 0 && saved.height > 0) {
        this.scale.setParentSize(saved.width, saved.height);
      } else {
        const card = typeof document !== 'undefined' ? document.getElementById('shell-canvas-card') : null;
        const r = card?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          this.scale.setParentSize(Math.floor(r.width), Math.floor(r.height));
        } else {
          this.scale.getParentBounds();
        }
      }
    } else {
      this.scale.getParentBounds();
    }
    const scale = this.scale as Phaser.Scale.ScaleManager & { scaleMode: number };
    scale.scaleMode = Phaser.Scale.FIT;
    this.scale.resize(800, 800);
    try {
      this.scale.refresh();
    } catch (_e) {
      // scale 未確定時に refresh が落ちる場合がある
    }
    // レイアウト・描画は forceLayoutAndRender で 1 回だけ行う（applyMainLayout は固定 800x800 で一貫）
    this.applyMainLayout();
    this.renderMainUI();
  }

  private buildDeckPanel(): void {
    this.deckImages = [];
    this.deckTexts = [];
    this.slotZones = [];
    this.slotGlows = [];
    this.standbyScrollY = 0;

    const w = this.scale.width;
    const h = this.scale.height;
    const headerCenterY = DECK_HEADER_H / 2;

    this.deckPanelBg = this.add.rectangle(w / 2, h / 2, w, h, BG_CARD).setDepth(-1);
    this.deckPanel.add(this.deckPanelBg);

    this.deckHeaderBar = this.add
      .rectangle(w / 2, headerCenterY, w, DECK_HEADER_H, BG_ELEVATED, 1)
      .setStrokeStyle(0)
      .setOrigin(0.5, 0.5)
      .setVisible(false); // 上部の帯は不要なので非表示
    this.deckHeaderLine = this.add
      .rectangle(w / 2, DECK_HEADER_H, w, 1, BORDER, 1)
      .setOrigin(0.5, 0)
      .setVisible(false);
    this.deckPanel.add([this.deckHeaderBar, this.deckHeaderLine]);

    // Deck 画面上部の SEED / $BIRD 表示は DOM 側のステータスカードと重複するため非表示にする
    const seedLabel = this.add
      .text(DECK_PANEL_PADDING, headerCenterY, 'SEED', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED })
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.deckSeedText = this.add
      .text(DECK_PANEL_PADDING + 42, headerCenterY, '0', { resolution: TEXT_RESOLUTION, fontSize: FONT_H3, color: ACCENT_HEX })
      .setOrigin(0, 0.5)
      .setVisible(false);
    const birdLabel = this.add
      .text(DECK_PANEL_PADDING + 110, headerCenterY, '$BIRD', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED })
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.birdText = this.add
      .text(DECK_PANEL_PADDING + 168, headerCenterY, '0', { resolution: TEXT_RESOLUTION, fontSize: FONT_H3, color: TEXT_PRIMARY })
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.deckPanel.add([seedLabel, this.deckSeedText, birdLabel, this.birdText]);

    const sectionTitleStyle = { resolution: TEXT_RESOLUTION, fontSize: FONT_H2, color: TEXT_PRIMARY };
    const SECTION_TITLE_DEPTH = 900;

    this.leftPanel = this.add.container(0, 0);
    this.deckLeftPanelBg = this.add.rectangle(0, 0, 360, 280, BG_ELEVATED, 1).setStrokeStyle(1, BORDER).setOrigin(0, 0);
    this.leftPanel.add(this.deckLeftPanelBg);
    this.deckSectionTitle = this.add.text(0, 0, 'DECK', sectionTitleStyle).setOrigin(0.5, 0.5).setDepth(SECTION_TITLE_DEPTH);
    this.leftPanel.add(this.deckSectionTitle);

    const placehold = 64;
    for (let i = 0; i < DECK_SLOTS; i++) {
      const col = i % DECK_COLS;
      const row = Math.floor(i / DECK_COLS);
      const x = col * (placehold + SLOT_GAP) + placehold / 2;
      const y = row * (placehold + SLOT_GAP) + placehold / 2;
      const glow = this.add
        .rectangle(x, y, placehold + 8, placehold + 8, ACCENT, 0.2)
        .setVisible(false);
      this.slotGlows.push(glow);
      const zone = this.add
        .rectangle(x, y, placehold, placehold, BG_ELEVATED, 1)
        .setStrokeStyle(1, BORDER_SUBTLE)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.onDeckSlotClick(i));
      this.slotZones.push(zone);
      const img = this.add
        .image(x, y, 'rarity-common')
        .setDisplaySize(placehold - BIRD_INSET, placehold - BIRD_INSET)
        .setVisible(false);
      this.deckImages.push(img);
      const emptyLabel = this.add
        .text(x, y, '＋', { resolution: TEXT_RESOLUTION, fontSize: FONT_H3, color: TEXT_MUTED })
        .setOrigin(0.5);
      this.deckTexts.push(emptyLabel);
      this.leftPanel.add([glow, zone, img, emptyLabel]);
    }
    this.deckPanel.add(this.leftPanel);

    this.rightPanel = this.add.container(0, 0);
    this.deckRightPanelBg = this.add.rectangle(0, 0, 400, 400, BG_ELEVATED, 1).setStrokeStyle(1, BORDER).setOrigin(0, 0);
    this.rightPanel.add(this.deckRightPanelBg);
    this.standbySectionTitle = this.add.text(0, 0, 'Inventory', sectionTitleStyle).setOrigin(0.5, 0.5).setDepth(SECTION_TITLE_DEPTH);
    this.rightPanel.add(this.standbySectionTitle);
    const hintStyle = { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED };
    this.standbySectionHint = this.add
      .text(0, 0, 'Tap a bird below to assign to deck', hintStyle)
      .setOrigin(0.5, 0.5)
      .setDepth(SECTION_TITLE_DEPTH);
    this.rightPanel.add(this.standbySectionHint);

    this.inventoryContainer = this.add.container(0, 0);
    this.deckStandbyWrapper = this.add.container(0, 0);
    this.deckStandbyWrapper.add(this.inventoryContainer);
    this.rightPanel.add(this.deckStandbyWrapper);

    this.standbyMaskGraphics = this.add.graphics();
    this.standbyMaskGraphics.setVisible(false);
    this.rightPanel.add(this.standbyMaskGraphics);
    this.standbyScrollZone = this.add.rectangle(0, 0, 100, 100, 0x000000, 0).setInteractive({ useHandCursor: false });
    this.setupStandbyScrollZone();
    this.rightPanel.add(this.standbyScrollZone);

    this.deckPanel.add(this.rightPanel);

    this.applyDeckLayout();
  }

  private setupStandbyScrollZone(): void {
    if (!this.standbyScrollZone) return;
    this.standbyScrollZone.setDepth(1000);
    this.standbyScrollZone
      .on('pointerdown', (ptr: Phaser.Input.Pointer) => {
        this.standbyScrollStartY = this.standbyScrollY;
        this.standbyScrollStartPointer = ptr.y;
      })
      .on('pointermove', (ptr: Phaser.Input.Pointer) => {
        if (!ptr.isDown) return;
        const dy = ptr.y - this.standbyScrollStartPointer;
        this.standbyScrollY = Math.max(0, Math.min(this.getStandbyMaxScroll(), this.standbyScrollStartY + dy));
        this.standbyScrollStartPointer = ptr.y;
        this.standbyScrollStartY = this.standbyScrollY;
        this.applyDeckLayoutStandbyScroll();
      })
      .on('pointerup', () => {
        this.standbyScrollStartPointer = 0;
      });
  }

  private getStandbyContentHeight(): number {
    const layout = this.getDeckLayout();
    return layout.standbyRows * (layout.standbyCell + layout.standbyGap) - layout.standbyGap;
  }

  private getStandbyMaxScroll(): number {
    const layout = this.getDeckLayout();
    const visibleH = layout.standbyVisibleH;
    return Math.max(0, this.getStandbyContentHeight() - visibleH);
  }

  private applyDeckLayoutStandbyScroll(): void {
    if (!this.inventoryContainer) return;
    this.inventoryContainer.y = -this.standbyScrollY;
  }

  /** Deck 表示中のみ: 親 DOM サイズを再取得して setParentSize + refresh。lastDeckParent* と異なる時だけ更新してループ防止。 */
  private syncDeckScaleFromParent(): void {
    const { w, h } = this.getDeckParentRect();
    if (w === this.lastDeckParentW && h === this.lastDeckParentH) return;
    this.lastDeckParentW = w;
    this.lastDeckParentH = h;
    this.scale.setParentSize(w, h);
    try {
      this.scale.refresh();
    } catch (_e) {
      // scale 未確定時に refresh が落ちる場合がある
    }
  }

  /** Adopt から Deck に戻る際など、次回 syncDeckScaleFromParent で必ず親サイズを再取得するためにキャッシュをクリア。 */
  clearDeckParentSizeCache(): void {
    this.lastDeckParentW = 0;
    this.lastDeckParentH = 0;
  }

  /** switchToTab の最後に呼ぶ。現在タブに応じて scale モードを確定（Deck=RESIZE／その他=FIT）。Deck 時の refresh は forceLayoutAndRender 内の syncDeckScaleFromParent に任せ、二重 refresh で undefined 落ちしないようにする。 */
  ensureScaleModeForTab(tabId: string): void {
    const scale = this.scale as Phaser.Scale.ScaleManager & { scaleMode: number };
    if (tabId === 'deck') {
      scale.scaleMode = Phaser.Scale.RESIZE;
      const { w, h } = this.getDeckParentRect();
      this.scale.setParentSize(w, h);
    } else if (tabId === 'farming') {
      scale.scaleMode = Phaser.Scale.FIT;
      this.scale.resize(800, 800);
      try {
        this.scale.refresh();
      } catch (_e) {
        // scale 未確定時に refresh が落ちる場合がある
      }
    }
  }

  /** ヒステリシス付きで「縦並びか」を決める。820px 未満で縦、880px 以上で横、その間は前回を維持。 */
  private resolveDeckLayoutMobile(w: number): boolean {
    if (w >= DECK_LAYOUT_WIDE_MIN) {
      this.lastDeckLayoutWide = true;
      return false;
    }
    if (w <= DECK_LAYOUT_MOBILE_MAX) {
      this.lastDeckLayoutWide = false;
      return true;
    }
    if (this.lastDeckLayoutWide === null) {
      this.lastDeckLayoutWide = w >= (DECK_LAYOUT_MOBILE_MAX + DECK_LAYOUT_WIDE_MIN) / 2;
    }
    return !this.lastDeckLayoutWide;
  }

  /** デッキ枠・インベントリ枠の配置ルール。ヒステリシスで横並び⇔縦並びを切り替え。 */
  private getDeckLayout(): {
    w: number;
    h: number;
    isMobile: boolean;
    padding: number;
    top: number;
    gap: number;
    bottomPadding: number;
    leftW: number;
    leftPanelH: number;
    rightW: number;
    rightPanelH: number;
    leftPanelX: number;
    leftPanelY: number;
    rightPanelX: number;
    rightPanelY: number;
    deckCols: number;
    deckRows: number;
    slotSize: number;
    slotGap: number;
    deckLocalLeft: number;
    deckLocalTop: number;
    standbyCols: number;
    standbyRows: number;
    standbyCell: number;
    standbyGap: number;
    standbyGridW: number;
    inventoryLocalTop: number;
    standbyVisibleH: number;
    needsStandbyScroll: boolean;
  } {
    const w = this.scale.width;
    const h = this.scale.height;
    const isMobile = this.resolveDeckLayoutMobile(w);
    const padding = DECK_PANEL_PADDING;
    const gap = DECK_PANEL_GAP;
    const bottomPadding = DECK_BOTTOM_PADDING;
    const top = DECK_HEADER_H + 20;

    let leftW: number;
    let rightW: number;
    let leftPanelX: number;
    let leftPanelY: number;
    let rightPanelX: number;
    let rightPanelY: number;
    let leftPanelH: number;
    let rightPanelH: number;

    let deckCols: number;
    let deckRows: number;
    let slotSize: number;
    let slotGap: number;
    let standbyCols: number;
    let standbyCell: number;
    let standbyGap: number;

    if (isMobile) {
      leftW = w - padding * 2;
      rightW = w - padding * 2;
      deckCols = 4;
      deckRows = 2;
      slotGap = 8;
      const maxDeckGridWidth = Math.max(1, leftW - padding * 2);
      slotSize = Math.min(72, Math.floor((maxDeckGridWidth - (deckCols - 1) * slotGap) / deckCols));
      standbyCols = 4;
      standbyGap = 6;
      const baseStandbyCell = Math.min(72, Math.max(48, Math.floor((rightW - padding * 2 - (standbyCols - 1) * standbyGap) / standbyCols)));
      standbyCell = Math.min(baseStandbyCell, slotSize);
      const deckGridH = deckRows * slotSize + (deckRows - 1) * slotGap;
      leftPanelH = 28 + deckGridH + 24;
      leftPanelX = padding;
      leftPanelY = top;
      rightPanelX = padding;
      rightPanelY = top + leftPanelH + gap;
      rightPanelH = Math.max(200, h - rightPanelY - bottomPadding);
    } else {
      // 狭い幅では左パネルを小さくして Inventory に余裕を持たせる
      const targetLeft = Math.floor(w * (w < 900 ? 0.34 : 0.32));
      leftW = Math.max(300, Math.min(420, targetLeft));
      rightW = w - leftW - padding * 3;
      leftPanelX = padding;
      leftPanelY = top;
      rightPanelX = padding * 2 + leftW;
      rightPanelY = top;
      rightPanelH = h - top - bottomPadding;
      deckCols = 4;
      deckRows = 2;
      // 左パネル幅に収まるようにスロットサイズを調整（4体並べても Inventory 側にはみ出さない）
      slotGap = 10;
      const maxDeckGridWidth = Math.max(1, leftW - padding * 2);
      slotSize = Math.min(100, Math.floor((maxDeckGridWidth - (deckCols - 1) * slotGap) / deckCols));
      standbyCols = 5;
      standbyGap = 8;
      const baseStandbyCell = Math.min(80, Math.max(64, Math.floor((rightW - padding * 2 - (5 - 1) * standbyGap) / 5)));
      // Inventory の鳥アイコンがデッキより大きくならないように、セルサイズを deck の slotSize 以下に抑える
      standbyCell = Math.min(baseStandbyCell, slotSize);
      const deckGridH = deckRows * slotSize + (deckRows - 1) * slotGap;
      leftPanelH = 28 + deckGridH + 24;
    }

    const standbyRows = Math.ceil(INVENTORY_CELLS_TOTAL / standbyCols);
    const standbyGridW = standbyCols * standbyCell + (standbyCols - 1) * standbyGap;
    const inventoryLocalTop = 48;
    const standbyVisibleH = Math.max(120, rightPanelH - inventoryLocalTop - padding);
    const standbyContentH = standbyRows * standbyCell + (standbyRows - 1) * standbyGap - standbyGap;
    const needsStandbyScroll = standbyContentH > standbyVisibleH;

    return {
      w,
      h,
      isMobile,
      padding,
      top,
      gap,
      bottomPadding,
      leftW,
      leftPanelH,
      rightW,
      rightPanelH,
      leftPanelX,
      leftPanelY,
      rightPanelX,
      rightPanelY,
      deckCols,
      deckRows,
      slotSize,
      slotGap,
      deckLocalLeft: padding,
      deckLocalTop: 28,
      standbyCols,
      standbyRows,
      standbyCell,
      standbyGap,
      standbyGridW,
      inventoryLocalTop,
      standbyVisibleH,
      needsStandbyScroll,
    };
  }

  private applyDeckLayout(): void {
    const layout = this.getDeckLayout();
    const {
      w,
      h,
      leftW,
      leftPanelH,
      rightW,
      rightPanelH,
      leftPanelX,
      leftPanelY,
      rightPanelX,
      rightPanelY,
      deckCols,
      slotSize,
      slotGap,
      standbyGridW,
      standbyVisibleH,
      inventoryLocalTop,
      needsStandbyScroll,
    } = layout;
    const birdSize = Math.max(24, slotSize - BIRD_INSET);
    const deckGridW = deckCols * slotSize + (deckCols - 1) * slotGap;
    const deckGridLeft = Math.max(layout.padding, (leftW - deckGridW) / 2);

    if (this.deckPanelBg) {
      this.deckPanelBg.setPosition(w / 2, h / 2);
      this.deckPanelBg.setSize(w, h);
    }
    if (this.deckHeaderBar) {
      this.deckHeaderBar.setSize(w, DECK_HEADER_H);
      this.deckHeaderBar.setPosition(w / 2, DECK_HEADER_H / 2);
    }
    if (this.deckHeaderLine) {
      this.deckHeaderLine.setSize(w, 1);
      this.deckHeaderLine.setPosition(w / 2, DECK_HEADER_H);
    }

    this.leftPanel.setPosition(leftPanelX, leftPanelY);
    if (this.deckLeftPanelBg) {
      this.deckLeftPanelBg.setSize(leftW, leftPanelH);
    }
    if (this.deckSectionTitle) {
      this.deckSectionTitle.setPosition(deckGridLeft + deckGridW / 2, layout.deckLocalTop - 14);
    }

    const glowPad = 8;
    for (let i = 0; i < DECK_SLOTS; i++) {
      const col = i % deckCols;
      const row = Math.floor(i / deckCols);
      const x = deckGridLeft + col * (slotSize + slotGap) + slotSize / 2 + slotGap / 2;
      const y = layout.deckLocalTop + row * (slotSize + slotGap) + slotSize / 2 + slotGap / 2;
      this.slotGlows[i]?.setSize(slotSize + glowPad, slotSize + glowPad).setPosition(x, y);
      this.slotZones[i]?.setSize(slotSize, slotSize).setPosition(x, y);
      this.deckImages[i]?.setDisplaySize(birdSize, birdSize).setPosition(x, y);
      this.deckTexts[i]?.setPosition(x, y);
    }

    this.rightPanel.setPosition(rightPanelX, rightPanelY);
    if (this.deckRightPanelBg) {
      this.deckRightPanelBg.setSize(rightW, rightPanelH);
    }
    const invTitleY = 14;
    const invHintY = 32;
    if (this.standbySectionTitle) {
      this.standbySectionTitle.setPosition(rightW / 2, invTitleY);
    }
    if (this.standbySectionHint) {
      this.standbySectionHint.setPosition(rightW / 2, invHintY);
    }

    const inventoryLocalLeft = Math.max(layout.padding, (rightW - standbyGridW) / 2);
    if (this.deckStandbyWrapper) {
      this.deckStandbyWrapper.setPosition(inventoryLocalLeft, inventoryLocalTop);
    }

    this.standbyScrollY = Math.min(this.standbyScrollY, this.getStandbyMaxScroll());
    this.applyDeckLayoutStandbyScroll();

    if (needsStandbyScroll) {
      if (this.standbyMaskGraphics && this.deckStandbyWrapper) {
        this.standbyMaskGraphics.clear();
        this.standbyMaskGraphics.setPosition(inventoryLocalLeft, inventoryLocalTop);
        this.standbyMaskGraphics.fillStyle(0xffffff, 1);
        this.standbyMaskGraphics.fillRect(0, 0, standbyGridW, standbyVisibleH);
        const mask = this.standbyMaskGraphics.createGeometryMask();
        this.deckStandbyWrapper.setMask(mask);
      }
      if (this.standbyScrollZone) {
        this.standbyScrollZone.setPosition(inventoryLocalLeft + standbyGridW / 2, inventoryLocalTop + standbyVisibleH / 2);
        this.standbyScrollZone.setSize(standbyGridW, standbyVisibleH);
        this.standbyScrollZone.setVisible(true);
      }
    } else {
      this.standbyScrollY = 0;
      this.applyDeckLayoutStandbyScroll();
      if (this.deckStandbyWrapper) this.deckStandbyWrapper.clearMask();
      if (this.standbyScrollZone) this.standbyScrollZone.setVisible(false);
    }
  }

  private renderMainUI(): void {
    const delta = GameStore.applyAccrual();
    GameStore.save();
    const state = GameStore.state;
    this.seedText.setText(String(state.seed));
    const ratePerHour = getProductionRatePerHour(state);
    const ratePerDay = ratePerHour * 24;
    const share = getNetworkSharePercent(state);
    this.networkShareText.setText(`Network Share: ${share.toFixed(5)}%`);
    this.productionPerDayText.setText(`SEED/day: ${Math.floor(ratePerDay).toLocaleString()}`);
    const slots = getActiveSlotsByLoftLevel(state.loftLevel);
    this.loftLevelText.setText(`Lv.${state.loftLevel}`);
    this.loftSlotsText.setText(`${slots}/${MAX_LOFT_LEVEL * 2} slots`);
    if (this.useDomShell()) {
      updateShellStatus({
        seed: state.seed,
        seedPerDay: ratePerDay,
        loftLevel: state.loftLevel,
        networkSharePercent: share,
      });
    }
    const cost = getNextUnlockCost(state.unlockedDeckCount);
    const canUpgrade = cost != null && state.loftLevel < MAX_LOFT_LEVEL;
    if (this.upgradeLoftBtn && this.upgradeLoftLabel) {
      this.upgradeLoftBtn.setInteractive(canUpgrade ? { useHandCursor: true } : false);
      this.upgradeLoftBtn.setFillStyle(canUpgrade ? BG_ELEVATED : BG_CARD);
      this.upgradeLoftLabel.setColor(canUpgrade ? TEXT_PRIMARY : TEXT_MUTED);
    }
    this.renderLoftBirds();
    if (delta > 0) this.showAccrualDelta(delta);
  }

  private doUpgradeLoft(): void {
    if (getNextUnlockCost(GameStore.state.unlockedDeckCount) == null) return;
    this.showUpgradeConfirm();
  }

  private renderLoftBirds(): void {
    if (!this.loftContainer) return;
    this.loftContainer.removeAll(true);
    this.birdSprites = [];
    const state = GameStore.state;
    const activeIndices = getActiveSlotIndices(state);
    if (DEBUG_LAYOUT) {
      console.log('[BirdGame] renderLoftBirds', { activeIndices, deckSlots: state.deckSlots.slice(0, 4) });
    }
    const totalW = LOFT_COLS * LOFT_CELL + (LOFT_COLS - 1) * LOFT_GAP;
    const totalH = LOFT_ROWS * LOFT_CELL + (LOFT_ROWS - 1) * LOFT_GAP;
    const startX = -totalW / 2 + LOFT_CELL / 2;
    const startY = -totalH / 2 + LOFT_CELL / 2;
    activeIndices.forEach((slotIndex) => {
      const birdId = state.deckSlots[slotIndex];
      const col = slotIndex % LOFT_COLS;
      const row = Math.floor(slotIndex / LOFT_COLS);
      const x = startX + col * (LOFT_CELL + LOFT_GAP);
      const y = startY + row * (LOFT_CELL + LOFT_GAP);
      if (birdId == null) {
        const empty = this.add.rectangle(x, y, LOFT_CELL - 4, LOFT_CELL - 4, BG_ELEVATED, 0.5).setStrokeStyle(1, BORDER);
        this.loftContainer!.add(empty);
        return;
      }
      const bird = getBirdById(state, birdId);
      if (!bird) return;
      const texKey = RARITY_TEXTURE_KEYS[bird.rarity];
      const img = this.add.image(x, y, texKey).setDisplaySize(LOFT_BIRD_SIZE, LOFT_BIRD_SIZE);
      this.loftContainer!.add(img);
      this.birdSprites.push(img);
    });
    if (DEBUG_LAYOUT) {
      const list = this.loftContainer.list;
      const first = list[0] as Phaser.GameObjects.GameObject | undefined;
      console.log('[BirdGame] renderLoftBirds done', {
        loftContainerChildrenLength: list.length,
        birdSpritesLength: this.birdSprites.length,
        firstChild: first
          ? {
              visible: (first as unknown as Phaser.GameObjects.Components.Visible).visible,
              alpha: (first as unknown as Phaser.GameObjects.Components.Alpha).alpha,
              x: (first as unknown as Phaser.GameObjects.Components.Transform).x,
              y: (first as unknown as Phaser.GameObjects.Components.Transform).y,
            }
          : null,
      });
    }
  }

  private showAccrualDelta(delta: number): void {
    if (!this.accrualDeltaText) return;
    if (this.accrualDeltaTimer) {
      this.accrualDeltaTimer.destroy();
      this.accrualDeltaTimer = null;
    }
    this.accrualDeltaText.setText(`+${delta}`);
    this.accrualDeltaText.setVisible(true);
    this.accrualDeltaTimer = this.time.delayedCall(1200, () => {
      this.accrualDeltaText?.setVisible(false);
      this.accrualDeltaTimer = null;
    });
  }

  private renderDeckUI(): void {
    const state = GameStore.state;
    this.deckSeedText.setText(String(state.seed));
    this.birdText.setText(String(GameStore.birdCurrency));

    const activeBirds = getActiveBirdsInDeck(state);
    const setBonus = evaluateSetBonus(activeBirds);
    const glowColor = SET_BONUS_GLOW[setBonus.kind];

    for (let i = 0; i < DECK_SLOTS; i++) {
      const birdId = state.deckSlots[i];
      const text = this.deckTexts[i];
      const img = this.deckImages[i];
      const zone = this.slotZones[i];
      const glow = this.slotGlows[i];
      const locked = !isSlotActive(state, i);

      if (glow) {
        glow.setFillStyle(glowColor, 0.35);
        glow.setVisible(!locked && birdId != null && setBonus.kind !== 'none');
      }
      if (zone) zone.setFillStyle(locked ? BG_CARD : BG_ELEVATED, 1);

      if (locked) {
        if (img) img.setVisible(false);
        if (text) {
          text.setVisible(true);
          text.setText('—');
          text.setColor(TEXT_MUTED);
        }
      } else if (birdId == null) {
        if (img) img.setVisible(false);
        if (text) {
          text.setVisible(true);
          text.setText('＋');
          text.setColor(TEXT_MUTED);
        }
      } else {
        const bird = getBirdById(state, birdId);
        if (bird && img) {
          img.setTexture(RARITY_TEXTURE_KEYS[bird.rarity]);
          img.setVisible(true);
          if (text) text.setVisible(false);
        } else {
          if (img) img.setVisible(false);
          if (text) {
            text.setVisible(true);
            text.setText(bird ? bird.rarity.slice(0, 1) : '—');
            text.setColor(TEXT_PRIMARY);
          }
        }
      }
    }

    this.refreshInventoryGrid();
    if (DEBUG_LAYOUT) {
      const inv = this.inventoryContainer;
      console.log('[BirdGame] renderDeckUI done', {
        deckPanelVisible: this.deckPanel.visible,
        leftPanelVisible: this.leftPanel.visible,
        inventoryContainerChildrenLength: inv?.list?.length ?? 0,
        deckImagesLength: this.deckImages.length,
        firstDeckImage: this.deckImages[0]
          ? {
              visible: this.deckImages[0].visible,
              alpha: this.deckImages[0].alpha,
              x: this.deckImages[0].x,
              y: this.deckImages[0].y,
            }
          : null,
      });
    }
  }

  private refreshInventoryGrid(): void {
    if (!this.inventoryContainer) return;
    this.inventoryContainer.removeAll(true);
    const state = GameStore.state;
    const layout = this.getDeckLayout();
    const cell = layout.standbyCell;
    const gap = layout.standbyGap;
    const cols = layout.standbyCols;
    const imgSize = Math.max(24, cell - BIRD_INSET);
    const rarityMap: Record<string, BirdRarity> = {
      C: 'Common',
      U: 'Uncommon',
      R: 'Rare',
      E: 'Epic',
      L: 'Legendary',
    };

    for (let i = 0; i < INVENTORY_CELLS_TOTAL; i++) {
      const logicalRow = Math.floor(i / INVENTORY_COLS);
      const logicalCol = i % INVENTORY_COLS;
      const key = getBirdTypeKeyForInventoryCell(logicalRow, logicalCol);
      if (!key) continue;
      const displayCol = i % cols;
      const displayRow = Math.floor(i / cols);
      const cx = displayCol * (cell + gap) + cell / 2;
      const cy = displayRow * (cell + gap) + cell / 2;
      this.addInventoryCell(cx, cy, cell, imgSize, key, state, rarityMap);
    }
  }

  private addInventoryCell(
    cx: number,
    cy: number,
    cell: number,
    imgSize: number,
    key: BirdTypeKey,
    state: GameState,
    rarityMap: Record<string, BirdRarity>
  ): void {
    const count = state.inventory[key] ?? 0;
    const rarityCode = key.slice(0, 1);
    const rarity = rarityMap[rarityCode] ?? 'Common';
    const texKey = RARITY_TEXTURE_KEYS[rarity];

    const zone = this.add
      .rectangle(cx, cy, cell, cell, BG_ELEVATED, 1)
      .setStrokeStyle(1, BORDER_SUBTLE)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onInventoryCellClick(key, count));
    this.inventoryContainer!.add(zone);

    const inner = cell - 4;
    const cardBg = this.add.rectangle(cx, cy, inner, inner, BG_CARD, 1).setStrokeStyle(1, BORDER_SUBTLE);
    this.inventoryContainer!.add(cardBg);

    if (count > 0) {
      this.inventoryContainer!.add(
        this.add.image(cx, cy, texKey).setDisplaySize(imgSize, imgSize)
      );
      const countText = this.add
        .text(cx + cell / 2 - 5, cy - cell / 2 + 4, `×${count}`, { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY, color: TEXT_PRIMARY })
        .setOrigin(1, 0);
      this.inventoryContainer!.add(countText);
    } else {
      const slotBg = this.add.rectangle(cx, cy, imgSize, imgSize, BG_ELEVATED, 0.6).setStrokeStyle(1, BORDER_SUBTLE);
      this.inventoryContainer!.add(slotBg);
      this.inventoryContainer!.add(
        this.add.text(cx, cy, '?', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_MUTED }).setOrigin(0.5)
      );
    }
  }

  private onInventoryCellClick(key: BirdTypeKey, count: number): void {
    if (count < 1) return;
    this.selectedBirdTypeKey = key;
    this.showSlotPicker();
  }

  private onDeckSlotClick(slotIndex: number): void {
    const state = GameStore.state;
    if (!isSlotActive(state, slotIndex)) {
      this.showUpgradeConfirm();
      return;
    }
    if (this.selectedBirdTypeKey != null) {
      if (state.deckSlots[slotIndex] === null) {
        GameStore.applyAccrual();
        const ok = GameStore.placeBirdOnDeck(slotIndex, this.selectedBirdTypeKey);
        GameStore.save();
        if (ok) {
          this.hideSlotPicker();
          this.selectedBirdTypeKey = null;
        }
        this.renderDeckUI();
        return;
      }
      return;
    }
    const birdId = state.deckSlots[slotIndex];
    if (birdId == null) return;
    GameStore.applyAccrual();
    GameStore.removeBirdFromDeck(slotIndex);
    GameStore.save();
    this.renderDeckUI();
  }

  private showSlotPicker(): void {
    this.clearSlotPickerObjects();
    const w = this.scale.width;
    const btnY = 200;
    const btnSize = 40;
    const btnGap = 6;
    const depth = 1000;
    const state = GameStore.state;
    const activeIndices = getActiveSlotIndices(state).filter((i) => state.deckSlots[i] === null);
    const totalW = activeIndices.length * btnSize + Math.max(0, activeIndices.length - 1) * btnGap;
    const startX = (w - totalW) / 2 + (activeIndices.length > 0 ? btnSize / 2 + btnGap / 2 : 0);

    const bg = this.add
      .rectangle(w / 2, this.scale.height / 2, w, this.scale.height, 0x000000, 0.5)
      .setDepth(depth)
      .setInteractive()
      .on('pointerdown', () => this.hideSlotPicker());
    this.slotPickerObjects.push(bg);
    this.slotPickerObjects.push(
      this.add.text(w / 2, 160, 'Choose slot', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_MUTED }).setOrigin(0.5).setDepth(depth + 1)
    );
    activeIndices.forEach((slotIndex, idx) => {
      const x = startX + idx * (btnSize + btnGap);
      const btn = this.add
        .rectangle(x, btnY, btnSize, btnSize, BG_ELEVATED)
        .setDepth(depth + 2)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          if (!isSlotActive(GameStore.state, slotIndex) || GameStore.state.deckSlots[slotIndex] !== null) return;
          const key = this.selectedBirdTypeKey;
          if (key == null) return;
          GameStore.applyAccrual();
          const ok = GameStore.placeBirdOnDeck(slotIndex, key);
          GameStore.save();
          if (ok) {
            this.hideSlotPicker();
            this.selectedBirdTypeKey = null;
          }
          this.renderDeckUI();
        });
      this.slotPickerObjects.push(btn, this.add.text(x, btnY, DECK_SLOT_IDS[slotIndex], { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY, color: TEXT_PRIMARY }).setOrigin(0.5).setDepth(depth + 2));
    });
  }

  private clearSlotPickerObjects(): void {
    this.slotPickerObjects.forEach((o) => (o as Phaser.GameObjects.GameObject).destroy());
    this.slotPickerObjects.length = 0;
  }

  private hideSlotPicker(): void {
    this.selectedBirdTypeKey = null;
    this.clearSlotPickerObjects();
  }

  private showUpgradeConfirm(): void {
    const cost = getNextUnlockCost(GameStore.state.unlockedDeckCount);
    if (!cost) return;
    const canAfford =
      GameStore.state.seed >= cost.seed && GameStore.birdCurrency >= cost.bird;
    const lackSeed = GameStore.state.seed < cost.seed;
    const lackBird = GameStore.birdCurrency < cost.bird;
    const shortageMsg =
      lackSeed && lackBird
        ? 'Not enough SEED and $Bird'
        : lackSeed
          ? 'Not enough SEED'
          : lackBird
            ? 'Not enough $Bird'
            : '';

    this.hideUnlockConfirm();
    const w = this.scale.width;
    const h = this.scale.height;
    // ブラウザで実際に見えているキャンバス領域の中央付近にモーダルを出す
    const vp = this.getViewportCenter();
    const centerY = vp.y;
    const depth = 1001;
    const bg = this.add
      .rectangle(w / 2, h / 2, w, h, 0x000000, 0.5)
      .setDepth(depth)
      .setInteractive()
      .on('pointerdown', () => this.hideUnlockConfirm());
    this.unlockModalObjects.push(bg);
    this.unlockModalObjects.push(
      this.add.rectangle(w / 2, centerY, 280, 140, BG_CARD, 1).setStrokeStyle(1, BORDER).setDepth(depth + 1),
      this.add.text(w / 2, centerY - 40, 'Upgrade Loft?', { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY_LARGE, color: TEXT_PRIMARY }).setOrigin(0.5).setDepth(depth + 2),
      this.add.text(w / 2, centerY - 14, '2 slots will be unlocked.', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_MUTED }).setOrigin(0.5).setDepth(depth + 2),
      this.add.text(w / 2, centerY + 10, `${cost.seed} SEED + ${cost.bird} $B`, { resolution: TEXT_RESOLUTION, fontSize: FONT_BODY, color: canAfford ? TEXT_PRIMARY : '#f87171' }).setOrigin(0.5).setDepth(depth + 2),
      this.add.text(w / 2, centerY + 32, shortageMsg, { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: '#f87171' }).setOrigin(0.5).setDepth(depth + 2).setVisible(!canAfford)
    );
    const cancelBtn = this.add
      .rectangle(w / 2 - 52, centerY + 54, 64, 26, BG_ELEVATED)
      .setDepth(depth + 2)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.hideUnlockConfirm());
    this.unlockModalObjects.push(cancelBtn, this.add.text(w / 2 - 52, centerY + 54, 'Cancel', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_PRIMARY }).setOrigin(0.5).setDepth(depth + 2));
    const upgradeBtn = this.add
      .rectangle(w / 2 + 52, centerY + 54, 64, 26, canAfford ? SUCCESS : BG_HOVER)
      .setDepth(depth + 2)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        if (!GameStore.unlockNextDeckSlot()) return;
        GameStore.save();
        this.hideUnlockConfirm();
        this.renderMainUI();
        this.events.emit('refresh');
      });
    this.unlockModalObjects.push(upgradeBtn, this.add.text(w / 2 + 52, centerY + 54, 'Upgrade', { resolution: TEXT_RESOLUTION, fontSize: FONT_LABEL, color: TEXT_PRIMARY }).setOrigin(0.5).setDepth(depth + 2));
  }

  private hideUnlockConfirm(): void {
    this.unlockModalObjects.forEach((o) => (o as Phaser.GameObjects.GameObject).destroy());
    this.unlockModalObjects.length = 0;
  }

  private _updateTick = 0;
  update(): void {
    if (DEBUG_LAYOUT) {
      this._updateTick += 1;
      if (this._updateTick % 60 === 0) {
        console.log('[BirdGame] Phaser update running', { screen: this.screen, tick: this._updateTick });
      }
    }
    if (this.screen !== 'main') return;
    const now = Date.now();
    if (now - this.lastAccrualCheckTime >= ACCRUAL_INTERVAL_MS) {
      this.lastAccrualCheckTime = now;
      const delta = GameStore.applyAccrual();
      GameStore.save();
      if (delta > 0) this.showAccrualDelta(delta);
      this.renderMainUI();
    }
    for (let i = 0; i < this.birdSprites.length; i++) {
      const s = this.birdSprites[i];
      if (!s.active) continue;
      const t = (now / 1000 + i * 0.5) % (Math.PI * 2);
      s.y += Math.sin(t) * 0.15;
    }
  }
}
