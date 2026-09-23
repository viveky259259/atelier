import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore, UnknownSessionError } from "../../src/session/store.js";

let store: SessionStore;
beforeEach(() => { store = new SessionStore(":memory:"); });
afterEach(() => { store.close(); });

describe("SessionStore", () => {
  it("creates a session at DISCOVERY", () => {
    const s = store.create({ paperFileId: "file-1", brief: "pricing page" });
    expect(s.stage).toBe("DISCOVERY");
    expect(s.paperFileId).toBe("file-1");
    expect(s.id).toMatch(/.+/);
  });

  it("round-trips by id and by file id", () => {
    const s = store.create({ paperFileId: "file-2", brief: "settings" });
    expect(store.get(s.id)?.brief).toBe("settings");
    expect(store.getByFileId("file-2")?.id).toBe(s.id);
    expect(store.get("nope")).toBeUndefined();
  });

  it("advances the stage and bumps updatedAt", async () => {
    const s = store.create({ paperFileId: "file-3", brief: "x" });
    await new Promise((r) => setTimeout(r, 2));
    const moved = store.setStage(s.id, "DIRECTION");
    expect(moved.stage).toBe("DIRECTION");
    expect(moved.updatedAt >= s.updatedAt).toBe(true);
  });

  it("rejects an unknown session", () => {
    expect(() => store.setStage("nope", "SYSTEM")).toThrow(UnknownSessionError);
  });
});
