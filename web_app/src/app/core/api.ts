import { Injectable, inject } from '@angular/core';
import { Telegram } from './telegram';

export type WishStatus = 'approved' | 'rejected' | 'on_validation';
export type MediaType = 'image' | 'video' | 'video_note' | 'audio' | 'voice';

export interface MediaItem {
  id: string;
  type: MediaType;
  url: string;
}

export interface Me {
  registered: boolean;
  first_name?: string;
  timezone?: string;
  new_year_at?: string;
  invite_link?: string;
  invited?: number;
  /** The debug panel on the tree: DEBUG_TOOLS=1 on the server and an admin */
  debug?: boolean;
  /** How this session signed in */
  signed_in_with?: IdentityKind;
  /** Ways to sign in linked to the account (email: the address) */
  identities?: { telegram: boolean; email: string | null; google: boolean };
  /** Chosen notification channels */
  notify?: Channel[];
  /** Browsers subscribed to push notifications */
  push_devices?: number;
}

export type IdentityKind = 'telegram' | 'email' | 'google';
export type Channel = 'telegram' | 'push' | 'email';

/** What an account has: shown before merging two accounts */
export interface AccountSummary {
  registered_at: string;
  timezone: string;
  language: string;
  notify: Channel[];
  identities: IdentityKind[];
  email: string | null;
  wishes: number;
  mandarins: number;
  figures: number;
  gifts: number;
  friends: number;
}

/** What a merge does besides adding up (bot/src/services/accounts.py) */
export interface MergeReport {
  /** What must be chosen (keys of MergeChoices): both accounts have their own */
  conflicts: (keyof MergeChoices)[];
  refunded: number;
  refunded_mandarins: number;
  unplaced: number;
  rewards_dropped: number;
  rewards_dropped_mandarins: number;
  gifts_dropped: number;
  /** Ways to sign in that go away, and whose (the other one of the kind was chosen) */
  identities_dropped: { kind: IdentityKind; side: MergeSide; email: string | null }[];
}

export type MergeSide = 'mine' | 'other';
/** Whose to keep where both accounts have their own (absent: "mine") */
export type MergeChoices = Partial<
  Record<
    'timezone' | 'language' | 'notify' | 'telegram' | 'email' | 'google' | 'yard' | 'gifts',
    MergeSide
  >
>;

/** The merge done on the server and rolled back: what the merged account will have */
export interface MergePreview {
  result: AccountSummary;
  report: MergeReport;
}

/** A proof of another way to sign in, to link it to the account */
export type LinkProof =
  | { telegram: Record<string, unknown> }
  | { email: { email: string; code: string } }
  | { google: { credential: string } };

export type LinkResult =
  | { status: 'linked' | 'same' | 'replace'; me: Me }
  | {
      status: 'taken';
      merge_token: string;
      mine: AccountSummary;
      other: AccountSummary;
      preview: MergePreview;
      /** Choices that can't be "other" here (the Mini App keeps its Telegram) */
      locked: string[];
    };

export interface Config {
  bot_username: string;
  reactions: string[];
  timezones: string[];
  ball_colors: string[];
  ball_patterns: string[];
  rewards: Record<string, number>;
  /** Ways to sign in besides Telegram: absent / false = hidden */
  google_client_id?: string | null;
  email_login?: boolean;
  /** Web Push key (absent: push notifications are off on the server) */
  vapid_public_key?: string | null;
}

export type BallState = 'box' | 'hung' | 'lit';

export interface TreeBall {
  id: string;
  color: string;
  pattern: string;
  state: BallState;
  reactions: Record<string, number>;
  replies: number;
}

export interface TreeData {
  year: number;
  balls: TreeBall[];
  star: boolean;
  garland: number;
  mandarins: number;
  level: number;
  points: number;
  level_from: number;
  level_to: number | null;
  /** Courtyard figures from the shop: item key and pad index */
  decor?: { item: string; pad: number }[];
  /** Keys of all owned shop items */
  owned?: string[];
}

export type ShopCategory = 'figure' | 'lights' | 'weather';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface ShopItem {
  key: string;
  category: ShopCategory;
  rarity: Rarity;
  price: number;
  /** Set key, if the item belongs to a collection */
  set: string | null;
  /** > 0: a milestone gift, granted for this many invited friends (cannot be bought) */
  friends: number;
  owned: boolean;
  /** Courtyard place of an owned figure (null: not placed); the first one if there are copies */
  pad: number | null;
  /** Copies owned, and how many can be owned at most (figures: several, the rest: 1) */
  count: number;
  max: number;
  /** Courtyard places of the copies standing in the yard */
  pads: number[];
}

export interface ShopSet {
  key: string;
  bonus: number;
  items: string[];
  done: boolean;
}

export interface ShopData {
  balance: number;
  friends: number;
  items: ShopItem[];
  sets: ShopSet[];
}

export interface MandarinTx {
  amount: number;
  reason: string;
  created_at: string;
}

export interface Stats {
  year: number;
  participants: number;
  wishes: number;
  opened: number;
  reactions: number;
  timezones: Record<string, number>;
}

export interface MyWish {
  id: string;
  text: string;
  timestamp: string;
  status: WishStatus;
  media: MediaItem[];
  feedback: { recipients: number; reactions: Record<string, number>; replies: string[] };
}

export interface Delivery {
  id: string;
  year: number;
  opened_at: string | null;
  reaction: string | null;
  reply: string | null;
  wish: { text: string; media: MediaItem[] } | null;
}

export type Gift =
  | { status: 'waiting'; new_year_at: string }
  | { status: 'ready' }
  | { status: 'opened'; delivery: Delivery };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_KEY = 'santa.session';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly tg = inject(Telegram);

  /** Session token of the website login (not used in the Mini App) */
  get session(): string | null {
    return storage()?.getItem(SESSION_KEY) ?? null;
  }
  set session(token: string | null) {
    const s = storage();
    if (!s) return;
    if (token) s.setItem(SESSION_KEY, token);
    else s.removeItem(SESSION_KEY);
  }

  get canAuth(): boolean {
    return this.tg.isMiniApp || !!this.session;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.tg.isMiniApp) headers['Authorization'] = `tma ${this.tg.initData}`;
    else if (this.session) headers['Authorization'] = `Bearer ${this.session}`;

    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`/api${path}`, { method, headers, body: payload });
    if (response.status === 401 && !this.tg.isMiniApp) this.session = null;
    if (!response.ok) {
      let detail = response.statusText;
      try {
        detail = (await response.json()).detail ?? detail;
      } catch {}
      throw new ApiError(response.status, typeof detail === 'string' ? detail : 'Error');
    }
    return response.status === 204 ? (undefined as T) : response.json();
  }

  config = () => this.request<Config>('GET', '/config');
  stats = () => this.request<Stats>('GET', '/stats');
  me = () => this.request<Me>('GET', '/me');
  saveProfile = (timezone: string, ref?: string | null, language?: string) =>
    this.request<Me>('PUT', '/me', { timezone, ref: ref ?? null, language: language ?? null });

  private signIn = async (path: string, body: unknown) => {
    const { token } = await this.request<{ token: string }>('POST', path, body);
    this.session = token;
  };
  login = (widgetData: Record<string, unknown>) => this.signIn('/auth/telegram', widgetData);
  loginGoogle = (credential: string) => this.signIn('/auth/google', { credential });
  /** Sends a 6-digit code to the e-mail (to sign in or to link it) */
  emailStart = (email: string, language: string) =>
    this.request<{ sent: boolean; resend_after: number }>('POST', '/auth/email/start', {
      email,
      language,
    });
  loginEmail = (email: string, code: string) => this.signIn('/auth/email/verify', { email, code });
  logout = () => (this.session = null);

  link = (proof: LinkProof) => this.request<LinkResult>('POST', '/me/link', proof);
  mergePreview = (mergeToken: string, choices: MergeChoices) =>
    this.request<MergePreview>('POST', '/me/merge/preview', { merge_token: mergeToken, choices });
  /** `token`: a new session when the way this one signed in went away in the merge */
  merge = (mergeToken: string, choices: MergeChoices) =>
    this.request<{ me: Me; token?: string }>('POST', '/me/merge', {
      merge_token: mergeToken,
      choices,
    });
  unlink = (kind: IdentityKind) => this.request<Me>('DELETE', `/me/link/${kind}`);
  setNotify = (channels: Channel[]) => this.request<Me>('PUT', '/me/notify', { channels });
  pushSubscribe = (sub: PushSubscriptionJSON) => this.request<void>('POST', '/push', sub);
  pushRemove = (endpoint: string) => this.request<void>('POST', '/push/remove', { endpoint });

  wishes = () => this.request<MyWish[]>('GET', '/wishes');
  newWish = (text: string, files: File[], look?: { color: string; pattern: string }) => {
    const form = new FormData();
    form.append('text', text);
    if (look) {
      form.append('ball_color', look.color);
      form.append('ball_pattern', look.pattern);
    }
    files.forEach((f) => form.append('files', f, f.name));
    return this.request<{ id: string }>('POST', '/wishes', form);
  };
  deleteWish = (id: string) => this.request<void>('DELETE', `/wishes/${id}`);

  tree = () => this.request<TreeData>('GET', '/tree');
  mandarins = () => this.request<{ balance: number; history: MandarinTx[] }>('GET', '/mandarins');

  shop = () => this.request<ShopData>('GET', '/shop');
  buy = (item: string) => this.request<ShopData & { bonus: number }>('POST', '/shop/buy', { item });
  /** @param fromPad which copy: the one standing on this place (absent: a spare copy) */
  place = (item: string, pad: number | null, fromPad?: number) =>
    this.request<ShopData>('PUT', '/shop/place', { item, pad, from_pad: fromPad ?? null });

  /** Development only: force the festive level (null = real) and set the balance */
  debug = (body: { level?: number | null; mandarins?: number }) =>
    this.request<TreeData>('PUT', '/debug', body);

  gift = () => this.request<Gift>('GET', '/gift');
  openGift = () => this.request<Gift>('POST', '/gift/open');
  inbox = () => this.request<Delivery[]>('GET', '/inbox');
  react = (id: string, data: { reaction?: string; reply?: string }) =>
    this.request<{ reaction: string | null; reply: string | null }>(
      'POST',
      `/inbox/${id}/react`,
      data,
    );
}
