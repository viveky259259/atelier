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
