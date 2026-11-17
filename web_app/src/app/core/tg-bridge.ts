/**
 * Loads Telegram's Mini App script without blocking the page.
 *
 * telegram.org is slow or blocked for some users (the script used to be a blocking <script> in
 * index.html — the page stayed white until it timed out). Now:
 *  - outside Telegram the script is not loaded at all (the site does not need it);
 *  - inside Telegram it is loaded with a timeout; if it does not arrive, a small built-in bridge
 *    takes its place. It speaks the documented protocol: https://core.telegram.org/api/web-events
 */

const SCRIPT = 'https://telegram.org/js/telegram-web-app.js?59';
const TIMEOUT_MS = 3000;
const STORE = 'santa.tgLaunch';

type Listener = () => void;
type HomeScreenStatus = 'unsupported' | 'unknown' | 'added' | 'missed';

/** Launch parameters Telegram puts into the URL hash (#tgWebAppData=…&tgWebAppPlatform=…) */
function launchParams(): URLSearchParams {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has('tgWebAppData')) {
    try {
      sessionStorage.setItem(STORE, location.hash.slice(1));
    } catch {
      /* private mode */
    }
    return hash;
  }
  // A reload inside Telegram may come without the hash
  try {
    return new URLSearchParams(sessionStorage.getItem(STORE) ?? '');
  } catch {
    return new URLSearchParams();
  }
}

export async function loadTelegram(): Promise<void> {
  const params = launchParams();
  if (!params.has('tgWebAppData')) return; // a regular browser
  const loaded = await loadScript(SCRIPT, TIMEOUT_MS);
  if (!loaded || !window.Telegram?.WebApp?.initData) installBridge(params);
}

function loadScript(src: string, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    const timer = setTimeout(() => resolve(false), timeout);
    s.src = src;
    s.async = true;
    s.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    s.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    document.head.append(s);
  });
}

function postEvent(eventType: string, eventData: object = {}): void {
  const data = JSON.stringify(eventData);
  const w = window as unknown as {
    TelegramWebviewProxy?: { postEvent(type: string, data: string): void };
    external?: { notify?(msg: string): void };
  };
  try {
    if (w.TelegramWebviewProxy)
      w.TelegramWebviewProxy.postEvent(eventType, data); // mobile / desktop
    else if (w.external?.notify) w.external.notify(JSON.stringify({ eventType, eventData }));
    else window.parent.postMessage(JSON.stringify({ eventType, eventData }), '*'); // web clients
  } catch {
    /* not inside Telegram after all */
  }
}

function installBridge(params: URLSearchParams): void {
  const initData = params.get('tgWebAppData') ?? '';
  const data = new URLSearchParams(initData);
  let user: { language_code?: string; first_name?: string } | undefined;
  try {
    user = JSON.parse(data.get('user') ?? 'null') ?? undefined;
  } catch {
    user = undefined;
  }
  const listeners = new Map<string, Set<Listener>>();
  const on = (event: string, cb: Listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
  };
  const emit = (event: string) => listeners.get(event)?.forEach((cb) => cb());
  // Version of the Bot API the client speaks: features like the home screen shortcut need 8.0
  const version = params.get('tgWebAppVersion') ?? '6.0';
  const atLeast = (want: string) => {
    const [a, b] = [version, want].map((v) => v.split('.').map(Number));
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    }
    return true;
  };
  /** Answers to "is the app on the home screen?" (one question at a time is enough) */
  let homeScreenAnswer: ((status: HomeScreenStatus) => void) | undefined;

  const scheme = (theme: string | null): 'light' | 'dark' | undefined => {
    try {
      const bg: string | undefined = JSON.parse(theme ?? '{}').bg_color;
      if (!bg || !/^#[0-9a-f]{6}$/i.test(bg)) return undefined;
      const n = parseInt(bg.slice(1), 16);
      const luma = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
      return luma < 128 ? 'dark' : 'light';
    } catch {
      return undefined;
    }
  };

  const app: NonNullable<NonNullable<Window['Telegram']>['WebApp']> = {
    initData,
    initDataUnsafe: { start_param: data.get('start_param') ?? undefined, user },
    platform: params.get('tgWebAppPlatform') ?? 'unknown',
    colorScheme: scheme(params.get('tgWebAppThemeParams')),
    onEvent: (event, cb) => on(event, cb),
    ready: () => postEvent('web_app_ready'),
    expand: () => postEvent('web_app_expand'),
    setHeaderColor: (color) => postEvent('web_app_set_header_color', { color }),
    setBackgroundColor: (color) => postEvent('web_app_set_background_color', { color }),
    openTelegramLink: (url) =>
      postEvent('web_app_open_tg_link', { path_full: url.replace(/^https:\/\/t\.me/, '') }),
    openLink: (url) => postEvent('web_app_open_link', { url }),
    disableVerticalSwipes: () =>
      postEvent('web_app_setup_swipe_behavior', { allow_vertical_swipe: false }),
    HapticFeedback: {
      impactOccurred: (impact_style) =>
        postEvent('web_app_trigger_haptic_feedback', { type: 'impact', impact_style }),
      notificationOccurred: (notification_type) =>
        postEvent('web_app_trigger_haptic_feedback', { type: 'notification', notification_type }),
    },
    isVersionAtLeast: atLeast,
    // The shortcut to the Mini App on the home screen (Santa offers it, see Install)
    checkHomeScreenStatus: (cb) => {
      homeScreenAnswer = cb;
      postEvent('web_app_check_home_screen');
    },
    addToHomeScreen: () => postEvent('web_app_add_to_home_screen'),
    BackButton: {
      show: () => postEvent('web_app_setup_back_button', { is_visible: true }),
      hide: () => postEvent('web_app_setup_back_button', { is_visible: false }),
      onClick: (cb) => on('backButtonClicked', cb),
      offClick: (cb) => listeners.get('backButtonClicked')?.delete(cb),
    },
  };

  // Events from Telegram: native clients call WebView.receiveEvent, web clients post a message
  const receive = (
    eventType: string,
    eventData: { theme_params?: object; status?: HomeScreenStatus } | undefined,
  ) => {
    if (eventType === 'back_button_pressed') emit('backButtonClicked');
    if (eventType === 'home_screen_added') emit('homeScreenAdded');
    if (eventType === 'home_screen_checked') {
      homeScreenAnswer?.(eventData?.status ?? 'unknown');
      homeScreenAnswer = undefined;
    }
    if (eventType === 'theme_changed') {
      app.colorScheme = scheme(JSON.stringify(eventData?.theme_params ?? {})) ?? app.colorScheme;
      emit('themeChanged');
    }
  };
  addEventListener('message', (e) => {
    try {
      const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (msg?.eventType) receive(msg.eventType, msg.eventData);
    } catch {
      /* not ours */
    }
  });
  const tg = window as unknown as {
    Telegram?: { WebApp?: typeof app; WebView?: { receiveEvent(t: string, d: unknown): void } };
  };
  tg.Telegram = {
    ...tg.Telegram,
    WebApp: app,
    WebView: { receiveEvent: (t, d) => receive(t, d as { theme_params?: object }) },
  };
}
