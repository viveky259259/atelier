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
