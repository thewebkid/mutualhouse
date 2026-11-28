import { reactive } from 'vue';

/**
 * Central reactive application state (`becise` `globalState` heritage).
 *
 * `activeHouse` holds a live `reactive(House.create(def))` domain instance.
 * All mutations to shared room state flow through `house-orchestration.js`.
 */
export const globalState = reactive({
  authReady: false,
  currentUser: null, // { id, email, name, hasPasskey }
  viewerCountry: null, // 2-letter ISO country from x-vercel-ip-country when available
  myHouses: [], // [{ id, slug, name, coordinates, purpose, roleLabel }]
  activeHouse: null, // House domain instance
  activeRoomSlug: 'common-room',
  loadingHouse: false,
  errorBanner: null,
  noticeBanner: null,

  // Responsive UI & Inspector state
  ui: {
    theme: getInitialTheme(), // 'light' | 'dark'
    mobileNavOpen: false,
    inspectorTab: null, // null | 'receipt' | 'packet' | 'memory' | 'inhabitants'
    inspectedTurnId: null,
    inspectedReceiptId: null,
    activeHouseView: 'room', // 'room' | 'memory' | 'constitution' | 'housekeeping'
    replyingToTurnId: null,
    newlyMintedKey: null, // shown once after minting mh_... key
    devMagicLinkUrl: null, // surfaced in local dev when RESEND_API_KEY is unset
  },

  // Inline Peripatetic Voice Recorder state
  voice: {
    recording: false,
    uploading: false,
    durationMs: 0,
    level: 0, // 0..1 live input amplitude from AnalyserNode
    mimeType: '',
    error: null,
  },

  // 2-Occupant Room Audio/Video Call state
  call: {
    status: 'idle', // 'idle' | 'joining' | 'ringing' | 'connected' | 'failed'
    roomId: null,
    sessionId: null,
    polite: false,
    audioEnabled: true,
    videoEnabled: true,
    screenSharing: false,
    localStream: null,
    remoteStream: null,
    peerInhabitantId: null,
    error: null,
  },
});

function getInitialTheme() {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('mh-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function setTheme(nextTheme) {
  const theme = nextTheme === 'dark' ? 'dark' : 'light';
  globalState.ui.theme = theme;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('mh-theme', theme);
  }
}

export function toggleTheme() {
  setTheme(globalState.ui.theme === 'dark' ? 'light' : 'dark');
}

export function getActiveRoom() {
  if (!globalState.activeHouse) return null;
  return (
    globalState.activeHouse.getRoom(globalState.activeRoomSlug) ??
    globalState.activeHouse.activeRooms[0] ??
    null
  );
}

export function showNotice(msg, ms = 4500) {
  globalState.noticeBanner = msg;
  if (ms > 0) {
    setTimeout(() => {
      if (globalState.noticeBanner === msg) globalState.noticeBanner = null;
    }, ms);
  }
}

export function showError(msg) {
  globalState.errorBanner = msg;
}

export function clearBanners() {
  globalState.errorBanner = null;
  globalState.noticeBanner = null;
}

if (typeof window !== 'undefined') {
  window.globalState = globalState;
  document.documentElement.setAttribute('data-theme', globalState.ui.theme);
}
