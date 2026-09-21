import { PaperClient } from "../paper/client.js";
import { probeCapabilities } from "../paper/capabilities.js";

export interface PreflightCheck { name: string; ok: boolean; detail: string; }

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
  remediation: string[];
}

export async function preflight(client: PaperClient): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const remediation: string[] = [];

  try {
    const info = await client.connect();
    checks.push({
      name: "paper-reachable",
      ok: true,
      detail: `${info.name} ${info.version} at ${client.url}`,
    });
  } catch {
    checks.push({
      name: "paper-reachable",
      ok: false,
      detail: `nothing responding at ${client.url}`,
    });
    remediation.push("Open the Paper desktop app and open a file, then retry preflight.");
    return { ok: false, checks, remediation };
  }

  try {
    const info = await client.callJson<{ fileName?: string; fileId?: string }>("get_basic_info");
    const ok = typeof info.fileId === "string" && info.fileId.length > 0;
    checks.push({
      name: "file-open",
      ok,
      detail: ok ? `file "${info.fileName ?? "untitled"}" is open` : "no file open",
    });
    if (!ok) remediation.push("Open a file in Paper — the MCP server needs an open document.");
  } catch (err) {
    checks.push({ name: "file-open", ok: false, detail: String(err) });
    remediation.push("Open a file in Paper — the MCP server needs an open document.");
  }

  try {
    const names = await client.listToolNames();
    const missing = probeCapabilities(names).missing();
    checks.push({
      name: "capabilities",
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `${names.length} tools available`
          : `missing required tools: ${missing.join(", ")}`,
    });
    if (missing.length > 0) {
      remediation.push(`Update Paper — this version is missing: ${missing.join(", ")}.`);
    }
  } catch (err) {
    checks.push({ name: "capabilities", ok: false, detail: String(err) });
    remediation.push("Paper stopped responding mid-check; restart the Paper desktop app.");
  }

  try {
    const guide = await client.callText("get_guide", { topic: "paper-mcp-instructions" });
    const ok = guide.length > 0;
    checks.push({ name: "guide-loaded", ok, detail: `${guide.length} chars` });
    if (!ok) remediation.push("Paper returned an empty guide; restart the Paper desktop app.");
  } catch (err) {
    checks.push({ name: "guide-loaded", ok: false, detail: String(err) });
    remediation.push("Paper returned an empty guide; restart the Paper desktop app.");
  }

  return { ok: checks.every((c) => c.ok), checks, remediation };
}
