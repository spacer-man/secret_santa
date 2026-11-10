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
}

export interface Config {
  bot_username: string;
  reactions: string[];
  timezones: string[];
  ball_colors: string[];
  ball_patterns: string[];
  rewards: Record<string, number>;
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
  saveProfile = (timezone: string, ref?: string | null) =>
    this.request<Me>('PUT', '/me', { timezone, ref: ref ?? null });

  login = async (widgetData: Record<string, unknown>) => {
    const { token } = await this.request<{ token: string }>('POST', '/auth/telegram', widgetData);
    this.session = token;
  };
  logout = () => (this.session = null);

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
