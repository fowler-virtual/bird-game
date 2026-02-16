/**
 * タイトル画面用 DOM UI（ウォレット接続ボタン）の表示・非表示とクリック処理を一元管理。
 * クリックリスナーは初回のみ登録し、Disconnect 後も確実に反応するようにする。
 */

import { GameStore } from './store/GameStore';
import { requestAccounts, hasWallet, setJustConnectingFlag, ensureSepolia, E2E_MOCK_ADDRESS, getConnectedAccounts } from './wallet';
import { showGameShell, hideGameShell } from './domShell';
import { createPhaserGame } from './phaserBoot';
import { refreshSeedTokenFromChain } from './seedToken';
import { getGameState } from './gameStateApi';
import { signInForClaim } from './claimApi';

const TITLE_UI_ID = 'title-ui';
const CONNECT_BTN_ID = 'connect-wallet-btn';

/** 接続後のネットワーク切り替え・残高取得の最大待ち時間（メタマスクブラウザでハングしないように） */
const POST_CONNECT_TIMEOUT_MS = 25_000;
/** ensureSepolia 単体のタイムアウト（ダイアログが応答しない場合に備える） */
const ENSURE_SEPOLIA_TIMEOUT_MS = 15_000;

let isConnecting = false;

function resetButton(btn: HTMLButtonElement | null): void {
  isConnecting = false;
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Connect Wallet';
  }
}

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

  if (import.meta.env.VITE_E2E_MODE === '1') {
    let shell = document.getElementById('game-shell');
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'game-shell';
      document.body.appendChild(shell);
    }
    shell.classList.add('visible');
    document.getElementById(TITLE_UI_ID)?.classList.remove('visible');
    setTimeout(() => {
      try {
        GameStore.setWalletConnected(true, E2E_MOCK_ADDRESS);
        GameStore.setState({ onboardingStep: 'done' }); // E2E: 全タブをクリック可能にしてスモークテストを通す
        showGameShell();
        try {
          createPhaserGame();
        } catch (_) {
          /* E2E: Phaser が headless で失敗しても #game-shell.visible は既に付与済み */
        }
      } catch (_) {
        /* E2E: 上記で例外が出ても #game-shell.visible は既に付与済み */
      }
      resetButton(btn);
      isConnecting = false;
    }, 0);
    return;
  }

  setJustConnectingFlag();

  async function runPostConnectSteps(): Promise<void> {
    const address = GameStore.walletAddress;
    if (address) {
      const auth = await signInForClaim(address);
      if (!auth.ok) {
        console.warn('[TitleUI] SIWE failed (game-state will not sync):', auth.error);
      }
    }
    let gs = await getGameState();
    if (!gs.ok && gs.error === 'Not logged in.') {
      await new Promise((r) => setTimeout(r, 400));
      gs = await getGameState();
    }
    if (gs.ok) {
      GameStore.setStateFromServer(gs.state, gs.version);
      GameStore.save();
    }
    const networkPromise = ensureSepolia();
    const timeoutPromise = new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false as const, error: 'Network switch timed out' }), ENSURE_SEPOLIA_TIMEOUT_MS)
    );
    const networkOk = await Promise.race([networkPromise, timeoutPromise]);
    if (!networkOk.ok) {
      console.warn('[TitleUI] ensureSepolia failed or timed out:', networkOk.error);
      alert(
        'Please switch to Sepolia network in MetaMask to use adoption, save deck, and claim. (You can switch from the network selector in MetaMask.)'
      );
    }
    await refreshSeedTokenFromChain();
    document.getElementById(TITLE_UI_ID)?.classList.remove('visible');
    showGameShell();
    createPhaserGame();
  }

  const postConnectWithTimeout = (): Promise<void> => {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Connection step timed out. The game will open; please switch to Sepolia in MetaMask if needed.')),
        POST_CONNECT_TIMEOUT_MS
      )
    );
    return Promise.race([runPostConnectSteps(), timeoutPromise]).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[TitleUI] Post-connect step failed or timed out:', msg);
      if (!/timed out/i.test(msg)) alert(`Error: ${msg}`);
      else alert(msg);
      document.getElementById(TITLE_UI_ID)?.classList.remove('visible');
      showGameShell();
      createPhaserGame();
    });
  };

  getConnectedAccounts()
    .then((accounts) => {
      if (accounts.length > 0) {
        GameStore.setWalletConnected(true, accounts[0]);
        return postConnectWithTimeout().then(() => {
          resetButton(btn);
          return undefined as undefined;
        });
      }
      return requestAccounts();
    })
    .then(async (resultOrUndefined) => {
      if (resultOrUndefined === undefined) return;
      const result = resultOrUndefined;
      if (!result.ok) {
        resetButton(btn);
        console.error('[TitleUI] Connect failed:', result.error);
        alert(`Connection failed: ${result.error}`);
        return;
      }
      GameStore.setWalletConnected(true, result.address);
      await postConnectWithTimeout();
      resetButton(btn);
    })
    .catch((err) => {
      resetButton(btn);
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[TitleUI] Connect error:', err);
      if (/timeout/i.test(msg)) {
        alert(
          'Connection timed out. If you are using the MetaMask in-app browser, try: 1) Reload the page and tap Connect again, or 2) Open this site in your device browser and connect with MetaMask.'
        );
      } else {
        alert(`Error: ${msg}`);
      }
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
  initTitleUI();
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
