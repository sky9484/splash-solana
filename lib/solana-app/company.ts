/**
 * A company's documents between the database and the in-process working copy (store.ts).
 *
 *   loadCompany(orgId)    on the company's first request in this process, read its documents
 *                         (company record, invoices, evidence, share links) into the working copy
 *   saveCompany(orgId)    after a request, write back every document of that company that changed
 *   withCompany(orgId,f)  both around f: what every company-scoped route handler runs
 *
 * Only documents that changed are written: each one's last written JSON is kept and compared.
 * Without a database (the offline demo, tests) the document store keeps nothing and these are no-ops
 * in effect: the working copy is all there is.
 */
import { encodeRecord } from './payment-repo.ts';
import { runtime } from './runtime.ts';
import { store } from './store.ts';
import type { Doc, DocKind } from './doc-store.ts';

const keyOf = (kind: DocKind, id: string) => `${kind}:${id}`;

export async function loadCompany(orgId: string): Promise<void> {
  const s = store();
  if (s.docs.loaded.has(orgId)) return;
  const docs = await runtime().docs.loadOrg(orgId);
  const remember = (kind: DocKind, id: string, body: unknown) => s.docs.written.set(keyOf(kind, id), JSON.stringify(encodeRecord(body)));
  // What this process already holds is newer than what it last wrote, so it is never overwritten.
  if (docs.org && !s.orgs.has(orgId)) {
    s.orgs.set(orgId, docs.org);
    remember('org', orgId, docs.org);
  }
  for (const inv of docs.invoices) {
    if (inv.orgId !== orgId || s.invoices.has(inv.id)) continue;
    s.invoices.set(inv.id, inv);
    remember('invoice', inv.id, inv);
  }
  for (const e of docs.evidence) {
    if (e.orgId !== orgId || s.evidence.has(e.receiptId)) continue;
    s.evidence.set(e.receiptId, e);
    remember('evidence', e.receiptId, e);
  }
  for (const sh of docs.shares) {
    if (sh.orgId !== orgId || s.shares.has(sh.token)) continue;
    s.shares.set(sh.token, sh);
    remember('share', sh.token, sh);
  }
  s.docs.loaded.add(orgId);
}

export async function saveCompany(orgId: string): Promise<void> {
  const s = store();
  const all: Doc[] = [];
  const org = s.orgs.get(orgId);
  if (org) all.push({ kind: 'org', id: orgId, orgId, body: org });
  for (const inv of s.invoices.values()) if (inv.orgId === orgId) all.push({ kind: 'invoice', id: inv.id, orgId, body: inv });
  for (const e of s.evidence.values()) if (e.orgId === orgId) all.push({ kind: 'evidence', id: e.receiptId, orgId, body: e });
  for (const sh of s.shares.values()) if (sh.orgId === orgId) all.push({ kind: 'share', id: sh.token, orgId, body: sh });
  const changed: Array<Doc & { json: string }> = [];
  for (const d of all) {
    const json = JSON.stringify(encodeRecord(d.body));
    if (s.docs.written.get(keyOf(d.kind, d.id)) !== json) changed.push({ ...d, json });
  }
  if (changed.length === 0) return;
  await runtime().docs.save(changed.map((d) => ({ kind: d.kind, id: d.id, orgId: d.orgId, body: d.body })));
  for (const d of changed) s.docs.written.set(keyOf(d.kind, d.id), d.json);
}

/** Load the company, run f, then write back what changed, whether f succeeded or threw. */
export async function withCompany<T>(orgId: string, f: () => Promise<T>): Promise<T> {
  await loadCompany(orgId);
  try {
    return await f();
  } finally {
    await saveCompany(orgId);
  }
}

/** The company a document belongs to, from the working copy or the database (a share link, a receipt). */
export async function companyOf(kind: 'evidence' | 'share', id: string): Promise<string | null> {
  const s = store();
  const hot = kind === 'evidence' ? s.evidence.get(id)?.orgId : s.shares.get(id)?.orgId;
  return hot ?? (await runtime().docs.ownerOf(kind, id));
}
