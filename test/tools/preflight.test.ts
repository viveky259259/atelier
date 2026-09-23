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
    expect(result.checks[1]?.detail).toContain("Fixture File");
  });

  it("reports Paper's own error when the guide cannot be loaded", async () => {
    fake = await startFakePaper({ failGuide: true });
    client = new PaperClient({ url: fake.url });
    const result = await preflight(client);

    expect(result.ok).toBe(false);
    const guide = result.checks.find((c) => c.name === "guide-loaded");
    expect(guide?.ok).toBe(false);
    expect(guide?.detail).toContain("guide unavailable");
    expect(result.remediation.join(" ")).toMatch(/could not return its guide/i);
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
