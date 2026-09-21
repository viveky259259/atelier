import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ATELIER_NAME, ATELIER_VERSION } from "./version.js";
import type { PaperClient } from "./paper/client.js";
import { preflight } from "./tools/preflight.js";

export interface AtelierDeps { paper: PaperClient; }

export function createAtelierServer(deps: AtelierDeps): McpServer {
  const server = new McpServer({ name: ATELIER_NAME, version: ATELIER_VERSION });

  server.registerTool(
    "preflight",
    {
      title: "Preflight",
      description:
        "Check that Paper is running with a file open and exposes the tools Atelier needs. " +
        "Returns structured checks plus actionable remediation. Call before any design work.",
      inputSchema: {},
    },
    async () => {
      const report = await preflight(deps.paper);
      return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
    },
  );

  return server;
}
