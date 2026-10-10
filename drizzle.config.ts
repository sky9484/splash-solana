import { defineConfig } from 'drizzle-kit';

/** W1 — migrations are generated offline (`npx drizzle-kit generate`) and
 *  checked in under drizzle/; `drizzle-kit migrate` applies them against
 *  the DigitalOcean cluster via DATABASE_URL. */
export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/splash_dev',
  },
});
