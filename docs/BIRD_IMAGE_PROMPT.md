# 鳥アイコン画像生成用プロンプト（別 AI 用）

Farming / Deck / ガチャで使う「鳥」のサンプル画像を生成するときのプロンプト例です。  
**5 枚セット**（Common / Uncommon / Rare / Epic / Legendary）で、同じトーンのイラストにするとゲーム内で統一感が出ます。

---

## 技術仕様（どの AI でも共通）

- **枚数**: 5 枚（レアリティごとに 1 枚）
- **サイズ**: **正方形**（1:1）。推奨 **144×144px** 以上（72px でも可）
- **形式**: PNG、**背景は透過**（透明）が望ましい
- **ファイル名**: `common.png`, `uncommon.png`, `rare.png`, `epic.png`, `legendary.png` のいずれかで保存し、`public/` に配置

---

## プロンプト例（英語・汎用）

### 共通の雰囲気

- かわいい **ゲームアイコン** 風
- **小鳥**（文鳥・インコっぽい丸みのあるシルエット）
- **正面またはやや斜め**、顔がはっきり見える
- デフォルメ・**ミニマル**（細部より形と色でレアリティが分かるとよい）

### 1. 共通ベース（5 枚とも同じ文で、最後だけレアリティを変える）

```
Cute cartoon bird character for a mobile game icon, small round bird (finch or parrot style), facing slightly forward, simple shapes, soft colors, transparent background, square composition, centered, 144x144px style, [RARITY] tier design.
```

**[RARITY] の入れ替え例**

| ファイル名      | [RARITY] 部分の例 |
|-----------------|--------------------|
| common.png      | common, plain gray or brown, no shine |
| uncommon.png    | uncommon, slight green or teal tint, simple |
| rare.png        | rare, light blue or purple glow, a bit shiny |
| epic.png        | epic, golden or purple accent, sparkle |
| legendary.png   | legendary, golden aura or crown, most detailed |

### 2. もう少し具体的に（文鳥・インコベース）

```
Cute chibi bird icon for a casual game, round body like a finch or budgie, big round eyes, small beak, single character only, flat design with soft shading, no background (transparent), square frame, icon style. Rarity: [Common / Uncommon / Rare / Epic / Legendary]. Make the [rarity] one feel [common = simple gray-brown | uncommon = soft green tint | rare = light blue glow | epic = purple or gold accent | legendary = golden and special].
```

### 3. 日本語で渡す場合の例

```
モバイルゲームのアイコン用、かわいいデフォルメの小鳥（文鳥かインコのような丸い体型）を 1 羽だけ描いてください。正面またはやや斜め向き、はっきりした顔、シンプルな形、やわらかい色使い、背景は透明、正方形の構図で中央に配置。レアリティは「Common（ノーマル）」で、地味めのグレーや茶色、装飾なし。
```

※ Uncommon / Rare / Epic / Legendary 用は、最後の「レアリティは〜」の部分だけ変えて 5 回生成するとよいです。

---

## レアリティごとの差をつけるコツ

- **Common**: 色はグレー・茶系、装飾なし、一番シンプル
- **Uncommon**: くすんだ緑やティールのトーン、やや変化
- **Rare**: 青や紫の光やキラキラを少し
- **Epic**: 金や紫のアクセント、小さな光や星
- **Legendary**: 金のオーラ、王冠や羽の装飾、一番「特別」感

**重要**: 5 枚とも「同じ画風・同じポーズ・同じサイズ感」にすると、ゲーム内で並べたときに違和感が少なくなります。  
「同じプロンプトで、[RARITY] の 1 語だけ変えて 5 回生成」するやり方がおすすめです。

---

## 生成後の配置

1. 5 枚を `common.png`, `uncommon.png`, `rare.png`, `epic.png`, `legendary.png` の名前で保存
2. プロジェクトの **`public/`** フォルダに置く
3. 既存の同名ファイルは上書きで OK（コードの変更は不要）
