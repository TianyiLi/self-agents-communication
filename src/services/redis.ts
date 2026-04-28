import { createClient, type RedisClientType } from "redis";

export class RedisService {
  client!: RedisClientType;

  async connect(uri: string) {
    this.client = createClient({ url: uri });
    this.client.on("error", (err) => process.stderr.write(`Redis error: ${err}\n`));
    await this.client.connect();
  }

  async disconnect() {
    await this.client.quit();
  }

  // --- Streams ---

  async xadd(
    streamKey: string,
    fields: Record<string, string>,
    maxlen?: number
  ): Promise<string> {
    const args: Record<string, { strategy: "MAXLEN"; strategyModifier: "~"; threshold: number }> = {};
    if (maxlen) {
      args.TRIM = { strategy: "MAXLEN" as const, strategyModifier: "~" as const, threshold: maxlen };
    }
    return await this.client.xAdd(streamKey, "*", fields, args);
  }

  async xrange(
    streamKey: string,
    start: string,
    end: string,
    count: number
  ) {
    const raw = await this.client.xRange(streamKey, start, end, { COUNT: count });
    return raw.map((entry) => ({ id: entry.id, message: entry.message }));
  }

  async ensureConsumerGroup(streamKey: string, groupName: string) {
    try {
      await this.client.xGroupCreate(streamKey, groupName, "0", { MKSTREAM: true });
    } catch (e: any) {
      if (!e.message?.includes("BUSYGROUP")) throw e;
    }
  }

  async xreadgroup(
    groupName: string,
    consumerName: string,
    streamKeys: string[],
    count: number,
    block?: number,
    id: string = ">"
  ) {
    const streams = streamKeys.map((key) => ({ key, id }));
    const opts: Record<string, number> = { COUNT: count };
    if (block !== undefined) opts.BLOCK = block;

    const raw = await this.client.xReadGroup(groupName, consumerName, streams, opts);
    if (!raw) return [];

    return raw.map((entry) => ({
      streamKey: entry.name,
      messages: entry.messages.map((m) => ({ id: m.id, message: m.message })),
    }));
  }

  async xack(streamKey: string, groupName: string, ids: string[]) {
    if (ids.length === 0) return;
    await this.client.xAck(streamKey, groupName, ids);
  }

  // --- Hash ---

  async hset(key: string, fields: Record<string, string>) {
    await this.client.hSet(key, fields);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return (await this.client.hGetAll(key)) as Record<string, string>;
  }

  async hget(key: string, field: string): Promise<string | undefined> {
    return (await this.client.hGet(key, field)) ?? undefined;
  }

  // --- Set ---

  async sadd(key: string, ...members: string[]) {
    await this.client.sAdd(key, members);
  }

  async srem(key: string, ...members: string[]) {
    await this.client.sRem(key, members);
  }

  async smembers(key: string): Promise<string[]> {
    return await this.client.sMembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    return await this.client.sIsMember(key, member);
  }

  async scard(key: string): Promise<number> {
    return await this.client.sCard(key);
  }

  // --- Key ---

  async set(key: string, value: string, ttl?: number) {
    if (ttl) {
      await this.client.set(key, value, { EX: ttl });
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async del(...keys: string[]) {
    await this.client.del(keys);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }
}
