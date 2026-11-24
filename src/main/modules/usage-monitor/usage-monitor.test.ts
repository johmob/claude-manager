import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { UsageSnapshot } from '../../../shared/contracts';
import { createUsageMonitor, parseUsageResponse } from './index';

function credentialsFile(expiresAt: number): string {
  const file = join(mkdtempSync(join(tmpdir(), 'usage-')), '.credentials.json');
  writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt } }));
  return file;
}

const okFetch = (body: unknown): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe('parseUsageResponse', () => {
  it('maps both windows', () => {
    expect(parseUsageResponse({ five_hour: { utilization: 12, resets_at: 'x' }, seven_day: { utilization: 40, resets_at: null } })).toEqual({
      fiveHour: { utilization: 12, resetsAt: 'x' },
      sevenDay: { utilization: 40, resetsAt: null },
      available: [],
    });
  });

  it('treats a null five_hour as zero use', () => {
    expect(parseUsageResponse({ five_hour: null, seven_day: null })).toEqual({
      fiveHour: { utilization: 0, resetsAt: null },
      sevenDay: null,
      available: [],
    });
  });
});

describe('usage monitor', () => {
  it('polls once and emits an oauth snapshot with the bearer token', async () => {
    const fetchImpl = okFetch({ five_hour: { utilization: 5, resets_at: null }, seven_day: { utilization: 9, resets_at: null } });
    const snapshots: UsageSnapshot[] = [];
    const monitor = createUsageMonitor({ onSnapshot: (s) => snapshots.push(s), credentialsPath: credentialsFile(Date.now() + 60_000), fetchImpl });
    monitor.start();
    await vi.waitFor(() => expect(snapshots.length).toBe(1));
    monitor.stop();
    expect(snapshots[0].source).toBe('oauth');
    expect(snapshots[0].sevenDay?.utilization).toBe(9);
    const headers = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('does not call the API with an expired token', async () => {
    const fetchImpl = okFetch({});
    const snapshots: UsageSnapshot[] = [];
    const monitor = createUsageMonitor({ onSnapshot: (s) => snapshots.push(s), credentialsPath: credentialsFile(1), fetchImpl });
    monitor.start();
    await vi.waitFor(() => expect(snapshots.length).toBe(1));
    monitor.stop();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(snapshots[0].error).toContain('Token har gått ut');
  });

  it('merges ingested stream windows', () => {
    const monitor = createUsageMonitor({ onSnapshot: () => undefined, credentialsPath: 'missing' });
    monitor.ingest({ fiveHour: { utilization: 30, resetsAt: null }, sevenDay: null });
    expect(monitor.current()).toMatchObject({ source: 'stream', fiveHour: { utilization: 30 }, sevenDay: null });
  });
});

describe('what the account has beyond the limits', () => {
  it('lists extra usage and credits, and nothing when there is none', async () => {
    const { availableBeyondLimits } = await import('./index');
    expect(availableBeyondLimits({ extra_usage: { is_enabled: false }, spend: { enabled: false, balance: null }, promo_credits: null })).toEqual([]);
    expect(availableBeyondLimits({ extra_usage: { is_enabled: true }, spend: { enabled: true, balance: { amount_minor: 1250, currency: 'USD', exponent: 2 } } })).toEqual(['Extra användning är på, 12,50 USD kvar']);
    expect(availableBeyondLimits({ spend: { enabled: false, balance: { amount_minor: 500, currency: 'USD', exponent: 2 } }, promo_credits: { amount: 1 } })).toEqual(['Krediter: 5,00 USD', 'Kampanjkrediter finns']);
  });
});
