export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Before anything can log: no bank number in a log line (prompt 10 §S.1.6). Every console method
  // writes scrubbed arguments from here on.
  const { installLogScrubber } = await import('@/lib/server/log-scrub');
  installLogScrubber();

  // First, before anything reads a key: every variable the app depends on is
  // validated in one pass and a bad environment refuses to start, naming each
  // problem. This is what stops two machines with different .env.local files
  // both booting cleanly and then diverging on the first request one of them
  // happens to serve. Seal's own twelve request-time throws are folded in.
  const { validateEnvAtBoot } = await import('@/lib/env');
  await validateEnvAtBoot();

  // The bank-number key service, made now rather than on the first payment: production on the local
  // key without the override stops here; offline with no keys gets throwaway keys, said once.
  const { kmsFromEnv } = await import('@/lib/server/kms');
  try {
    kmsFromEnv();
  } catch (e) {
    if (process.env.NODE_ENV === 'production') throw e;
    console.warn(`[pii] Bank numbers can't be stored until this is fixed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { checkSealHealth } = await import('@/lib/evidence-sui/seal-health');
  await checkSealHealth({ force: true });
}
