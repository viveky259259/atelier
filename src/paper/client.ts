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

  private get raw(): Client {
    if (this.#client === undefined) throw new PaperUnavailableError(this.url);
    return this.#client;
  }
}
