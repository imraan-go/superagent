import { describe, expect, it } from "vitest";
import { frameAncestorsAllows } from "./frame-ancestors";

const PANEL = "https://hostx.h22t.com";

describe("frameAncestorsAllows", () => {
  it("accepts the viewer's production policy", () => {
    expect(frameAncestorsAllows("frame-ancestors 'self' https://hostx.h22t.com", PANEL)).toBe(true);
  });
  it("rejects 'self' / 'none' only", () => {
    expect(frameAncestorsAllows("default-src 'self'; frame-ancestors 'self'", PANEL)).toBe(false);
    expect(frameAncestorsAllows("frame-ancestors 'none'", PANEL)).toBe(false);
  });
  it("handles wildcards, hosts and schemes", () => {
    expect(frameAncestorsAllows("frame-ancestors https://*.h22t.com", PANEL)).toBe(true);
    expect(frameAncestorsAllows("frame-ancestors hostx.h22t.com", PANEL)).toBe(true);
    expect(frameAncestorsAllows("frame-ancestors https:", PANEL)).toBe(true);
    expect(frameAncestorsAllows("frame-ancestors *", PANEL)).toBe(true);
    expect(frameAncestorsAllows("frame-ancestors https://*.example.com", PANEL)).toBe(false);
  });
  it("has no opinion without the directive", () => {
    expect(frameAncestorsAllows("default-src 'self'", PANEL)).toBeNull();
  });
});
