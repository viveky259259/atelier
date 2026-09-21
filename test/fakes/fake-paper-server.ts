import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");

const toolsFixture = JSON.parse(
  readFileSync(join(fixtures, "paper-tools-list.json"), "utf8"),
) as { result: { tools: Array<{ name: string; inputSchema?: { properties?: object } }> } };

const guideText = readFileSync(join(fixtures, "paper-guide.md"), "utf8");

// Shape captured from paper-desktop 0.5.11, values synthetic: block 0 is the file
// header every file-scoped tool returns, block 1 is the tool's own payload.
const basicInfoFixture = JSON.parse(
  readFileSync(join(fixtures, "paper-get-basic-info.json"), "utf8"),
) as { result: { content: [{ text: string }, { text: string }] } };
const [headerBlock, basicInfoBlock] = basicInfoFixture.result.content;

export const PAPER_TOOL_NAMES: string[] = toolsFixture.result.tools.map((t) => t.name);

// A tool is file-scoped when its captured schema accepts a fileId.
const FILE_SCOPED = new Set(
  toolsFixture.result.tools
    .filter((t) => t.inputSchema?.properties !== undefined && "fileId" in t.inputSchema.properties)
    .map((t) => t.name),
);

export interface FakeCall { name: string; args: Record<string, unknown>; }

export interface FakePaperOptions {
  toolNames?: string[];
  basicInfo?: unknown;
  failGuide?: boolean;
}

export interface FakePaper {
  url: string;
  calls: FakeCall[];
  close(): Promise<void>;
}

const text = (t: string) => ({ type: "text" as const, text: t });

export async function startFakePaper(opts: FakePaperOptions = {}): Promise<FakePaper> {
  const calls: FakeCall[] = [];
  const names = opts.toolNames ?? PAPER_TOOL_NAMES;
  const basicInfoText =
    opts.basicInfo === undefined ? basicInfoBlock.text : JSON.stringify(opts.basicInfo, null, 2);

  const known = new Set(names);

  // Low-level Server, not McpServer: registerTool with an empty zod shape would
  // strip tool arguments, so recorded calls would lose their args.
  const buildServer = (): Server => {
    const mcp = new Server(
      { name: "paper-desktop", version: "0.5.8" },
      { capabilities: { tools: {} } },
    );

    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: names.map((name) => ({
        name,
        description: `fake ${name}`,
        inputSchema: { type: "object" as const, additionalProperties: true },
      })),
    }));

    mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name;
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      if (!known.has(name)) throw new Error(`unknown tool ${name}`);
      calls.push({ name, args });
      if (name === "get_guide") {
        // Real Paper reports tool failures as an isError result, not a protocol error.
        if (opts.failGuide) return { isError: true, content: [text("guide unavailable")] };
        return { content: [text(guideText)] };
      }
      const body = name === "get_basic_info" ? basicInfoText : "{}";
      return {
        content: FILE_SCOPED.has(name) ? [text(headerBlock.text), text(body)] : [text(body)],
      };
    });

    return mcp;
  };

  // Stateless mode needs a fresh Server + transport per request: the SDK refuses to
  // reuse a stateless transport, and a Server cannot connect to a second transport.
  // Mirrors the SDK's own examples/server/simpleStatelessStreamableHttp.
  const open = new Set<{ mcp: Server; transport: StreamableHTTPServerTransport }>();

  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      }));
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const pair = {
        mcp: buildServer(),
        transport: new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }),
      };
      open.add(pair);
      res.on("close", () => {
        open.delete(pair);
        void pair.transport.close();
        void pair.mcp.close();
      });
      void (async () => {
        try {
          await pair.mcp.connect(pair.transport);
          await pair.transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500).end(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: String(err) },
              id: null,
            }));
          }
        }
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");

  return {
    url: `http://127.0.0.1:${addr.port}/mcp`,
    calls,
    async close() {
      for (const pair of open) {
        await pair.transport.close();
        await pair.mcp.close();
      }
      open.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
