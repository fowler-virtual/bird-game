/**
 * デザインシステム（Addicted / ハイパーニンジャ風：シンプルで洗練された Web3 UI）
 * Phaser 用 0xRRGGBB と DOM/CSS 用 # の両方を定義
 */

// ---- Background ----
/** 最深部・キャンバス背景 */
export const BG_PRIMARY = 0x0a0a0c;
export const BG_PRIMARY_HEX = '#0a0a0c';

/** サイドパネル・カード */
export const BG_CARD = 0x12121a;
export const BG_CARD_HEX = '#12121a';

/** エレベート（ボタン・スロット） */
export const BG_ELEVATED = 0x1a1a22;
export const BG_ELEVATED_HEX = '#1a1a22';

/** ホバー・アクティブ */
export const BG_HOVER = 0x252532;
export const BG_HOVER_HEX = '#252532';

// ---- Border ----
export const BORDER = 0x252530;
export const BORDER_HEX = '#252530';

/** 控えめなボーダー */
export const BORDER_SUBTLE = 0x1e1e28;
export const BORDER_SUBTLE_HEX = '#1e1e28';

// ---- Text ----
export const TEXT_PRIMARY = '#f4f4f5';
export const TEXT_PRIMARY_PHASER = 0xf4f4f5;

export const TEXT_MUTED = '#71717a';
export const TEXT_MUTED_PHASER = 0x71717a;

// ---- Accent（1色に絞って使用） ----
export const ACCENT = 0x10b981;
export const ACCENT_HEX = '#10b981';

/** アクセント・ディム（バッジ・グロー） */
export const ACCENT_DIM = 0x10b981;
export const ACCENT_DIM_ALPHA = 0.2;

// ---- Semantic ----
export const DANGER = 0xf87171;
export const DANGER_HEX = '#f87171';

export const SUCCESS = 0x10b981;
export const SUCCESS_HEX = '#10b981';

// ---- Set bonus glow ----
export const GLOW_NONE = 0x252532;
export const GLOW_SPECIES = 0x22c55e;
export const GLOW_COLOR = 0x06b6d4;
export const GLOW_SPECIES_COLOR = 0x8b5cf6;

export const SET_BONUS_GLOW: Record<string, number> = {
  none: GLOW_NONE,
  species: GLOW_SPECIES,
  color: GLOW_COLOR,
  speciesColor: GLOW_SPECIES_COLOR,
};

// ---- Rarity band（カード下段） ----
export const RARITY_COMMON = 0x22c55e;
export const RARITY_UNCOMMON = 0x3b82f6;
export const RARITY_RARE = 0x8b5cf6;
export const RARITY_EPIC = 0xa855f7;
export const RARITY_LEGENDARY = 0xeab308;

export const RARITY_BAND_COLOR: Record<string, number> = {
  Common: RARITY_COMMON,
  Uncommon: RARITY_UNCOMMON,
  Rare: RARITY_RARE,
  Epic: RARITY_EPIC,
  Legendary: RARITY_LEGENDARY,
};

// ---- Typography ----
export const FONT_LABEL = '11px';   // ラベル・キャプション
export const FONT_BODY = '13px';   // 本文
export const FONT_BODY_LARGE = '14px';
export const FONT_H3 = '16px';
export const FONT_H2 = '20px';
export const FONT_H1 = '28px';     // メイン数値など

export const LETTER_SPACING = '0.02em';

/** Phaser テキストをクリアに描画する解像度（TOP の DOM 文字に近づける） */
export const TEXT_RESOLUTION = 2;
