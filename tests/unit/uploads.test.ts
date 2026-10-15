import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, sanitizeFileName, servingHeaders, validateUpload } from "@/lib/uploads";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe("validateUpload", () => {
  it("accepts a real png", () => {
    const r = validateUpload({ name: "shot.PNG", bytes: 100, head: PNG });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind.mime).toBe("image/png");
  });

  it("rejects disallowed extensions (svg, html, exe)", () => {
    for (const name of ["a.svg", "a.html", "a.exe", "noext"]) {
      const r = validateUpload({ name, bytes: 10, head: PNG });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("type_not_allowed");
    }
  });

  it("rejects oversize and empty files", () => {
    const big = validateUpload({ name: "a.png", bytes: MAX_UPLOAD_BYTES + 1, head: PNG });
    expect(big.ok === false && big.code).toBe("too_large");
    const empty = validateUpload({ name: "a.png", bytes: 0, head: PNG });
    expect(empty.ok === false && empty.code).toBe("empty");
  });

  it("rejects a renamed binary", () => {
    const r = validateUpload({
      name: "evil.png",
      bytes: 10,
      head: Uint8Array.from([0x4d, 0x5a, 0, 0]),
    });
    expect(r.ok === false && r.code).toBe("content_mismatch");
    const txt = validateUpload({ name: "a.txt", bytes: 10, head: Uint8Array.from([0x68, 0, 0x69]) });
    expect(txt.ok === false && txt.code).toBe("content_mismatch");
  });

  it("accepts text and zip-based documents", () => {
    expect(
      validateUpload({ name: "a.csv", bytes: 3, head: new TextEncoder().encode("a,b") }).ok,
    ).toBe(true);
    expect(
      validateUpload({ name: "a.docx", bytes: 9, head: Uint8Array.from([0x50, 0x4b, 3, 4]) }).ok,
    ).toBe(true);
  });
});

describe("sanitizeFileName", () => {
  it("drops paths and quotes", () => {
    expect(sanitizeFileName('../../etc/pass"wd.txt')).toBe("passwd.txt");
    expect(sanitizeFileName("C:\\x\\y.pdf")).toBe("y.pdf");
    expect(sanitizeFileName("")).toBe("file");
  });
});

describe("servingHeaders", () => {
  it("always sends nosniff and a sandboxed no-script CSP", () => {
    const h = servingHeaders({ mime: "image/png", name: "a.png", bytes: 10 });
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("default-src 'none'");
    expect(h["content-security-policy"]).toContain("sandbox");
    expect(h["content-type"]).toBe("image/png");
    expect(h["content-disposition"]!.startsWith("inline;")).toBe(true);
  });

  it("forces non-images to download and keeps the header injection-safe", () => {
    const h = servingHeaders({ mime: "text/csv", name: 'ré"port\\.csv', bytes: 3 });
    expect(h["content-disposition"]!.startsWith("attachment;")).toBe(true);
    expect(h["content-disposition"]).toContain('filename="r__port_.csv"');
    expect(h["content-disposition"]).toContain("filename*=UTF-8''r%C3%A9%22port%5C.csv");
  });
});
