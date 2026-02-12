/**
 * タイトル画面用 DOM UI（ウォレット接続ボタン）の表示・非表示とクリック処理を一元管理。
 * クリックリスナーは初回のみ登録し、Disconnect 後も確実に反応するようにする。
 */

import { GameStore } from './store/GameStore';
import { requestAccounts, hasWallet, setJustConnectingFlag, ensureSepolia } from './wallet';
import { showGameShell, hideGameShell } from './domShell';
import { createPhaserGame } from './phaserBoot';
import { refreshSeedTokenFromChain } from './seedToken';

const TITLE_UI_ID = 'title-ui';
const CONNECT_BTN_ID = 'connect-wallet-btn';

let isConnecting = false;

/** 接続成功後に GameScene へ遷移するフラグ（TitleScene.update で参照） */
export let pendingStartGameScene = false;

function onConnectClick(): void {
  if (!hasWallet()) {
    alert('No wallet detected. Install MetaMask or another Web3 wallet.');
    return;
  }
  if (isConnecting) return;
  const btn = document.getElementById(CONNECT_BTN_ID) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Connecting...';
  }
  isConnecting = true;
  setJustConnectingFlag();

  const promise = requestAccounts();
  promise
    .then(async (result) => {
      isConnecting = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Connect Wallet';
      }
      if (!result.ok) {
        console.error('[TitleUI] Connect failed:', result.error);
        alert(`Connection failed: ${result.error}`);
        return;
      }
      const address = result.address;
      GameStore.setWalletConnected(true, address);
      await refreshSeedTokenFromChain();

      // 本番は Sepolia 用のため、接続直後に Sepolia へ切り替え（ガス不要）。未追加時は追加してから切り替え。
      const networkOk = await ensureSepolia();
      if (!networkOk.ok) {
        console.warn('[TitleUI] ensureSepolia failed:', networkOk.error);
        alert(
          'Please switch to Sepolia network in MetaMask to use adoption, save deck, and claim. (You can switch from the network selector in MetaMask.)'
        );
      }

      showGameShell();
      createPhaserGame();
    })
    .catch((err) => {
      isConnecting = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Connect Wallet';
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[TitleUI] Connect error:', err);
      alert(`Error: ${msg}`);
    });
}

let listenerAttached = false;

/**
 * ページ読み込み後に一度だけ呼ぶ。Connect ボタンにリスナーを永続的に登録する。
 * Disconnect 後もリスナーは外さないため、再接続時に確実に反応する。
 */
export function initTitleUI(): void {
  if (listenerAttached) return;
  const btn = document.getElementById(CONNECT_BTN_ID) as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener('click', onConnectClick);
  listenerAttached = true;
}

export function showTitleUI(): void {
  hideGameShell();
  const el = document.getElementById(TITLE_UI_ID);
  if (el) {
    el.classList.add('visible');
    el.setAttribute('aria-hidden', 'false');
  }
  const btn = document.getElementById(CONNECT_BTN_ID) as HTMLButtonElement | null;
  if (btn) {
    btn.textContent = 'Connect Wallet';
    btn.disabled = false;
  }
}

export function hideTitleUI(): void {
  const el = document.getElementById(TITLE_UI_ID);
  if (el) {
    el.classList.remove('visible');
    el.setAttribute('aria-hidden', 'true');
  }
  isConnecting = false;
  pendingStartGameScene = false;
  showGameShell();
}

export function resetTitleUIState(): void {
  isConnecting = false;
  pendingStartGameScene = false;
}
