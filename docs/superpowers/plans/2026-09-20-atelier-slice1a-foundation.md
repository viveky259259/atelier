# Atelier Slice 1A — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable `atelier` MCP server that connects to `paper-desktop`, persists design sessions, probes Paper's capabilities, and answers a working `preflight` tool.

**Architecture:** Atelier is simultaneously an MCP **server** over stdio (to Claude Code, Cursor, etc.) and an MCP **client** over streamable HTTP (to `paper-desktop` at `http://127.0.0.1:29979/mcp`, for reads only). Session process-state persists in SQLite keyed by Paper `fileId`. All tests run against a fake `paper-desktop` built with the real MCP SDK server transport and replaying captured fixtures, so the real transport path is exercised without Paper running.

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk`, `zod`, `node:sqlite` (built in — no native compile), Vitest, Node 26.

**Spec:** `docs/superpowers/specs/2026-09-19-atelier-design.md`

## Revision notes (2026-09-21, after execution)

Running this plan against real Paper exposed three wrong assumptions in the first draft. The tasks
below now match the committed code.

1. **Stateless SDK transports are single-use.** `@modelcontextprotocol/sdk` 1.30 (what `^1.20.0`
   installs) throws when a stateless `StreamableHTTPServerTransport` handles a second request, and a
   `Server` cannot connect to a second transport. The fake (Task 2) builds a fresh `Server` +
   transport per POST, as the SDK's own `examples/server/simpleStatelessStreamableHttp` does, and
   answers GET/DELETE with 405.
2. **File-scoped tools answer with two JSON blocks.** Every Paper tool that accepts `fileId` (30 of
   34) returns a file header `{ file: { id, name }, contentHash: { tokens } }` and then its payload.
   `paper-guide.md` documents this ("Use file headers to verify"), and it was confirmed live on
   `get_basic_info`, `get_tokens`, `get_selection` and `list_comment_threads`. The first draft's fake
   invented a single-block `{ fileId }` response, so every offline test passed while preflight
   failed against real Paper. Tasks 2, 4 and 7 now model and consume the header: a new fixture
   `paper-get-basic-info.json`, `PaperClient.callFileScoped<T>()`, and preflight reads `header.file`.
3. **Paper reports tool failures in-band**, as `isError: true` results (for example, invalid
   arguments), not as protocol errors. `PaperClient` throws `PaperToolError` for them rather than
   returning the error text as data, and the fake's `failGuide` behaves the same way.

Also: live Paper is now `paper-desktop 0.5.11`. The fixtures were captured at 0.5.8, and the tool
surface is unchanged at 34 tools. Task 3's expected count was a typo (4 tests, not 3).

**Update 2026-09-23.** The fixtures were re-captured at `paper-desktop 0.5.12`. It has the same
34 tools, and `get_tokens`/`create_tokens` gain an `opacity` token type. The fake now reads its
server identity from `paper-initialize.json`. Tooling moved to Vitest 5 (clearing a dev-only
advisory), `engines.node` is `>=22.13.0`, and `fsevents`' install script is denied (it ships
prebuilt). The spec gained §4.7 (response envelope); the constraints below follow it.

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include these.

- **Ownership (§5.1):** Paper owns all design data; Atelier owns only process data (stage, decisions, rubric scores, semantic-name↔nodeId map). On conflict, **Paper wins** and Atelier re-derives by reading.
- **No proxying (§5):** Atelier never proxies Paper's write tools. It plans and validates; the caller executes writes against Paper directly.
- **Node identity (§4.2):** `write_html` is used once per node at genesis; every refinement mutates in place. Never regenerate a node that has comment threads attached.
- **HTML subset (§4.3):** inline styles only; forbidden — `margin`, `display: inline`, `display: grid`, HTML tables; layout is flex + padding + gap exclusively; `border-box` everywhere.
- **Token order (§4.4):** colours semantic before palette, neutral → primary → secondary → accent; all other types smallest value first; aliasing via `var(--other-token)`. Token types as of 0.5.12 include `opacity` (0–1 number or percent string).
- **Session protocol (§4.5):** `get_guide({topic:"paper-mcp-instructions"})` once per session before other Paper tools; `get_font_family_info` before first typographic styling; `finish_working_on_nodes` when a write sequence completes; **never show raw node IDs to the user**; exact values come from `get_jsx`/`get_computed_styles`/`get_tokens`, **never** from screenshots; pass `fileId` explicitly (28 tools require it); check each file header's `file.id`, and re-read tokens when `contentHash.tokens` changes.
- **Response envelope (§4.7):** file-scoped tools return a file-header block, then a payload block, parsed separately; `isError` results are failures, never data.
- **No motion primitives (§4.6):** Paper has no transition/animation/easing/hover/variant concept. Never emit CSS `transition`/`animation` into `write_html`.
- **Paper endpoint:** `http://127.0.0.1:29979/mcp`; server identifies as `paper-desktop`, probed at `0.5.8`, re-verified at `0.5.12` (fixtures captured at `0.5.12`).

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/version.ts`
- Test: `test/version.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ATELIER_NAME: string`, `ATELIER_VERSION: string` from `src/version.ts`

- [x] **Step 1: Create `package.json`**

```json
{
  "name": "atelier",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "atelier": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.20.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.7.0",
    "vitest": "^5.0.1"
  },
  "allowScripts": {
    "fsevents": false
  },
  "engines": {
    "node": ">=22.13.0"
  }
}
```

- [x] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

- [x] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
  },
});
```

- [x] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
*.sqlite
*.sqlite-journal
.DS_Store
```

- [x] **Step 5: Install dependencies**

Run: `npm install`
Expected: completes without native build steps (`node:sqlite` is built in).

Then verify every MCP SDK export this plan relies on actually exists in the installed version:

```bash
node --input-type=module -e "
const need = {
  '@modelcontextprotocol/sdk/server/mcp.js': ['McpServer'],
  '@modelcontextprotocol/sdk/server/index.js': ['Server'],
  '@modelcontextprotocol/sdk/server/stdio.js': ['StdioServerTransport'],
  '@modelcontextprotocol/sdk/server/streamableHttp.js': ['StreamableHTTPServerTransport'],
  '@modelcontextprotocol/sdk/client/index.js': ['Client'],
  '@modelcontextprotocol/sdk/client/streamableHttp.js': ['StreamableHTTPClientTransport'],
  '@modelcontextprotocol/sdk/inMemory.js': ['InMemoryTransport'],
  '@modelcontextprotocol/sdk/types.js': ['ListToolsRequestSchema', 'CallToolRequestSchema'],
};
for (const [path, names] of Object.entries(need)) {
  const m = await import(path);
  for (const n of names) if (!(n in m)) throw new Error(path + ' is missing ' + n);
}
console.log('SDK exports OK');
"
```

Expected: `SDK exports OK`. **If any export is missing, STOP.** The SDK API has moved since this
plan was written; report which export is missing rather than guessing at a replacement.

- [x] **Step 6: Write the failing test**

Create `test/version.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ATELIER_NAME, ATELIER_VERSION } from "../src/version.js";

describe("version", () => {
  it("identifies the server", () => {
    expect(ATELIER_NAME).toBe("atelier");
    expect(ATELIER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [x] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/version.test.ts`
Expected: FAIL — cannot resolve `../src/version.js`

- [x] **Step 8: Write minimal implementation**

Create `src/version.ts`:

```ts
export const ATELIER_NAME = "atelier";
export const ATELIER_VERSION = "0.1.0";
```

- [x] **Step 9: Run test to verify it passes**

Run: `npx vitest run test/version.test.ts`
Expected: PASS (1 test)

- [x] **Step 10: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/version.ts test/version.test.ts package-lock.json
git commit -m "chore: scaffold TypeScript MCP project with vitest"
```

---

### Task 2: Fake paper-desktop server

The fake is built from the **real** MCP SDK server transport so tests exercise the real
protocol path. It registers every tool name found in the captured `tools/list` fixture, and
returns fixture payloads for the handful of tools Slice 1A actually calls. Like real Paper, every
tool whose captured schema accepts `fileId` answers with a file-header block before its payload,
and failures come back as `isError` results, not protocol errors. SDK 1.30 stateless transports
are single-use, so the fake builds a fresh `Server` + transport per request.

Fixtures are already committed at `test/fixtures/`:
`paper-initialize.json`, `paper-tools-list.json` (all 34 schemas), `paper-guide.md`.
This task adds a fourth, `paper-get-basic-info.json`: the two-block `get_basic_info` response,
shape captured from paper-desktop 0.5.11, every value synthetic.

**Files:**
- Create: `test/fakes/fake-paper-server.ts`
- Create: `test/fixtures/paper-get-basic-info.json`
- Test: `test/fakes/fake-paper-server.test.ts`

**Interfaces:**
- Consumes: `test/fixtures/*`
- Produces: `startFakePaper(opts?: FakePaperOptions): Promise<FakePaper>` where
  `FakePaper = { url: string; close(): Promise<void>; calls: FakeCall[] }` and
  `FakeCall = { name: string; args: Record<string, unknown> }`.
  `FakePaperOptions = { toolNames?: string[]; basicInfo?: unknown; failGuide?: boolean }`.
  `basicInfo` replaces only the payload block of `get_basic_info` (the header comes from the
  fixture). `failGuide` makes `get_guide` return an `isError` result, as real Paper does.

- [x] **Step 1: Write the failing test**

Create `test/fakes/fake-paper-server.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startFakePaper, type FakePaper } from "./fake-paper-server.js";

let fake: FakePaper | undefined;
afterEach(async () => { await fake?.close(); fake = undefined; });

describe("fake paper-desktop", () => {
  it("serves the captured tool list over real MCP transport", async () => {
    fake = await startFakePaper();
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(fake.url)));

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("write_html");
    expect(names).toContain("create_tokens");
    expect(names).toContain("list_comment_threads");
    expect(names.length).toBe(34);

    await client.close();
  });

  it("records calls and returns the guide", async () => {
    fake = await startFakePaper();
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(fake.url)));

    await client.callTool({ name: "get_guide", arguments: { topic: "paper-mcp-instructions" } });

    expect(fake.calls).toEqual([
      { name: "get_guide", args: { topic: "paper-mcp-instructions" } },
    ]);
    await client.close();
  });

  it("prefixes file-scoped results with the file header, like real Paper", async () => {
    fake = await startFakePaper();
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(fake.url)));

    const info = await client.callTool({ name: "get_basic_info", arguments: {} });
    const blocks = info.content as Array<{ type: string; text: string }>;
    expect(blocks).toHaveLength(2);
    expect(JSON.parse(blocks[0]!.text)).toEqual({
      file: { id: "01FIXTUREFILE0000000000001", name: "Fixture File" },
      contentHash: { tokens: "0a1b2c3d" },
    });
    expect(JSON.parse(blocks[1]!.text).fileName).toBe("Fixture File");

    const guide = await client.callTool({
      name: "get_guide",
      arguments: { topic: "paper-mcp-instructions" },
    });
    expect(guide.content).toHaveLength(1);
    await client.close();
  });

  it("reports tool failures as isError results, like real Paper", async () => {
    fake = await startFakePaper({ failGuide: true });
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(fake.url)));

    const res = await client.callTool({
      name: "get_guide",
      arguments: { topic: "paper-mcp-instructions" },
    });
    expect(res.isError).toBe(true);
    await client.close();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/fakes/fake-paper-server.test.ts`
Expected: FAIL — cannot resolve `./fake-paper-server.js`

- [x] **Step 3: Write minimal implementation**

Create `test/fixtures/paper-get-basic-info.json`. The shape was captured from paper-desktop
0.5.11; the values are synthetic, never a real file's data:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \"file\": {\n    \"id\": \"01FIXTUREFILE0000000000001\",\n    \"name\": \"Fixture File\"\n  },\n  \"contentHash\": {\n    \"tokens\": \"0a1b2c3d\"\n  }\n}"
      },
      {
        "type": "text",
        "text": "{\n  \"fileName\": \"Fixture File\",\n  \"pageName\": \"Page 1\",\n  \"pageId\": \"p-1-0\",\n  \"url\": \"https://app.paper.design/file/01FIXTUREFILE0000000000001/p-1-0\",\n  \"rootNodeId\": \"page_root_p-1-0\",\n  \"nodeCount\": 12,\n  \"artboardCount\": 2,\n  \"artboards\": [\n    {\n      \"id\": \"1A-0\",\n      \"name\": \"Home\",\n      \"childCount\": 3,\n      \"width\": 1440,\n      \"height\": 1024,\n      \"worldX\": 0,\n      \"worldY\": 0\n    },\n    {\n      \"id\": \"2B-0\",\n      \"name\": \"Settings\",\n      \"childCount\": 2,\n      \"width\": 1440,\n      \"height\": 1024,\n      \"worldX\": 1540,\n      \"worldY\": 0\n    }\n  ],\n  \"pages\": [\n    {\n      \"id\": \"1-1\",\n      \"name\": \"Page 1\",\n      \"isActive\": true\n    },\n    {\n      \"id\": \"1-2\",\n      \"name\": \"Page 2\",\n      \"isActive\": false\n    }\n  ],\n  \"fontFamilies\": [\n    \"Inter\"\n  ],\n  \"tokens\": {\n    \"items\": [\n      {\n        \"name\": \"--color-neutral-50\",\n        \"value\": \"#fafafa\"\n      },\n      {\n        \"name\": \"--color-primary-500\",\n        \"value\": \"#3b5bdb\"\n      },\n      {\n        \"name\": \"--space-4\",\n        \"value\": \"16px\"\n      }\n    ]\n  }\n}"
      }
    ]
  }
}
```

Then create `test/fakes/fake-paper-server.ts`:

```ts
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

const serverInfo = (
  JSON.parse(readFileSync(join(fixtures, "paper-initialize.json"), "utf8")) as {
    result: { serverInfo: { name: string; version: string } };
  }
).result.serverInfo;

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
      { name: serverInfo.name, version: serverInfo.version },
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
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/fakes/fake-paper-server.test.ts`
Expected: PASS (4 tests). If the tool count assertion fails, print
`PAPER_TOOL_NAMES.length` — the fixture is authoritative; fix the test, not the fixture.

- [x] **Step 5: Commit**

```bash
git add test/fakes test/fixtures
git commit -m "test: add fake paper-desktop server replaying captured fixtures"
```

---

### Task 3: PaperClient — connect and identify

**Files:**
- Create: `src/paper/client.ts`
- Test: `test/paper/client.test.ts`

**Interfaces:**
- Consumes: `startFakePaper` from Task 2
- Produces:
  - `PAPER_DEFAULT_URL = "http://127.0.0.1:29979/mcp"`
  - `class PaperClient { constructor(opts?: { url?: string }); connect(): Promise<PaperServerInfo>; get connected(): boolean; close(): Promise<void>; }`
  - `interface PaperServerInfo { name: string; version: string }`
  - `class PaperUnavailableError extends Error { readonly url: string }`

- [x] **Step 1: Write the failing test**

Create `test/paper/client.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { startFakePaper, type FakePaper } from "../fakes/fake-paper-server.js";
import { PaperClient, PaperUnavailableError, PAPER_DEFAULT_URL } from "../../src/paper/client.js";

let fake: FakePaper | undefined;
let client: PaperClient | undefined;
afterEach(async () => { await client?.close(); await fake?.close(); fake = undefined; client = undefined; });

describe("PaperClient", () => {
  it("defaults to the Paper desktop endpoint", () => {
    expect(PAPER_DEFAULT_URL).toBe("http://127.0.0.1:29979/mcp");
  });

  it("connects and reports server identity", async () => {
    fake = await startFakePaper();
    client = new PaperClient({ url: fake.url });

    expect(client.connected).toBe(false);
    const info = await client.connect();

    expect(info.name).toBe("paper-desktop");
    expect(info.version).toBe("0.5.12");
    expect(client.connected).toBe(true);
  });

  it("is idempotent — reconnecting reuses the live client", async () => {
    fake = await startFakePaper();
    client = new PaperClient({ url: fake.url });

    const first = await client.connect();
    const second = await client.connect();

    expect(second).toEqual(first);
    expect(client.connected).toBe(true);
  });

  it("throws PaperUnavailableError when nothing is listening", async () => {
    client = new PaperClient({ url: "http://127.0.0.1:1/mcp" });
    await expect(client.connect()).rejects.toBeInstanceOf(PaperUnavailableError);
    expect(client.connected).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/paper/client.test.ts`
Expected: FAIL — cannot resolve `../../src/paper/client.js`

- [x] **Step 3: Write minimal implementation**

Create `src/paper/client.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ATELIER_NAME, ATELIER_VERSION } from "../version.js";

export const PAPER_DEFAULT_URL = "http://127.0.0.1:29979/mcp";

export interface PaperServerInfo { name: string; version: string; }

export class PaperUnavailableError extends Error {
  constructor(readonly url: string, cause?: unknown) {
    super(
      `Paper is not reachable at ${url}. Open the Paper desktop app and open a file, then retry.`,
    );
    this.name = "PaperUnavailableError";
    this.cause = cause;
  }
}

export interface PaperClientOptions { url?: string; }

export class PaperClient {
  readonly url: string;
  #client: Client | undefined;

  constructor(opts: PaperClientOptions = {}) {
    this.url = opts.url ?? PAPER_DEFAULT_URL;
  }

  get connected(): boolean { return this.#client !== undefined; }

  async connect(): Promise<PaperServerInfo> {
    // Idempotent: preflight may be called repeatedly on a long-lived client.
    if (this.#client !== undefined) {
      const cached = this.#client.getServerVersion();
      return { name: cached?.name ?? "unknown", version: cached?.version ?? "unknown" };
    }
    const client = new Client({ name: ATELIER_NAME, version: ATELIER_VERSION });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(this.url)));
    } catch (err) {
      throw new PaperUnavailableError(this.url, err);
    }
    this.#client = client;
    const info = client.getServerVersion();
    return { name: info?.name ?? "unknown", version: info?.version ?? "unknown" };
  }

  async close(): Promise<void> {
    await this.#client?.close();
    this.#client = undefined;
  }

  /** @internal — Task 4 builds on this. */
  protected get raw(): Client {
    if (this.#client === undefined) throw new PaperUnavailableError(this.url);
    return this.#client;
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/paper/client.test.ts`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add src/paper/client.ts test/paper/client.test.ts
git commit -m "feat: PaperClient connects to paper-desktop and reports identity"
```

---

### Task 4: PaperClient — tool calls and text extraction

Paper returns tool results as MCP content blocks. Tools that don't take a `fileId` return one
block. Every file-scoped tool returns two JSON blocks: a file header, then its payload. Paper also
reports failures in-band, as `isError` results. Centralise all of this here so no other module
parses content blocks.

**Files:**
- Modify: `src/paper/client.ts`
- Test: `test/paper/client-calls.test.ts`

**Interfaces:**
- Consumes: `PaperClient` from Task 3
- Produces on `PaperClient`:
  - `listToolNames(): Promise<string[]>`
  - `callText(name: string, args?: Record<string, unknown>): Promise<string>`: prose tools such
    as `get_guide`
  - `callJson<T>(name: string, args?: Record<string, unknown>): Promise<T>`: tools that return
    exactly one JSON block; rejects multi-block results
  - `callFileScoped<T>(name: string, args?: Record<string, unknown>): Promise<FileScopedResult<T>>`:
    every tool that accepts `fileId`
- Produces at module level:
  - `interface PaperFileHeader { file: { id: string; name: string }; contentHash: { tokens: string } }`
  - `interface FileScopedResult<T> { header: PaperFileHeader; body: T }`
  - `class PaperToolError extends Error { readonly tool: string }`, thrown by every call method
    when Paper returns `isError: true`

- [x] **Step 1: Write the failing test**

Create `test/paper/client-calls.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { startFakePaper, type FakePaper } from "../fakes/fake-paper-server.js";
import { PaperClient, PaperToolError } from "../../src/paper/client.js";

let fake: FakePaper | undefined;
let client: PaperClient | undefined;
afterEach(async () => { await client?.close(); await fake?.close(); fake = undefined; client = undefined; });

describe("PaperClient calls", () => {
  it("lists all 34 tool names", async () => {
    fake = await startFakePaper();
    client = new PaperClient({ url: fake.url });
    await client.connect();

    const names = await client.listToolNames();
    expect(names).toContain("get_tokens");
    expect(names.length).toBe(34);
  });

  it("returns guide text and records the call", async () => {
    fake = await startFakePaper();
    client = new PaperClient({ url: fake.url });
    await client.connect();

    const text = await client.callText("get_guide", { topic: "paper-mcp-instructions" });
    expect(text.length).toBeGreaterThan(1000);
    expect(fake.calls[0]).toEqual({
      name: "get_guide",
      args: { topic: "paper-mcp-instructions" },
    });
  });

  it("parses a single-block JSON result", async () => {
    fake = await startFakePaper();
    client = new PaperClient({ url: fake.url });
    await client.connect();

    expect(await client.callJson("list_files")).toEqual({});
  });

  it("splits a file-scoped result into its file header and payload", async () => {
    fake = await startFakePaper();
    client = new PaperClient({ url: fake.url });
    await client.connect();

    const { header, body } = await client.callFileScoped<{ fileName: string }>("get_basic_info");
    expect(header.file).toEqual({ id: "01FIXTUREFILE0000000000001", name: "Fixture File" });
    expect(header.contentHash.tokens).toBe("0a1b2c3d");
    expect(body.fileName).toBe("Fixture File");
  });

  it("refuses to read a file-scoped result as a single JSON document", async () => {
    fake = await startFakePaper();
    client = new PaperClient({ url: fake.url });
    await client.connect();

    await expect(client.callJson("get_basic_info")).rejects.toThrow(/callFileScoped/);
  });

  it("throws PaperToolError when Paper reports a tool failure", async () => {
    fake = await startFakePaper({ failGuide: true });
    client = new PaperClient({ url: fake.url });
    await client.connect();

    const err = await client
      .callText("get_guide", { topic: "paper-mcp-instructions" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaperToolError);
    expect((err as PaperToolError).tool).toBe("get_guide");
    expect((err as Error).message).toContain("guide unavailable");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/paper/client-calls.test.ts`
Expected: FAIL — `client.listToolNames is not a function`

- [x] **Step 3: Write minimal implementation**

Replace `src/paper/client.ts` with the version below. It adds the header types, `PaperToolError`
and the parse helpers at module level. It adds the call methods inside the class, and makes `raw`
private, since nothing outside the class uses it:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ATELIER_NAME, ATELIER_VERSION } from "../version.js";

export const PAPER_DEFAULT_URL = "http://127.0.0.1:29979/mcp";

export interface PaperServerInfo { name: string; version: string; }

export class PaperUnavailableError extends Error {
  constructor(readonly url: string, cause?: unknown) {
    super(
      `Paper is not reachable at ${url}. Open the Paper desktop app and open a file, then retry.`,
    );
    this.name = "PaperUnavailableError";
    this.cause = cause;
  }
}

/** Paper reported a tool failure (an isError result), e.g. invalid arguments. */
export class PaperToolError extends Error {
  constructor(readonly tool: string, detail: string) {
    super(`Paper tool ${tool} failed: ${detail}`);
    this.name = "PaperToolError";
  }
}

/** Sent ahead of every file-scoped result; contentHash changes when tokens are edited. */
export interface PaperFileHeader {
  file: { id: string; name: string };
  contentHash: { tokens: string };
}

export interface FileScopedResult<T> { header: PaperFileHeader; body: T; }

function parseJson<T>(tool: string, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`Paper tool ${tool} did not return JSON: ${text.slice(0, 120)}`, {
      cause: err,
    });
  }
}

function parseHeader(tool: string, text: string): PaperFileHeader {
  const raw = parseJson<{
    file?: { id?: unknown; name?: unknown };
    contentHash?: { tokens?: unknown };
  }>(tool, text);
  const id = raw.file?.id;
  const name = raw.file?.name;
  const tokens = raw.contentHash?.tokens;
  if (typeof id !== "string" || typeof name !== "string" || typeof tokens !== "string") {
    throw new Error(`Paper tool ${tool} returned no file header: ${text.slice(0, 120)}`);
  }
  return { file: { id, name }, contentHash: { tokens } };
}

export interface PaperClientOptions { url?: string; }

export class PaperClient {
  readonly url: string;
  #client: Client | undefined;

  constructor(opts: PaperClientOptions = {}) {
    this.url = opts.url ?? PAPER_DEFAULT_URL;
  }

  get connected(): boolean { return this.#client !== undefined; }

  async connect(): Promise<PaperServerInfo> {
    // Idempotent: preflight may be called repeatedly on a long-lived client.
    if (this.#client !== undefined) {
      const cached = this.#client.getServerVersion();
      return { name: cached?.name ?? "unknown", version: cached?.version ?? "unknown" };
    }
    const client = new Client({ name: ATELIER_NAME, version: ATELIER_VERSION });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(this.url)));
    } catch (err) {
      throw new PaperUnavailableError(this.url, err);
    }
    this.#client = client;
    const info = client.getServerVersion();
    return { name: info?.name ?? "unknown", version: info?.version ?? "unknown" };
  }

  async close(): Promise<void> {
    await this.#client?.close();
    this.#client = undefined;
  }

  async listToolNames(): Promise<string[]> {
    const { tools } = await this.raw.listTools();
    return tools.map((t) => t.name);
  }

  async callText(name: string, args: Record<string, unknown> = {}): Promise<string> {
    return (await this.#textBlocks(name, args)).join("");
  }

  /** For tools that return one JSON document. File-scoped tools need callFileScoped. */
  async callJson<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const blocks = await this.#textBlocks(name, args);
    const [only] = blocks;
    if (blocks.length !== 1 || only === undefined) {
      throw new Error(
        `Paper tool ${name} returned ${blocks.length} content blocks; ` +
          "file-scoped tools must be read with callFileScoped",
      );
    }
    return parseJson<T>(name, only);
  }

  /**
   * Every file-scoped tool (any that accepts fileId) answers with two JSON blocks:
   * a file header, then the tool's own payload.
   */
  async callFileScoped<T>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<FileScopedResult<T>> {
    const blocks = await this.#textBlocks(name, args);
    const [headerText, bodyText] = blocks;
    if (blocks.length !== 2 || headerText === undefined || bodyText === undefined) {
      throw new Error(
        `Paper tool ${name} returned ${blocks.length} content blocks; ` +
          "expected a file header and a payload",
      );
    }
    return { header: parseHeader(name, headerText), body: parseJson<T>(name, bodyText) };
  }

  async #textBlocks(name: string, args: Record<string, unknown>): Promise<string[]> {
    const result = await this.raw.callTool({ name, arguments: args });
    const blocks = ((result.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string);
    // Paper reports tool failures in-band; never hand the error text back as data.
    if (result.isError === true) throw new PaperToolError(name, blocks.join("\n"));
    return blocks;
  }

  private get raw(): Client {
    if (this.#client === undefined) throw new PaperUnavailableError(this.url);
    return this.#client;
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/paper/client-calls.test.ts`
Expected: PASS (6 tests)

- [x] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: PASS (all tasks so far)

- [x] **Step 6: Commit**

```bash
git add src/paper/client.ts test/paper/client-calls.test.ts
git commit -m "feat: PaperClient tool calls with text and JSON extraction"
```

---

### Task 5: Capability probe

Spec §11 requires degrading gracefully when Paper's tool surface differs from the version we
built against. This probe is the single place that knowledge lives.

**Files:**
- Create: `src/paper/capabilities.ts`
- Test: `test/paper/capabilities.test.ts`

**Interfaces:**
- Consumes: `PaperClient.listToolNames` from Task 4
- Produces:
  - `REQUIRED_PAPER_TOOLS: readonly string[]`
  - `interface PaperCapabilities { readonly tools: ReadonlySet<string>; has(name: string): boolean; missing(): string[]; }`
  - `probeCapabilities(toolNames: readonly string[]): PaperCapabilities`

- [x] **Step 1: Write the failing test**

Create `test/paper/capabilities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  probeCapabilities,
  REQUIRED_PAPER_TOOLS,
} from "../../src/paper/capabilities.js";
import { PAPER_TOOL_NAMES } from "../fakes/fake-paper-server.js";

describe("capability probe", () => {
  it("reports nothing missing against the captured surface", () => {
    const caps = probeCapabilities(PAPER_TOOL_NAMES);
    expect(caps.missing()).toEqual([]);
    expect(caps.has("create_tokens")).toBe(true);
  });

  it("reports what is missing on an older surface", () => {
    const older = PAPER_TOOL_NAMES.filter(
      (n) => n !== "create_tokens" && n !== "list_comment_threads",
    );
    const caps = probeCapabilities(older);
    expect(caps.missing().sort()).toEqual(["create_tokens", "list_comment_threads"]);
    expect(caps.has("create_tokens")).toBe(false);
  });

  it("requires only tools Slice 1 actually uses", () => {
    expect(REQUIRED_PAPER_TOOLS).toContain("get_basic_info");
    expect(REQUIRED_PAPER_TOOLS).toContain("get_guide");
    expect(REQUIRED_PAPER_TOOLS).not.toContain("export_combined_pdf");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/paper/capabilities.test.ts`
Expected: FAIL — cannot resolve `../../src/paper/capabilities.js`

- [x] **Step 3: Write minimal implementation**

Create `src/paper/capabilities.ts`:

```ts
/**
 * Tools Slice 1 depends on. Deliberately narrow: adding a name here means
 * Atelier refuses to run without it, so only list genuine hard requirements.
 */
export const REQUIRED_PAPER_TOOLS = [
  "get_basic_info",
  "get_guide",
  "get_tokens",
  "create_tokens",
  "get_screenshot",
  "get_computed_styles",
  "find_nodes",
  "list_comment_threads",
  "set_comment_thread_status",
] as const;

export interface PaperCapabilities {
  readonly tools: ReadonlySet<string>;
  has(name: string): boolean;
  missing(): string[];
}

export function probeCapabilities(toolNames: readonly string[]): PaperCapabilities {
  const tools = new Set(toolNames);
  return {
    tools,
    has: (name) => tools.has(name),
    missing: () => REQUIRED_PAPER_TOOLS.filter((n) => !tools.has(n)),
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/paper/capabilities.test.ts`
Expected: PASS (3 tests)

- [x] **Step 5: Commit**

```bash
git add src/paper/capabilities.ts test/paper/capabilities.test.ts
git commit -m "feat: probe Paper tool surface and report missing capabilities"
```

---

### Task 6: Session store

Holds **process data only** (Global Constraints, §5.1). No node geometry, no styles, no copy.
Keyed by Paper `fileId` so a consult survives an agent restart.

**Files:**
- Create: `src/session/types.ts`
- Create: `src/session/store.ts`
- Test: `test/session/store.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Stage = "DISCOVERY" | "DIRECTION" | "SYSTEM" | "MATERIALIZE" | "CRITIQUE" | "CONVERGED"`
  - `STAGE_ORDER: readonly Stage[]`
  - `interface Session { id: string; paperFileId: string; stage: Stage; brief: string; createdAt: string; updatedAt: string; }`
  - `class SessionStore { constructor(dbPath: string); create(input: { paperFileId: string; brief: string }): Session; get(id: string): Session | undefined; getByFileId(fileId: string): Session | undefined; setStage(id: string, stage: Stage): Session; close(): void; }`
  - `class UnknownSessionError extends Error`

- [x] **Step 1: Write the failing test**

Create `test/session/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore, UnknownSessionError } from "../../src/session/store.js";

let store: SessionStore;
beforeEach(() => { store = new SessionStore(":memory:"); });
afterEach(() => { store.close(); });

describe("SessionStore", () => {
  it("creates a session at DISCOVERY", () => {
    const s = store.create({ paperFileId: "file-1", brief: "pricing page" });
    expect(s.stage).toBe("DISCOVERY");
    expect(s.paperFileId).toBe("file-1");
    expect(s.id).toMatch(/.+/);
  });

  it("round-trips by id and by file id", () => {
    const s = store.create({ paperFileId: "file-2", brief: "settings" });
    expect(store.get(s.id)?.brief).toBe("settings");
    expect(store.getByFileId("file-2")?.id).toBe(s.id);
    expect(store.get("nope")).toBeUndefined();
  });

  it("advances the stage and bumps updatedAt", async () => {
    const s = store.create({ paperFileId: "file-3", brief: "x" });
    await new Promise((r) => setTimeout(r, 2));
    const moved = store.setStage(s.id, "DIRECTION");
    expect(moved.stage).toBe("DIRECTION");
    expect(moved.updatedAt >= s.updatedAt).toBe(true);
  });

  it("rejects an unknown session", () => {
    expect(() => store.setStage("nope", "SYSTEM")).toThrow(UnknownSessionError);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/session/store.test.ts`
Expected: FAIL — cannot resolve `../../src/session/store.js`

- [x] **Step 3: Write the types**

Create `src/session/types.ts`:

```ts
export type Stage =
  | "DISCOVERY"
  | "DIRECTION"
  | "SYSTEM"
  | "MATERIALIZE"
  | "CRITIQUE"
  | "CONVERGED";

export const STAGE_ORDER: readonly Stage[] = [
  "DISCOVERY",
  "DIRECTION",
  "SYSTEM",
  "MATERIALIZE",
  "CRITIQUE",
  "CONVERGED",
] as const;

export interface Session {
  id: string;
  paperFileId: string;
  stage: Stage;
  brief: string;
  createdAt: string;
  updatedAt: string;
}
```

- [x] **Step 4: Write the store**

Create `src/session/store.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Session, Stage } from "./types.js";

export class UnknownSessionError extends Error {
  constructor(id: string) {
    super(`No session ${id}`);
    this.name = "UnknownSessionError";
  }
}

interface Row {
  id: string;
  paper_file_id: string;
  stage: string;
  brief: string;
  created_at: string;
  updated_at: string;
}

const toSession = (r: Row): Session => ({
  id: r.id,
  paperFileId: r.paper_file_id,
  stage: r.stage as Stage,
  brief: r.brief,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class SessionStore {
  #db: DatabaseSync;

  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        paper_file_id TEXT NOT NULL,
        stage         TEXT NOT NULL,
        brief         TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_file ON sessions(paper_file_id);
    `);
  }

  create(input: { paperFileId: string; brief: string }): Session {
    const now = new Date().toISOString();
    const row: Row = {
      id: randomUUID(),
      paper_file_id: input.paperFileId,
      stage: "DISCOVERY",
      brief: input.brief,
      created_at: now,
      updated_at: now,
    };
    this.#db
      .prepare(
        `INSERT INTO sessions (id, paper_file_id, stage, brief, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.paper_file_id, row.stage, row.brief, row.created_at, row.updated_at);
    return toSession(row);
  }

  get(id: string): Session | undefined {
    const r = this.#db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Row | undefined;
    return r ? toSession(r) : undefined;
  }

  getByFileId(fileId: string): Session | undefined {
    const r = this.#db
      .prepare(`SELECT * FROM sessions WHERE paper_file_id = ? ORDER BY updated_at DESC LIMIT 1`)
      .get(fileId) as Row | undefined;
    return r ? toSession(r) : undefined;
  }

  setStage(id: string, stage: Stage): Session {
    const now = new Date().toISOString();
    const res = this.#db
      .prepare(`UPDATE sessions SET stage = ?, updated_at = ? WHERE id = ?`)
      .run(stage, now, id);
    if (res.changes === 0) throw new UnknownSessionError(id);
    const found = this.get(id);
    if (found === undefined) throw new UnknownSessionError(id);
    return found;
  }

  close(): void {
    this.#db.close();
  }
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/session/store.test.ts`
Expected: PASS (4 tests)

- [x] **Step 6: Commit**

```bash
git add src/session test/session
git commit -m "feat: SQLite session store for process state keyed by Paper fileId"
```

---

### Task 7: preflight

The first real Atelier capability. Spec §11 requires actionable remediation, never a stack
trace. Returns structured checks so a calling agent can decide what to do.

**Files:**
- Create: `src/tools/preflight.ts`
- Test: `test/tools/preflight.test.ts`

**Interfaces:**
- Consumes: `PaperClient` (Tasks 3–4; reads `get_basic_info` via `callFileScoped`),
  `probeCapabilities` (Task 5)
- Produces:
  - `interface PreflightCheck { name: string; ok: boolean; detail: string }`
  - `interface PreflightResult { ok: boolean; checks: PreflightCheck[]; remediation: string[] }`
  - `preflight(client: PaperClient): Promise<PreflightResult>`

- [x] **Step 1: Write the failing test**

Create `test/tools/preflight.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { startFakePaper, PAPER_TOOL_NAMES, type FakePaper } from "../fakes/fake-paper-server.js";
import { PaperClient } from "../../src/paper/client.js";
import { preflight } from "../../src/tools/preflight.js";

let fake: FakePaper | undefined;
let client: PaperClient | undefined;
afterEach(async () => { await client?.close(); await fake?.close(); fake = undefined; client = undefined; });

describe("preflight", () => {
  it("passes against a healthy Paper", async () => {
    fake = await startFakePaper();
    client = new PaperClient({ url: fake.url });
    const result = await preflight(client);

    expect(result.ok).toBe(true);
    expect(result.remediation).toEqual([]);
    expect(result.checks.map((c) => c.name)).toEqual([
      "paper-reachable",
      "file-open",
      "capabilities",
      "guide-loaded",
    ]);
    expect(result.checks[1]?.detail).toContain("Fixture File");
  });

  it("reports Paper's own error when the guide cannot be loaded", async () => {
    fake = await startFakePaper({ failGuide: true });
    client = new PaperClient({ url: fake.url });
    const result = await preflight(client);

    expect(result.ok).toBe(false);
    const guide = result.checks.find((c) => c.name === "guide-loaded");
    expect(guide?.ok).toBe(false);
    expect(guide?.detail).toContain("guide unavailable");
    expect(result.remediation.join(" ")).toMatch(/could not return its guide/i);
  });

  it("fails with remediation when Paper is not running", async () => {
    client = new PaperClient({ url: "http://127.0.0.1:1/mcp" });
    const result = await preflight(client);

    expect(result.ok).toBe(false);
    expect(result.checks[0]?.name).toBe("paper-reachable");
    expect(result.checks[0]?.ok).toBe(false);
    expect(result.remediation.join(" ")).toMatch(/open the paper desktop app/i);
  });

  it("names the missing tools when the surface is older", async () => {
    fake = await startFakePaper({
      toolNames: PAPER_TOOL_NAMES.filter((n) => n !== "create_tokens"),
    });
    client = new PaperClient({ url: fake.url });
    const result = await preflight(client);

    expect(result.ok).toBe(false);
    const caps = result.checks.find((c) => c.name === "capabilities");
    expect(caps?.ok).toBe(false);
    expect(caps?.detail).toContain("create_tokens");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tools/preflight.test.ts`
Expected: FAIL — cannot resolve `../../src/tools/preflight.js`

- [x] **Step 3: Write minimal implementation**

Create `src/tools/preflight.ts`:

```ts
import { PaperClient } from "../paper/client.js";
import { probeCapabilities } from "../paper/capabilities.js";

export interface PreflightCheck { name: string; ok: boolean; detail: string; }

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
  remediation: string[];
}

export async function preflight(client: PaperClient): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const remediation: string[] = [];

  try {
    const info = await client.connect();
    checks.push({
      name: "paper-reachable",
      ok: true,
      detail: `${info.name} ${info.version} at ${client.url}`,
    });
  } catch {
    checks.push({
      name: "paper-reachable",
      ok: false,
      detail: `nothing responding at ${client.url}`,
    });
    remediation.push("Open the Paper desktop app and open a file, then retry preflight.");
    return { ok: false, checks, remediation };
  }

  try {
    const { header } = await client.callFileScoped<unknown>("get_basic_info");
    const ok = header.file.id.length > 0;
    checks.push({
      name: "file-open",
      ok,
      detail: ok ? `file "${header.file.name || "untitled"}" is open` : "no file open",
    });
    if (!ok) remediation.push("Open a file in Paper — the MCP server needs an open document.");
  } catch (err) {
    checks.push({ name: "file-open", ok: false, detail: String(err) });
    remediation.push("Open a file in Paper — the MCP server needs an open document.");
  }

  try {
    const names = await client.listToolNames();
    const missing = probeCapabilities(names).missing();
    checks.push({
      name: "capabilities",
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `${names.length} tools available`
          : `missing required tools: ${missing.join(", ")}`,
    });
    if (missing.length > 0) {
      remediation.push(`Update Paper — this version is missing: ${missing.join(", ")}.`);
    }
  } catch (err) {
    checks.push({ name: "capabilities", ok: false, detail: String(err) });
    remediation.push("Paper stopped responding mid-check; restart the Paper desktop app.");
  }

  try {
    const guide = await client.callText("get_guide", { topic: "paper-mcp-instructions" });
    const ok = guide.length > 0;
    checks.push({ name: "guide-loaded", ok, detail: `${guide.length} chars` });
    if (!ok) remediation.push("Paper returned an empty guide; restart the Paper desktop app.");
  } catch (err) {
    checks.push({ name: "guide-loaded", ok: false, detail: String(err) });
    remediation.push("Paper could not return its guide; restart the Paper desktop app.");
  }

  return { ok: checks.every((c) => c.ok), checks, remediation };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tools/preflight.test.ts`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add src/tools/preflight.ts test/tools/preflight.test.ts
git commit -m "feat: preflight reports Paper health with actionable remediation"
```

---

### Task 8: MCP server wiring and entry point

Exposes `preflight` as a real MCP tool over stdio and makes the package installable.

**Files:**
- Create: `src/server.ts`
- Create: `src/index.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `createAtelierServer(deps: { paper: PaperClient }): McpServer`
  - `src/index.ts` as the stdio binary entry

- [x] **Step 1: Write the failing test**

Create `test/server.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startFakePaper, type FakePaper } from "./fakes/fake-paper-server.js";
import { PaperClient } from "../src/paper/client.js";
import { createAtelierServer } from "../src/server.js";

let fake: FakePaper | undefined;
let paper: PaperClient | undefined;
afterEach(async () => { await paper?.close(); await fake?.close(); fake = undefined; paper = undefined; });

describe("atelier MCP server", () => {
  it("advertises preflight and returns a healthy report", async () => {
    fake = await startFakePaper();
    paper = new PaperClient({ url: fake.url });

    const server = createAtelierServer({ paper });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("preflight");

    const res = await client.callTool({ name: "preflight", arguments: {} });
    const text = (res.content as Array<{ type: string; text?: string }>)
      .map((b) => b.text ?? "")
      .join("");
    const report = JSON.parse(text) as { ok: boolean; checks: unknown[] };

    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(4);

    await client.close();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL — cannot resolve `../src/server.js`

- [x] **Step 3: Write the server**

Create `src/server.ts`:

```ts
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
```

- [x] **Step 4: Write the entry point**

Create `src/index.ts`:

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaperClient } from "./paper/client.js";
import { createAtelierServer } from "./server.js";

const paper = new PaperClient();
const server = createAtelierServer({ paper });
await server.connect(new StdioServerTransport());
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/server.test.ts`
Expected: PASS (1 test)

- [x] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: all tests PASS, no type errors, `dist/index.js` produced

- [x] **Step 7: Manual verification against real Paper**

Open the Paper desktop app with a file open. Then drive the built binary over stdio, exactly as an
MCP host would. This needs no change to any Claude Code config:

```bash
node --input-type=module -e "
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'manual-verify', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['dist/index.js'], stderr: 'pipe' }));
const res = await client.callTool({ name: 'preflight', arguments: {} });
console.log(res.content.map((b) => b.text).join(''));
await client.close();
"
```

Expected: `ok: true` with four passing checks, and the `file-open` detail names the open file. Then
quit Paper and run it again. Expected: `ok: false` with
`"Open the Paper desktop app and open a file, then retry preflight."`, never a stack trace.

To also try it from a Claude Code session, register it **from the main checkout after merge**. A
worktree path disappears when the worktree is cleaned up, and `--scope user` edits your global
config:

```bash
claude mcp add atelier --scope user -- node "$(pwd)/dist/index.js"
```

- [x] **Step 8: Commit**

```bash
git add src/server.ts src/index.ts test/server.test.ts
git commit -m "feat: expose preflight over stdio as the atelier MCP server"
```

---

## Carry-forward for Plan 1B

- Read every file-scoped tool with `callFileScoped`. `header.file.id` is the Paper `fileId` that
  sessions are keyed by.
- 28 tools *require* `fileId`; only `get_basic_info` and `get_selection` accept it as optional.
  Take it from `get_basic_info`'s header and pass it explicitly. Paper answers a missing required
  argument with an `isError` result, which surfaces as `PaperToolError`.
- `header.contentHash.tokens` changes when tokens are edited outside the session. That is the
  guide's cue to re-read with `get_tokens` before trusting token names or values (§5.1: Paper wins).
- The fake returns `{}` payloads for every file-scoped tool except `get_basic_info`. Before 1B
  depends on a tool's payload (`get_tokens`, `get_computed_styles`, `find_nodes`,
  `list_comment_threads`, …), capture its real two-block response from Paper and commit it with
  synthetic values, as was done for `paper-get-basic-info.json`.

## What 1A deliberately leaves out

These belong to later plans and must **not** be built here:

- `start_consult` / `advance` and the six seat contracts → **Plan 1B**
- `establish_tokens` / `audit_tokens` and the §4.4 ordering validator → **Plan 1B**
- `plan_materialization` / `validate_markup` and the §4.3 subset validator → **Plan 1B**
- `critique` / `post_findings` / `sync_feedback` → **Plan 1C**
- `specify_motion` / `get_motion_graph` → **Plan 1C**
- Server-side agent fan-out (§5.3) → Slice 3
- Handoff adapters → Slice 2

## Definition of done

- [x] `npx vitest run` passes (27 tests across 8 files)
- [x] `npm run typecheck` clean under `strict` + `noUncheckedIndexedAccess`
- [x] `npm run build` produces `dist/index.js`
- [x] `preflight` verified manually against real Paper, both running and quit
  - running: passed 2026-09-21 on paper-desktop 0.5.11 (`ok: true`, four passing checks, empty stderr)
  - quit: passed 2026-09-23 (`ok: false`, `paper-reachable` alone, the documented remediation, empty
    stderr, and a normal tool result rather than a protocol error)
- [x] No module outside `src/paper/` imports the MCP SDK client
- [x] No module outside `src/paper/` parses Paper content blocks
- [x] Nothing in `src/session/` stores design data (Global Constraints, §5.1)
