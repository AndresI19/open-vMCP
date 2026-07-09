CREATE TABLE "tool_settings" (
	"server_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_settings_server_id_tool_name_pk" PRIMARY KEY("server_id","tool_name")
);
--> statement-breakpoint
ALTER TABLE "tool_settings" ADD CONSTRAINT "tool_settings_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;