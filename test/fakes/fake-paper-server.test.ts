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
