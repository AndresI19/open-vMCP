import "../src/env.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.VMCP_URL ?? "http://localhost:8001/mcp/rs-mcp";
const MINT = "http://localhost:8001/auth/mock-token";

async function tokenFor(user: string): Promise<string> {
  const r = await fetch(`${MINT}?user=${encodeURIComponent(user)}`);
  return (await r.json()).token as string;
}

async function session(user: string) {
  const token = await tokenFor(user);
  const client = new Client({ name: `populate-${user}`, version: "0.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(BASE), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  try {
    await client.callTool({ name, arguments: args });
    console.log(`  ok    ${name}(${JSON.stringify(args)})`);
  } catch (e) {
    console.log(`  ERROR ${name} → ${(e as Error).message}`);
  }
}

const andres = await session("andres");
await call(andres.client, "get_item_price", { item_name: "Abyssal whip", game: "osrs" });
await call(andres.client, "search_wiki", { query: "Dragon Slayer", game: "osrs" });
await call(andres.client, "get_monster_info", { monster_name: "Abyssal demon", game: "osrs" });
await call(andres.client, "no_such_tool", {}); // deliberate error → status=error
await andres.close();

const zezima = await session("zezima");
await call(zezima.client, "get_item_price", { item_name: "Dragon claws", game: "osrs" });
await call(zezima.client, "get_quest_info", { quest_name: "Cook's Assistant", game: "osrs" });
await call(zezima.client, "get_item_price", { item_name: "Twisted bow", game: "osrs" });
await zezima.close();

console.log("populate done");
process.exit(0);
