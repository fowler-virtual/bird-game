import type { BirdRarity } from './types';

// Vite の base に対応したアセットパス（GitHub Pages 等でも動くように）
const ASSET_BASE =
  (() => {
    try {
      const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
      return typeof env?.BASE_URL === 'string' ? env.BASE_URL : '/';
    } catch {
      return '/';
    }
  })();

/** レアリティ → public の画像パス（Adopt 結果・Farming/Deck DOM 表示・Vite base 対応） */
export const RARITY_IMAGE_SRC: Record<BirdRarity, string> = {
  // Common は frame1 を基準アイコンとして使用
  Common: ASSET_BASE + 'common-frame1.png',
  Uncommon: ASSET_BASE + 'uncommon.png',
  Rare: ASSET_BASE + 'rare.png',
  Epic: ASSET_BASE + 'epic.png',
  Legendary: ASSET_BASE + 'legendary.png',
};

/** Farming Loft 用: Common のフレーム画像（1〜6） */
export const COMMON_FRAME_SRCS: string[] = [
  ASSET_BASE + 'common-frame1.png',
  ASSET_BASE + 'common-frame2.png',
  ASSET_BASE + 'common-frame3.png',
  ASSET_BASE + 'common-frame4.png',
  ASSET_BASE + 'common-frame5.png',
  ASSET_BASE + 'common-frame6.png',
];

