import { SealClient } from '@mysten/seal';

import { getSealConfig } from '@/lib/server/seal-config';
import { suiClient } from '@/lib/sui';

export type SealHealthStatus = 'unconfigured' | 'healthy' | 'read-only';

export type SealHealth = {
  status: SealHealthStatus;
  checkedAt: string;
  mode: string;
  threshold: number;
  configuredWeight: number;
  reachableWeight: number;
  servers: Array<{ objectId: string; reachable: boolean; endpoint: string | null; error?: string }>;
  reason?: string;
};

const globalHealth = globalThis as typeof globalThis & {
  splashSealHealth?: SealHealth;
  splashSealHealthPromise?: Promise<SealHealth>;
};

function unconfigured(reason: string): SealHealth {
  return {
    status: 'unconfigured',
    checkedAt: new Date().toISOString(),
    mode: 'decentralized',
    threshold: 0,
    configuredWeight: 0,
    reachableWeight: 0,
    servers: [],
    reason,
  };
}

async function sendAlert(health: SealHealth) {
  const webhook = process.env.SEAL_ALERT_WEBHOOK_URL?.trim();
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'splash-seal', severity: 'critical', health }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.error('[Seal] Health alert delivery failed:', error);
  }
}

async function runHealthCheck(): Promise<SealHealth> {
  let config;
  try {
    config = getSealConfig();
  } catch (error) {
    const health = {
      ...unconfigured('Invalid Seal configuration.'),
      status: 'read-only' as const,
      reason: error instanceof Error ? error.message : String(error),
    };
    console.error('[Seal] READ_ONLY:', health.reason);
    await sendAlert(health);
    return health;
  }

  if (config.serverConfigs.length === 0) return unconfigured('No Seal key servers configured.');

  const configuredWeight = config.serverConfigs.reduce((sum, server) => sum + server.weight, 0);
  const client = new SealClient({
    suiClient,
    serverConfigs: config.serverConfigs,
    verifyKeyServers: config.mode !== 'decentralized',
    timeout: config.timeoutMs,
  });

  let onChainServers: Awaited<ReturnType<SealClient['getKeyServers']>> | null = null;
  let loadError: string | undefined;
  try {
    onChainServers = await client.getKeyServers();
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  const servers = await Promise.all(config.serverConfigs.map(async (server) => {
    const endpoint = server.aggregatorUrl ?? onChainServers?.get(server.objectId)?.url ?? null;
    if (!endpoint) return { objectId: server.objectId, reachable: false, endpoint, error: loadError ?? 'Endpoint unavailable.' };
    try {
      const response = await fetch(`${endpoint}/v1/service?service_id=${server.objectId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Request-Id': crypto.randomUUID(),
          'Client-Sdk-Type': 'typescript',
          'Client-Sdk-Version': '1.1.3',
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      const reachable = response.status < 500 && Boolean(response.headers.get('x-keyserver-version'));
      return { objectId: server.objectId, reachable, endpoint, error: reachable ? undefined : `HTTP ${response.status}` };
    } catch (error) {
      return { objectId: server.objectId, reachable: false, endpoint, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  const reachableWeight = config.serverConfigs.reduce((sum, server, index) => sum + (servers[index].reachable ? server.weight : 0), 0);
  const satisfiable = !loadError && reachableWeight >= config.threshold && config.configured;
  const health: SealHealth = {
    status: satisfiable ? 'healthy' : 'read-only',
    checkedAt: new Date().toISOString(),
    mode: config.mode,
    threshold: config.threshold,
    configuredWeight,
    reachableWeight,
    servers,
    reason: satisfiable
      ? undefined
      : loadError ?? (!config.configured ? 'Seal package or policy object is not configured.' : 'Seal threshold is not reachable.'),
  };

  if (health.status === 'read-only') {
    console.error(`[Seal] READ_ONLY: ${health.reason} reachable=${reachableWeight}/${configuredWeight} threshold=${config.threshold}`);
    await sendAlert(health);
  } else {
    console.info(`[Seal] Decentralized key servers healthy: reachable=${reachableWeight}/${configuredWeight} threshold=${config.threshold}`);
  }
  return health;
}

export async function checkSealHealth(options: { force?: boolean } = {}) {
  const current = globalHealth.splashSealHealth;
  if (!options.force && current && Date.now() - Date.parse(current.checkedAt) < 60_000) return current;
  if (!options.force && globalHealth.splashSealHealthPromise) return globalHealth.splashSealHealthPromise;

  const promise = runHealthCheck().then((health) => {
    globalHealth.splashSealHealth = health;
    globalHealth.splashSealHealthPromise = undefined;
    return health;
  });
  globalHealth.splashSealHealthPromise = promise;
  return promise;
}

export function getSealHealthSnapshot(): SealHealth {
  return globalHealth.splashSealHealth ?? unconfigured('Startup health check has not completed.');
}

export async function assertSealWritable() {
  const health = await checkSealHealth();
  if (health.status !== 'healthy') {
    throw new Error(`Seal is read-only: ${health.reason ?? 'configured threshold is unavailable'}`);
  }
  return health;
}
