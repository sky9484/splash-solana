export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // First, before anything reads a key: every variable the app depends on is
  // validated in one pass and a bad environment refuses to start, naming each
  // problem. This is what stops two machines with different .env.local files
  // both booting cleanly and then diverging on the first request one of them
  // happens to serve. Seal's own twelve request-time throws are folded in.
  const { validateEnvAtBoot } = await import('@/lib/env');
  await validateEnvAtBoot();

  const { checkSealHealth } = await import('@/lib/server/seal-health');
  await checkSealHealth({ force: true });
}
