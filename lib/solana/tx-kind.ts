import type { Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * Which kind of transaction this is, decided by shape, never by `instanceof`.
 *
 * The chain client is a process-wide singleton (lib/solana-app/runtime.ts keeps it on globalThis) and
 * Next.js can bundle each route with its own copy of @solana/web3.js. A VersionedTransaction built in
 * one route then fails `instanceof VersionedTransaction` against another route's copy of the class,
 * and a v0 transaction was read as legacy: "legacy.compileMessage is not a function". Only a legacy
 * Transaction has compileMessage.
 */
export function isVersionedTransaction(tx: VersionedTransaction | Transaction): tx is VersionedTransaction {
  return typeof (tx as Transaction).compileMessage !== 'function';
}
