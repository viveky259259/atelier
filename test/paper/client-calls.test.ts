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
