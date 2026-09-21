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
