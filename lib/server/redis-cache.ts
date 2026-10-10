import net from 'net';

type CacheEntry = { value: string; expiresAt: number };

const memory = new Map<string, CacheEntry>();
const redisUrl = process.env.REDIS_URL;
const timeoutMs = Number.parseInt(process.env.REDIS_TIMEOUT_MS ?? '500', 10);

function encodeRedisCommand(parts: string[]) {
  return parts.reduce((command, part) => `${command}$${Buffer.byteLength(part)}\r\n${part}\r\n`, `*${parts.length}\r\n`);
}

function parseBulkString(response: string): string | null {
  if (response.startsWith('$-1')) return null;
  if (!response.startsWith('$')) return null;

  const firstBreak = response.indexOf('\r\n');
  const length = Number.parseInt(response.slice(1, firstBreak), 10);

  if (!Number.isFinite(length) || length < 0) return null;

  return response.slice(firstBreak + 2, firstBreak + 2 + length);
}

async function sendRedis(parts: string[]): Promise<string> {
  if (!redisUrl) throw new Error('REDIS_URL is not configured');

  const parsed = new URL(redisUrl);
  const host = parsed.hostname || '127.0.0.1';
  const port = Number.parseInt(parsed.port || '6379', 10);
  const command = encodeRedisCommand(parts);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Redis request timed out'));
    }, timeoutMs);

    socket.on('connect', () => socket.write(command));
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      clearTimeout(timer);
      socket.end();
      resolve(data);
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const local = memory.get(key);

  if (local && local.expiresAt > Date.now()) return JSON.parse(local.value) as T;
  if (local) memory.delete(key);

  try {
    const response = await sendRedis(['GET', key]);
    const raw = parseBulkString(response);

    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setCachedJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const serialized = JSON.stringify(value);
  memory.set(key, { value: serialized, expiresAt: Date.now() + ttlSeconds * 1000 });

  try {
    await sendRedis(['SETEX', key, ttlSeconds.toString(), serialized]);
  } catch {
  }
}
