import { readFileSync } from 'node:fs';
import type { UsageSnapshot, UsageWindow, UsageWindows } from '../../../shared/contracts';
import { isRecord } from '../../../shared/guards';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const DEFAULT_POLL_SECONDS = 180;
const RETRY_MS = 30_000;
const EXPIRED_MESSAGE = 'Token har gått ut – starta Claude Code så förnyas den';

export interface UsageMonitor {
  start(): void;
  stop(): void;
  refreshNow(): void;
  ingest(windows: UsageWindows): void;
  current(): UsageSnapshot;
}

export interface UsageMonitorOptions {
  onSnapshot: (s: UsageSnapshot) => void;
  pollSeconds?: number;
  /** Claude Code's `.credentials.json` (holds the OAuth token; never refreshed here). */
  credentialsPath: string;
  fetchImpl?: typeof fetch;
}

function parseWindow(raw: unknown): UsageWindow | null {
  if (!isRecord(raw) || typeof raw.utilization !== 'number') return null;
  return { utilization: raw.utilization, resetsAt: typeof raw.resets_at === 'string' ? raw.resets_at : null };
}

export function parseUsageResponse(json: unknown): UsageWindows & { available: string[] } {
  const body = isRecord(json) ? json : {};
  return {
    fiveHour: parseWindow(body.five_hour) ?? { utilization: 0, resetsAt: null },
    sevenDay: parseWindow(body.seven_day),
    available: availableBeyondLimits(body),
  };
}

/** "12,50 USD" from an amount in minor units. */
function money(value: unknown): string | null {
  if (!isRecord(value) || typeof value.amount_minor !== 'number') return null;
  const exponent = typeof value.exponent === 'number' ? value.exponent : 2;
  const amount = (value.amount_minor / 10 ** exponent).toLocaleString('sv-SE', { minimumFractionDigits: exponent, maximumFractionDigits: exponent });
  return `${amount} ${typeof value.currency === 'string' ? value.currency : ''}`.trim();
}

/** What the account can use once the plan's limits are reached: extra usage, credits, a balance, promotions. */
export function availableBeyondLimits(body: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const extra = isRecord(body.extra_usage) ? body.extra_usage : null;
  const spend = isRecord(body.spend) ? body.spend : null;
  if (extra?.is_enabled === true || spend?.enabled === true) {
    const balance = money(spend?.balance);
    const limit = money(spend?.limit);
    lines.push(`Extra användning är på${balance ? `, ${balance} kvar` : limit ? `, gräns ${limit}` : ''}`);
  } else if (spend && money(spend.balance)) {
    lines.push(`Krediter: ${money(spend.balance)}`);
  }
  if (body.promo_credits != null) lines.push('Kampanjkrediter finns');
  if (body.omelette_promotional != null) lines.push('Kampanj aktiv');
  return lines;
}

interface Credentials {
  accessToken: string;
  expiresAt: number;
}

function readCredentials(path: string): Credentials | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const oauth = isRecord(raw) ? raw.claudeAiOauth : null;
    if (!isRecord(oauth) || typeof oauth.accessToken !== 'string') return null;
    return { accessToken: oauth.accessToken, expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : Infinity };
  } catch {
    return null;
  }
}

async function fetchWindows(fetchImpl: typeof fetch, token: string): Promise<UsageWindows> {
  const response = await fetchImpl(USAGE_URL, {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
  });
  if (response.status === 401) throw new Error(EXPIRED_MESSAGE);
  if (!response.ok) throw new Error(`Användningsdata kunde inte hämtas (HTTP ${response.status})`);
  return parseUsageResponse(await response.json());
}

export function createUsageMonitor(opts: UsageMonitorOptions): UsageMonitor {
  const pollMs = (opts.pollSeconds ?? DEFAULT_POLL_SECONDS) * 1000;
  const credentialsPath = opts.credentialsPath;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let snapshot: UsageSnapshot = { fiveHour: null, sevenDay: null, updatedAt: 0, source: 'none' };
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const publish = (next: UsageSnapshot): void => {
    snapshot = next;
    opts.onSnapshot(snapshot);
  };

  const fail = (message: string): void => publish({ ...snapshot, error: message });

  const schedule = (delayMs: number): void => {
    if (timer) clearTimeout(timer);
    timer = running ? setTimeout(() => void poll(), delayMs) : null;
  };

  async function poll(): Promise<void> {
    const credentials = readCredentials(credentialsPath);
    if (!credentials) {
      fail('Hittar ingen Claude-inloggning – starta Claude Code');
      return schedule(RETRY_MS);
    }
    if (credentials.expiresAt <= Date.now()) {
      fail(EXPIRED_MESSAGE);
      return schedule(RETRY_MS);
    }
    try {
      const windows = await fetchWindows(fetchImpl, credentials.accessToken);
      publish({ ...windows, updatedAt: Date.now(), source: 'oauth' });
      schedule(pollMs);
    } catch (error) {
      fail(error instanceof Error && error.message === EXPIRED_MESSAGE ? EXPIRED_MESSAGE : 'Kunde inte hämta användning – försöker igen');
      schedule(RETRY_MS);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      void poll();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    refreshNow() {
      void poll();
    },
    ingest(windows) {
      publish({
        fiveHour: windows.fiveHour ?? snapshot.fiveHour,
        sevenDay: windows.sevenDay ?? snapshot.sevenDay,
        available: snapshot.available,
        updatedAt: Date.now(),
        source: 'stream',
      });
    },
    current: () => snapshot,
  };
}
