ALTER TABLE "proposals" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "settlement" jsonb;--> statement-breakpoint
DROP TYPE "public"."proposal_status";