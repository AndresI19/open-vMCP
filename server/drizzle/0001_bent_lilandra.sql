ALTER TABLE "mcp_servers" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "command" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "args" jsonb;