import { describe, it, expect } from "bun:test";
import { isValidMediaId } from "../services/media";

describe("isValidMediaId", () => {
  it("accepts valid UUID v4 format", () => {
    expect(isValidMediaId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidMediaId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
  });

  it("rejects path traversal attempts", () => {
    expect(isValidMediaId("../etc/passwd")).toBe(false);
    expect(isValidMediaId("..\\windows\\system32")).toBe(false);
    expect(isValidMediaId("/etc/passwd")).toBe(false);
    expect(isValidMediaId("file.txt")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidMediaId("ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ")).toBe(false);
    expect(isValidMediaId("XXXXX")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidMediaId("a1b2c3d4")).toBe(false);
    expect(isValidMediaId("a1b2c3d4-e5f6-7890-abcd-ef1234567890-extra")).toBe(false);
    expect(isValidMediaId("")).toBe(false);
  });

  it("rejects upper case (uuid v4 is lowercase)", () => {
    expect(isValidMediaId("550E8400-E29B-41D4-A716-446655440000")).toBe(false);
  });
});

describe("media descriptor shape", () => {
  it("serializes and parses correctly", () => {
    const descriptors = [
      { id: "550e8400-e29b-41d4-a716-446655440000", filename: "photo.jpg", mime: "image/jpeg" },
      { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", filename: "doc.pdf", mime: "application/pdf" },
    ];
    const json = JSON.stringify(descriptors);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(parsed[1].mime).toBe("application/pdf");
  });
});

describe("URL construction", () => {
  // Mirrors the URL construction logic in channel.ts downloadMedia
  function buildMediaUrl(port: string, id: string): string {
    return `http://localhost:${port}/media/${id}`;
  }

  it("builds localhost URL for host access", () => {
    const url = buildMediaUrl("3101", "550e8400-e29b-41d4-a716-446655440000");
    expect(url).toBe("http://localhost:3101/media/550e8400-e29b-41d4-a716-446655440000");
  });
});
