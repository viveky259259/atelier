import { describe, it, expect } from "vitest";
import {
  probeCapabilities,
  REQUIRED_PAPER_TOOLS,
} from "../../src/paper/capabilities.js";
import { PAPER_TOOL_NAMES } from "../fakes/fake-paper-server.js";

describe("capability probe", () => {
  it("reports nothing missing against the captured surface", () => {
    const caps = probeCapabilities(PAPER_TOOL_NAMES);
    expect(caps.missing()).toEqual([]);
    expect(caps.has("create_tokens")).toBe(true);
  });

  it("reports what is missing on an older surface", () => {
    const older = PAPER_TOOL_NAMES.filter(
      (n) => n !== "create_tokens" && n !== "list_comment_threads",
    );
    const caps = probeCapabilities(older);
    expect(caps.missing().sort()).toEqual(["create_tokens", "list_comment_threads"]);
    expect(caps.has("create_tokens")).toBe(false);
  });

  it("requires only tools Slice 1 actually uses", () => {
    expect(REQUIRED_PAPER_TOOLS).toContain("get_basic_info");
    expect(REQUIRED_PAPER_TOOLS).toContain("get_guide");
    expect(REQUIRED_PAPER_TOOLS).not.toContain("export_combined_pdf");
  });
});
