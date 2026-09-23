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
