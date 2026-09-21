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
