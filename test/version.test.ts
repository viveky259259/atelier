import { describe, it, expect } from "vitest";
import { ATELIER_NAME, ATELIER_VERSION } from "../src/version.js";

describe("version", () => {
  it("identifies the server", () => {
    expect(ATELIER_NAME).toBe("atelier");
    expect(ATELIER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
