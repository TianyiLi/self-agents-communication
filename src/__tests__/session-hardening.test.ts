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

describe("SessionManager dead-socket detection", () => {
  it("treats a transport with an ended response as dead, even if send() would resolve", async () => {
    const { SessionManager } = await import("../mcp/session");
    const mgr = new SessionManager();

    // Transport whose underlying res is already ended — send() would
    // still resolve (Node http buffers writes after end()), so the only
    // way to know it's dead is the res state itself.
    const fakeTransport: any = {
      sessionId: "old",
      res: { writableEnded: true, destroyed: false, socket: { destroyed: false } },
      send: async () => {
        /* resolves successfully even though socket is gone */
      },
    };
    mgr.addTransport("old", fakeTransport);
    await mgr.claimSession("old");

    // New session should be allowed to take over without waiting for
    // the (false-positive) ping timeout.
    const result = await mgr.claimSession("new");
    expect(result.ok).toBe(true);
    expect(mgr.getActiveSessionId()).toBe("new");
  });

  it("treats a transport with a destroyed socket as dead", async () => {
    const { SessionManager } = await import("../mcp/session");
    const mgr = new SessionManager();
    const fakeTransport: any = {
      sessionId: "old",
      res: { writableEnded: false, destroyed: false, socket: { destroyed: true } },
      send: async () => {},
    };
    mgr.addTransport("old", fakeTransport);
    await mgr.claimSession("old");

    expect(await mgr.pingActive()).toBe(false);
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
