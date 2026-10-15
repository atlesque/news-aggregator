// Admin API under /api/admin/*. Every route requires Cloudflare Access (checked in index.ts).

import { forgetSnapshot, generateKey } from "./api.ts";
import { HttpError, json, readJson } from "./http.ts";
import { publish } from "./pipeline.ts";
import { DEFAULT_SETTINGS, loadSettings, REGIONS, saveSettings, validateSettings, type Region } from "./settings.ts";
import { describeModules, getModule } from "./sources/index.ts";
import { sha256Hex, truncate } from "./text.ts";

export async function handleAdmin(request: Request, env: Env, path: string, email: string): Promise<Response> {
  const method = request.method;
  if (method !== "GET") {
    // Refuse cross-site writes. The Access cookie is SameSite=Lax, and this blocks the rest.
    const origin = request.headers.get("Origin");
    if (!origin || origin !== new URL(request.url).origin) throw new HttpError(403, "Cross-origin request refused");
  }
  const db = env.DB;
  let m: RegExpMatchArray | null;

  if (path === "/overview" && method === "GET") return json(await overview(env, email));

  if (path === "/settings" && method === "PUT") {
    let patch;
    try {
      patch = validateSettings(await readJson(request));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, (err as Error).message);
    }
    await saveSettings(db, patch);
    return json({ settings: await loadSettings(db) });
  }
  if (path === "/settings/reset" && method === "POST") {
    await db.prepare("DELETE FROM settings").run();
    return json({ settings: DEFAULT_SETTINGS });
  }

  if (path === "/sources" && method === "POST") {
    const s = parseSource(await readJson(request));
    const now = Date.now();
    const row = await db
      .prepare("INSERT INTO sources (module, name, config, regions, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(s.module, s.name, JSON.stringify(s.config), JSON.stringify(s.regions), s.enabled ? 1 : 0, now, now)
      .first<{ id: number }>();
    return json({ id: row!.id }, { status: 201 });
  }
  if (path === "/sources/test" && method === "POST") {
    const s = parseSource({ name: "test", regions: ["world"], ...(await readJson(request)) });
    const result = await getModule(s.module)!.fetch(s.config, { etag: null, lastModified: null });
    return json({ count: result.items.length, items: result.items.slice(0, 15) });
  }
  if ((m = path.match(/^\/sources\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === "PUT") {
      const s = parseSource(await readJson(request));
      // A config change invalidates the cached ETag; refetch everything next run.
      const res = await db
        .prepare("UPDATE sources SET module = ?, name = ?, config = ?, regions = ?, enabled = ?, updated_at = ?, etag = NULL, last_modified = NULL WHERE id = ?")
        .bind(s.module, s.name, JSON.stringify(s.config), JSON.stringify(s.regions), s.enabled ? 1 : 0, Date.now(), id)
        .run();
      if (!res.meta.changes) throw new HttpError(404, "Source not found");
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await db.batch([
        db.prepare("DELETE FROM articles WHERE source_id = ? AND story_id IS NULL").bind(id),
        db.prepare("DELETE FROM sources WHERE id = ?").bind(id),
      ]);
      return json({ ok: true });
    }
  }

  if (path === "/keys" && method === "POST") {
    const body = await readJson(request);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name) throw new HttpError(400, "Give the key a name, e.g. the device that uses it");
    const key = generateKey();
    await db
      .prepare("INSERT INTO api_keys (name, prefix, hash, created_at, created_by) VALUES (?, ?, ?, ?, ?)")
      .bind(name, key.slice(0, 7), await sha256Hex(key), Date.now(), email)
      .run();
    return json({ key, name }, { status: 201 });
  }
  if ((m = path.match(/^\/keys\/(\d+)$/)) && method === "DELETE") {
    await db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Date.now(), Number(m[1])).run();
    return json({ ok: true });
  }

  if (path === "/refresh" && method === "POST") {
    const running = await db
      .prepare("SELECT id FROM runs WHERE status = 'running' AND started_at > ?")
      .bind(Date.now() - 10 * 60_000)
      .first();
    if (running) throw new HttpError(409, "A refresh is already running");
    const instance = await env.REFRESH.create({ params: { trigger: "admin" } });
    return json({ id: instance.id });
  }
  if (path === "/publish" && method === "POST") {
    const count = await publish(db, Date.now());
    forgetSnapshot();
    return json({ count });
  }

  if (path === "/stories" && method === "GET") {
    const { results } = await db
      .prepare(
        `SELECT id, headline, summary, region, topic, priority, breaking, newsworthy, hidden, pinned, source_count, article_count,
                last_published_at, enriched_at
         FROM stories ORDER BY last_published_at DESC LIMIT 300`,
      )
      .all();
    return json({ stories: results });
  }
  if ((m = path.match(/^\/stories\/(\d+)$/)) && method === "PATCH") {
    const body = await readJson(request);
    const sets: string[] = [];
    const vals: (number | string)[] = [];
    for (const k of ["hidden", "pinned", "breaking"] as const) {
      if (k in body) {
        sets.push(`${k} = ?`);
        vals.push(body[k] ? 1 : 0);
      }
    }
    if ("priority" in body) {
      const p = Number(body.priority);
      if (![1, 2, 3].includes(p)) throw new HttpError(400, "priority must be 1, 2 or 3");
      sets.push("priority = ?");
      vals.push(p);
    }
    if ("region" in body) {
      if (!REGIONS.includes(body.region as Region)) throw new HttpError(400, "Unknown region");
      sets.push("region = ?");
      vals.push(body.region as string);
    }
    if (!sets.length) throw new HttpError(400, "Nothing to change");
    await db.prepare(`UPDATE stories SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, Number(m[1])).run();
    return json({ ok: true });
  }

  throw new HttpError(404, "Not found");
}

function parseSource(body: Record<string, unknown>) {
  const module = typeof body.module === "string" ? body.module : "";
  const mod = getModule(module);
  if (!mod) throw new HttpError(400, "Unknown source module");
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) throw new HttpError(400, "Name is required");
  const regions = Array.isArray(body.regions) ? body.regions.filter((r): r is Region => REGIONS.includes(r as Region)) : [];
  if (!regions.length) throw new HttpError(400, "Pick at least one region");
  const config = body.config && typeof body.config === "object" && !Array.isArray(body.config) ? (body.config as Record<string, unknown>) : {};
  for (const p of mod.params) {
    if (p.required && (config[p.key] === undefined || config[p.key] === "")) throw new HttpError(400, `${p.label} is required`);
  }
  return { module, name, config, regions, enabled: body.enabled !== false };
}

async function overview(env: Env, email: string) {
  const db = env.DB;
  const [settings, sources, keys, runs, snapshot, counts] = await Promise.all([
    loadSettings(db),
    db.prepare("SELECT id, module, name, config, regions, enabled, last_fetch_at, last_status, last_error, last_new FROM sources ORDER BY id").all(),
    db.prepare("SELECT id, name, prefix, created_at, created_by, last_used_at, revoked_at FROM api_keys ORDER BY revoked_at IS NOT NULL, id DESC").all(),
    db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 15").all(),
    db.prepare("SELECT id, created_at, length(json) AS bytes FROM snapshots ORDER BY id DESC LIMIT 1").first(),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM articles) AS articles,
                (SELECT COUNT(*) FROM stories) AS stories,
                (SELECT COUNT(*) FROM stories WHERE headline IS NULL) AS pending`,
      )
      .first(),
  ]);
  return {
    email,
    settings,
    defaults: DEFAULT_SETTINGS,
    modules: describeModules(),
    sources: sources.results.map((s) => ({
      ...s,
      config: JSON.parse(s.config as string),
      regions: JSON.parse(s.regions as string),
      last_error: s.last_error ? truncate(String(s.last_error), 300) : null,
    })),
    keys: keys.results,
    runs: runs.results.map((r) => ({ ...r, stats: r.stats ? JSON.parse(r.stats as string) : null })),
    snapshot,
    counts,
  };
}
