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

/** レアリティ → public の画像パス（Adopt 結果・Loft/Inventory DOM 表示・Vite base 対応）
 *  現状は全レアリティとも Java Sparrow のカード絵を指す想定。
 */
export const RARITY_IMAGE_SRC: Record<BirdRarity, string> = {
  Common: ASSET_BASE + 'java_sparrow_common.png',
  Uncommon: ASSET_BASE + 'java_sparrow_uncommon.png',
  Rare: ASSET_BASE + 'java_sparrow_rare.png',
  Epic: ASSET_BASE + 'java_sparrow_epic.png',
  Legendary: ASSET_BASE + 'java_sparrow_legendary.png',
};

/** Farming Loft 用: Common Java Sparrow のフレーム画像（1〜6） */
export const COMMON_FRAME_SRCS: string[] = [
  ASSET_BASE + 'java_sparrow_common_frame1.png',
  ASSET_BASE + 'java_sparrow_common_frame2.png',
  ASSET_BASE + 'java_sparrow_common_frame3.png',
  ASSET_BASE + 'java_sparrow_common_frame4.png',
  ASSET_BASE + 'java_sparrow_common_frame5.png',
  ASSET_BASE + 'java_sparrow_common_frame6.png',
];

