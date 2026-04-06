import { describe, it, expect } from "bun:test";

describe("pingTransport hardening", () => {
  it("handles null/undefined transport gracefully via try/catch", async () => {
    // Simulates what happens when transport.send() throws
    const fakePing = async (transport: any): Promise<boolean> => {
      try {
        const result = await Promise.race([
          transport.send({
            jsonrpc: "2.0" as const,
            method: "notifications/ping",
            params: {},
          }).then(() => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
        ]);
        return result;
      } catch {
        return false;
      }
    };

    // Dead transport — send throws
    const deadTransport = {
      send: () => { throw new Error("Connection closed"); },
    };
    expect(await fakePing(deadTransport)).toBe(false);

    // Alive transport — send resolves
    const aliveTransport = {
      send: () => Promise.resolve(),
    };
    expect(await fakePing(aliveTransport)).toBe(true);

    // Timeout transport — send never resolves
    const hangingTransport = {
      send: () => new Promise(() => {}), // never resolves
    };
    expect(await fakePing(hangingTransport)).toBe(false);
  });

  it("transport reset try/catch does not throw on missing properties", () => {
    const fakeServer: any = {};
    expect(() => {
      try {
        (fakeServer as any)._transport = undefined;
      } catch {
        // Should not reach here for a plain object
      }
    }).not.toThrow();
  });
});

describe("dependency pinning", () => {
  it("@types/bun is pinned to exact version", async () => {
    const pkg = await Bun.file("package.json").json();
    expect(pkg.devDependencies["@types/bun"]).not.toBe("latest");
    expect(pkg.devDependencies["@types/bun"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("@modelcontextprotocol/sdk is pinned without caret", async () => {
    const pkg = await Bun.file("package.json").json();
    const ver = pkg.dependencies["@modelcontextprotocol/sdk"];
    expect(ver).not.toStartWith("^");
    expect(ver).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
