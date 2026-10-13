/**
 * Browser side of the Solana screens: API calls (the company comes from the session cookie, never
 * from here), this member's device key (WebCrypto Ed25519 in IndexedDB, non-extractable) and
 * display formatting.
 *
 * What leaves this browser: public keys, signatures, invoice text and the confirmed fields. The 24
 * recovery words and the device private key never do.
 */
import bs58 from 'bs58';

import { createDeviceKey, createIndexedDbDeviceKeyStore, isDeviceKeySupported, loadDeviceKey, signWithDeviceKey, type DeviceKeyInfo } from '@/lib/solana/device-key';
import { formatPct, formatPhp, formatUsd } from '@/lib/solana-zeke/router';

export { formatPct, formatPhp, formatUsd };

export class ApiError extends Error {
  code: string;
  status: number;
  detail?: Record<string, unknown>;
  constructor(code: string, message: string, status: number, detail?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export async function api<T>(path: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/solana${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('network', 'The Splash server did not answer. Check that it is running, then try again.', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? { code: 'server_error', message: `Request failed (${res.status}).` };
    throw new ApiError(err.code, err.message, res.status, err.detail);
  }
  return data as T;
}

/* ---------------------------------------------------------------- receipts */

/**
 * "Share with auditor": a link that opens this one receipt without signing in (its verify steps, the
 * Solscan trace and the evidence pack). Minting again returns the same live link.
 */
export async function shareReceiptLink(receiptId: string): Promise<string> {
  const res = await api<{ path: string }>(`/receipts/${receiptId}/share`, { body: {} });
  return `${window.location.origin}${res.path}`;
}

/* ---------------------------------------------------------------- device key */

const deviceStore = () => createIndexedDbDeviceKeyStore('splash-solana-device-keys');

export async function deviceKeySupported(): Promise<boolean> {
  return isDeviceKeySupported();
}

export async function makeDeviceKey(keyId: string): Promise<DeviceKeyInfo> {
  const store = deviceStore();
  const existing = await loadDeviceKey(store, keyId);
  if (existing) return existing;
  return createDeviceKey(store, keyId);
}

export async function existingDeviceKey(keyId: string): Promise<DeviceKeyInfo | null> {
  try {
    return await loadDeviceKey(deviceStore(), keyId);
  } catch {
    return null;
  }
}

export async function signBytesWithDevice(keyId: string, bytes: Uint8Array): Promise<Uint8Array> {
  return signWithDeviceKey(deviceStore(), keyId, bytes);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Sign each prepared transaction message with the device key. Returns base58 signatures. */
export async function signPrepared(keyId: string, messages: Array<{ id: string; messageBase64: string }>) {
  const out: Array<{ id: string; signature: string }> = [];
  for (const m of messages) {
    const sig = await signBytesWithDevice(keyId, base64ToBytes(m.messageBase64));
    out.push({ id: m.id, signature: bs58.encode(sig) });
  }
  return out;
}

/* ---------------------------------------------------------------- formatting */

export function usdcPlain(minor: string | bigint): string {
  return formatUsd(BigInt(minor)).replace('US$', '');
}

export function usd(minor: string | bigint): string {
  return formatUsd(BigInt(minor));
}

/** Where a payment opens again: an invoice under Invoices, a transfer under Transfer. */
export function payHref(p: { id: string; kind: 'invoice' | 'transfer' }): string {
  return `/dashboard/${p.kind === 'transfer' ? 'transfer' : 'invoices'}?payment=${p.id}`;
}

/** "5,416.082957 USDC": every unit, for where cent-rounded figures would not add up. */
export function usdcExact(minor: string | bigint): string {
  const v = BigInt(minor);
  const abs = v < 0n ? -v : v;
  const whole = (abs / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${v < 0n ? '−' : ''}${whole}.${(abs % 1_000_000n).toString().padStart(6, '0')} USDC`;
}

export function php(minor: string | bigint): string {
  return formatPhp(BigInt(minor));
}

export function pct(bps: number): string {
  return `${(Math.round(bps) / 100).toFixed(2)}%`;
}

/** 0.29% style with two decimals of a percent, from bps with two decimals. */
export function pctFine(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function shortKey(key: string | null | undefined, n = 4): string {
  if (!key) return '';
  return key.length <= n * 2 + 1 ? key : `${key.slice(0, n)}…${key.slice(-n)}`;
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function timeShort(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
