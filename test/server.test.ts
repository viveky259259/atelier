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
