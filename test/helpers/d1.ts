// A tiny D1 and R2 stand-in for tests: D1 on Node's built-in SQLite with every migration
// applied, R2 as a Map. Covers only what src/store.ts uses.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

type Value = string | number | null | Uint8Array;

class Stmt {
  db: DatabaseSync;
  sql: string;
  params: Value[];
  constructor(db: DatabaseSync, sql: string, params: Value[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params: unknown[]) {
    return new Stmt(this.db, this.sql, params.map((p) => (p instanceof ArrayBuffer ? new Uint8Array(p) : (p as Value))));
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T) ?? null;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(r.changes) } };
  }
}

export function fakeD1(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const dir = fileURLToPath(import.meta.resolve("../../migrations/"));
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(`${dir}${f}`, "utf8"));
  return {
    raw: db,
    prepare: (sql: string) => new Stmt(db, sql),
    batch: async (stmts: Stmt[]) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database & { raw: DatabaseSync };
}

export function fakeR2(): R2Bucket & { objects: Map<string, { bytes: Uint8Array; type?: string }> } {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  return {
    objects,
    put: async (key: string, bytes: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
      objects.set(key, { bytes, type: opts?.httpMetadata?.contentType });
    },
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
    list: async ({ limit = 1000 }: { limit?: number } = {}) => ({
      objects: [...objects.keys()].sort().slice(0, limit).map((key) => ({ key })),
      truncated: false,
    }),
  } as unknown as R2Bucket & { objects: Map<string, { bytes: Uint8Array; type?: string }> };
}

/** A PNG header of the given size, padded to look like a real file. */
export function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(4000);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}
