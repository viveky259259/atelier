# Atelier Slice 1A — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable `atelier` MCP server that connects to `paper-desktop`, persists design sessions, probes Paper's capabilities, and answers a working `preflight` tool.

**Architecture:** Atelier is simultaneously an MCP **server** over stdio (to Claude Code, Cursor, etc.) and an MCP **client** over streamable HTTP (to `paper-desktop` at `http://127.0.0.1:29979/mcp`, for reads only). Session process-state persists in SQLite keyed by Paper `fileId`. All tests run against a fake `paper-desktop` built with the real MCP SDK server transport and replaying captured fixtures, so the real transport path is exercised without Paper running.

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk`, `zod`, `node:sqlite` (built in — no native compile), Vitest, Node 26.

**Spec:** `docs/superpowers/specs/2026-09-19-atelier-design.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include these.

- **Ownership (§5.1):** Paper owns all design data; Atelier owns only process data (stage, decisions, rubric scores, semantic-name↔nodeId map). On conflict, **Paper wins** and Atelier re-derives by reading.
- **No proxying (§5):** Atelier never proxies Paper's write tools. It plans and validates; the caller executes writes against Paper directly.
- **Node identity (§4.2):** `write_html` is used once per node at genesis; every refinement mutates in place. Never regenerate a node that has comment threads attached.
- **HTML subset (§4.3):** inline styles only; forbidden — `margin`, `display: inline`, `display: grid`, HTML tables; layout is flex + padding + gap exclusively; `border-box` everywhere.
- **Token order (§4.4):** colours semantic before palette, neutral → primary → secondary → accent; all other types smallest value first; aliasing via `var(--other-token)`.
- **Session protocol (§4.5):** `get_guide({topic:"paper-mcp-instructions"})` once per session before other Paper tools; `get_font_family_info` before first typographic styling; `finish_working_on_nodes` when a write sequence completes; **never show raw node IDs to the user**; exact values come from `get_jsx`/`get_computed_styles`/`get_tokens`, **never** from screenshots.
- **No motion primitives (§4.6):** Paper has no transition/animation/easing/hover/variant concept. Never emit CSS `transition`/`animation` into `write_html`.
- **Paper endpoint:** `http://127.0.0.1:29979/mcp`; server identifies as `paper-desktop`, probed at version `0.5.8`.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/version.ts`
- Test: `test/version.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ATELIER_NAME: string`, `ATELIER_VERSION: string` from `src/version.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "atelier",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "atelier": "./dist/index.js" },
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
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

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

- [ ] **Step 3: Create `vitest.config.ts`**

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

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
*.sqlite
*.sqlite-journal
.DS_Store
```

- [ ] **Step 5: Install dependencies**

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

- [ ] **Step 6: Write the failing test**

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

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/version.test.ts`
Expected: FAIL — cannot resolve `../src/version.js`

- [ ] **Step 8: Write minimal implementation**

Create `src/version.ts`:

```ts
export const ATELIER_NAME = "atelier";
export const ATELIER_VERSION = "0.1.0";
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run test/version.test.ts`
Expected: PASS (1 test)

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/version.ts test/version.test.ts package-lock.json
git commit -m "chore: scaffold TypeScript MCP project with vitest"
```

---

### Task 2: Fake paper-desktop server

The fake is built from the **real** MCP SDK server transport so tests exercise the real
protocol path. It registers every tool name found in the captured `tools/list` fixture, and
returns fixture payloads for the handful of tools Slice 1A actually calls.

Fixtures are already committed at `test/fixtures/`:
`paper-initialize.json`, `paper-tools-list.json` (all 34 schemas), `paper-guide.md`.

**Files:**
- Create: `test/fakes/fake-paper-server.ts`
- Test: `test/fakes/fake-paper-server.test.ts`

**Interfaces:**
- Consumes: `test/fixtures/*`
- Produces: `startFakePaper(opts?: FakePaperOptions): Promise<FakePaper>` where
  `FakePaper = { url: string; close(): Promise<void>; calls: FakeCall[] }` and
  `FakeCall = { name: string; args: Record<string, unknown> }`.
  `FakePaperOptions = { toolNames?: string[]; basicInfo?: unknown; failGuide?: boolean }`.

- [ ] **Step 1: Write the failing test**

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/fakes/fake-paper-server.test.ts`
Expected: FAIL — cannot resolve `./fake-paper-server.js`

- [ ] **Step 3: Write minimal implementation**

Create `test/fakes/fake-paper-server.ts`:

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
) as { result: { tools: Array<{ name: string }> } };

const guideText = readFileSync(join(fixtures, "paper-guide.md"), "utf8");

export const PAPER_TOOL_NAMES: string[] = toolsFixture.result.tools.map((t) => t.name);

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

const DEFAULT_BASIC_INFO = {
  fileName: "Fixture File",
  fileId: "file-fixture-1",
  pageName: "Page 1",
  nodeCount: 12,
  artboards: [{ name: "Home", width: 1440, height: 1024 }],
};

export async function startFakePaper(opts: FakePaperOptions = {}): Promise<FakePaper> {
  const calls: FakeCall[] = [];
  const names = opts.toolNames ?? PAPER_TOOL_NAMES;
  const basicInfo = opts.basicInfo ?? DEFAULT_BASIC_INFO;

  // Low-level Server, not McpServer: registerTool with an empty zod shape would
  // strip tool arguments, so recorded calls would lose their args.
  const mcp = new Server(
    { name: "paper-desktop", version: "0.5.8" },
    { capabilities: { tools: {} } },
  );
  const known = new Set(names);

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
      if (opts.failGuide) throw new Error("guide unavailable");
      return { content: [{ type: "text" as const, text: guideText }] };
    }
    if (name === "get_basic_info") {
      return { content: [{ type: "text" as const, text: JSON.stringify(basicInfo) }] };
    }
    return { content: [{ type: "text" as const, text: "{}" }] };
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      void transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");

  return {
    url: `http://127.0.0.1:${addr.port}/mcp`,
    calls,
    async close() {
      await transport.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/fakes/fake-paper-server.test.ts`
Expected: PASS (2 tests). If the tool count assertion fails, print
`PAPER_TOOL_NAMES.length` — the fixture is authoritative; fix the test, not the fixture.

- [ ] **Step 5: Commit**

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

- [ ] **Step 1: Write the failing test**

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
    expect(info.version).toBe("0.5.8");
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/paper/client.test.ts`
Expected: FAIL — cannot resolve `../../src/paper/client.js`

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/paper/client.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/paper/client.ts test/paper/client.test.ts
git commit -m "feat: PaperClient connects to paper-desktop and reports identity"
```

---

### Task 4: PaperClient — tool calls and text extraction

Paper returns tool results as MCP content blocks. Every caller needs the text, and most
Paper reads return JSON inside that text. Centralise both here so no other module parses
content blocks.

**Files:**
- Modify: `src/paper/client.ts`
- Test: `test/paper/client-calls.test.ts`

**Interfaces:**
- Consumes: `PaperClient` from Task 3
- Produces on `PaperClient`:
  - `listToolNames(): Promise<string[]>`
  - `callText(name: string, args?: Record<string, unknown>): Promise<string>`
  - `callJson<T>(name: string, args?: Record<string, unknown>): Promise<T>`

- [ ] **Step 1: Write the failing test**

Create `test/paper/client-calls.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { startFakePaper, type FakePaper } from "../fakes/fake-paper-server.js";
import { PaperClient } from "../../src/paper/client.js";

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

  it("parses JSON responses", async () => {
    fake = await startFakePaper();
    client = new PaperClient({ url: fake.url });
    await client.connect();

    const info = await client.callJson<{ fileId: string }>("get_basic_info");
    expect(info.fileId).toBe("file-fixture-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/paper/client-calls.test.ts`
Expected: FAIL — `client.listToolNames is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `src/paper/client.ts`, inside the `PaperClient` class (before the `raw` getter):

```ts
  async listToolNames(): Promise<string[]> {
    const { tools } = await this.raw.listTools();
    return tools.map((t) => t.name);
  }

  async callText(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await this.raw.callTool({ name, arguments: args });
    const blocks = (result.content ?? []) as Array<{ type: string; text?: string }>;
    return blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
  }

  async callJson<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const text = await this.callText(name, args);
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new Error(`Paper tool ${name} did not return JSON: ${text.slice(0, 120)}`, {
        cause: err,
      });
    }
  }
```

Also change `protected get raw()` to `private get raw()` — nothing outside the class uses it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/paper/client-calls.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: PASS (all tasks so far)

- [ ] **Step 6: Commit**

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

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/paper/capabilities.test.ts`
Expected: FAIL — cannot resolve `../../src/paper/capabilities.js`

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/paper/capabilities.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

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

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/session/store.test.ts`
Expected: FAIL — cannot resolve `../../src/session/store.js`

- [ ] **Step 3: Write the types**

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

- [ ] **Step 4: Write the store**

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

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/session/store.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

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
- Consumes: `PaperClient` (Tasks 3–4), `probeCapabilities` (Task 5)
- Produces:
  - `interface PreflightCheck { name: string; ok: boolean; detail: string }`
  - `interface PreflightResult { ok: boolean; checks: PreflightCheck[]; remediation: string[] }`
  - `preflight(client: PaperClient): Promise<PreflightResult>`

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tools/preflight.test.ts`
Expected: FAIL — cannot resolve `../../src/tools/preflight.js`

- [ ] **Step 3: Write minimal implementation**

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
    const info = await client.callJson<{ fileName?: string; fileId?: string }>("get_basic_info");
    const ok = typeof info.fileId === "string" && info.fileId.length > 0;
    checks.push({
      name: "file-open",
      ok,
      detail: ok ? `file "${info.fileName ?? "untitled"}" is open` : "no file open",
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
    remediation.push("Paper returned an empty guide; restart the Paper desktop app.");
  }

  return { ok: checks.every((c) => c.ok), checks, remediation };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tools/preflight.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

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

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL — cannot resolve `../src/server.js`

- [ ] **Step 3: Write the server**

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

- [ ] **Step 4: Write the entry point**

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

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/server.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: all tests PASS, no type errors, `dist/index.js` produced

- [ ] **Step 7: Manual verification against real Paper**

Open the Paper desktop app with a file open, then:

```bash
claude mcp add atelier --scope user -- node "$(pwd)/dist/index.js"
```

In a new Claude Code session, ask it to call `preflight`. Expected: `ok: true` with four
passing checks. Then quit Paper and call it again. Expected: `ok: false` with
`"Open the Paper desktop app and open a file, then retry preflight."` — never a stack trace.

- [ ] **Step 8: Commit**

```bash
git add src/server.ts src/index.ts test/server.test.ts
git commit -m "feat: expose preflight over stdio as the atelier MCP server"
```

---

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

- [ ] `npx vitest run` passes — 21 tests across 8 files
- [ ] `npm run typecheck` clean under `strict` + `noUncheckedIndexedAccess`
- [ ] `npm run build` produces `dist/index.js`
- [ ] `preflight` verified manually against real Paper, both running and quit
- [ ] No module outside `src/paper/` imports the MCP SDK client
- [ ] Nothing in `src/session/` stores design data (Global Constraints, §5.1)
