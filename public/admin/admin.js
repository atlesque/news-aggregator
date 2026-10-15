// Admin dashboard. Talks to /api/admin/*, which Cloudflare Access protects.

const REGIONS = ["local", "national", "europe", "world"];
const TOPICS = ["politics", "economy", "society", "crime", "health", "science", "technology", "environment", "culture", "sports", "mobility", "weather", "other"];
let ov = null;
let stories = [];

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4000);
}

async function act(fn, ok) {
  try {
    await fn();
    if (ok) toast(ok);
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

const when = (ms) => (ms ? new Date(ms).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—");
const label = (r) => ov?.settings.regionLabels[r] ?? r;

// ---- Status --------------------------------------------------------------------------------

function statusPanel() {
  const last = ov.runs[0];
  const running = ov.runs.some((r) => r.status === "running" && Date.now() - r.started_at < 600000);
  return h(
    "section",
    { class: "panel", id: "status" },
    h(
      "h2",
      {},
      "Status",
      h(
        "span",
        { class: "row" },
        h("button", { onclick: () => act(() => api("/publish", { method: "POST" }), "Front page rebuilt") }, "Rebuild front page"),
        h("button", { class: "primary", disabled: running, onclick: () => act(() => api("/refresh", { method: "POST" }), "Refresh started. It takes a minute or two.") }, running ? "Refreshing…" : "Refresh now"),
      ),
    ),
    h(
      "div",
      { class: "stats" },
      h("div", { class: "stat" }, h("b", {}, ov.snapshot ? when(ov.snapshot.created_at) : "never"), "Front page built"),
      h("div", { class: "stat" }, h("b", {}, last ? last.status : "—"), "Last run"),
      h("div", { class: "stat" }, h("b", {}, ov.counts.stories), "Stories (7 days)"),
      h("div", { class: "stat" }, h("b", {}, ov.counts.pending), "Waiting for AI"),
      h("div", { class: "stat" }, h("b", {}, ov.counts.articles), "Articles stored"),
    ),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, ["Started", "Trigger", "Status", "Sources", "New articles", "New stories", "AI rewrites", "On page", "Error"].map((t) => h("th", {}, t)))),
        h(
          "tbody",
          {},
          ov.runs.map((r) =>
            h(
              "tr",
              {},
              h("td", {}, when(r.started_at)),
              h("td", {}, r.trigger),
              h("td", { class: r.status === "ok" ? "ok" : r.status === "failed" ? "err" : "warn" }, r.status),
              h("td", { class: "num" }, r.stats ? `${r.stats.sources - r.stats.failedSources}/${r.stats.sources}` : ""),
              h("td", { class: "num" }, r.stats?.newArticles ?? ""),
              h("td", { class: "num" }, r.stats?.newStories ?? ""),
              h("td", { class: "num" }, r.stats?.enriched ?? ""),
              h("td", { class: "num" }, r.stats?.published ?? ""),
              h("td", { class: "err" }, r.error ?? ""),
            ),
          ),
        ),
      ),
    ),
  );
}

// ---- Sources -------------------------------------------------------------------------------

function sourcesPanel() {
  return h(
    "section",
    { class: "panel", id: "sources" },
    h("h2", {}, "Sources", h("button", { class: "primary", onclick: () => sourceDialog(null) }, "Add source")),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, ["On", "Name", "Module", "Regions", "Last fetch", "Status", ""].map((t) => h("th", {}, t)))),
        h(
          "tbody",
          {},
          ov.sources.map((s) =>
            h(
              "tr",
              {},
              h(
                "td",
                {},
                h("input", {
                  type: "checkbox",
                  checked: !!s.enabled,
                  "aria-label": `Enable ${s.name}`,
                  onchange: (e) => act(() => api(`/sources/${s.id}`, { method: "PUT", body: { ...s, enabled: e.target.checked } }), e.target.checked ? "Enabled" : "Disabled"),
                }),
              ),
              h("td", {}, h("strong", {}, s.name)),
              h("td", {}, h("span", { class: "pill" }, s.module)),
              h("td", {}, s.regions.map(label).join(", ")),
              h("td", {}, when(s.last_fetch_at), s.last_new ? h("div", { class: "muted" }, `+${s.last_new} new`) : null),
              h("td", { class: s.last_status === "error" ? "err" : "" }, s.last_error ?? s.last_status ?? "—"),
              h(
                "td",
                { class: "row" },
                h("button", { onclick: () => sourceDialog(s) }, "Edit"),
                h(
                  "button",
                  { class: "danger", onclick: () => confirm(`Delete "${s.name}"? Stories it contributed to stay.`) && act(() => api(`/sources/${s.id}`, { method: "DELETE" }), "Source deleted") },
                  "Delete",
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function paramInput(p, value) {
  const v = value ?? p.default ?? "";
  if (p.type === "select") return h("select", { name: p.key }, p.options.map((o) => h("option", { value: o, selected: String(v) === o }, o)));
  return h("input", {
    name: p.key,
    type: p.type === "number" ? "number" : p.type === "url" ? "url" : "text",
    value: Array.isArray(v) ? v.join(", ") : String(v),
    required: p.required,
  });
}

function sourceDialog(src) {
  const dlg = h("dialog");
  const form = h("form", { class: "form", method: "dialog" });
  let moduleId = src?.module ?? ov.modules[0].id;
  const preview = h("div", { class: "full preview" });

  const collect = () => {
    const mod = ov.modules.find((m) => m.id === moduleId);
    const fd = new FormData(form);
    const config = {};
    for (const p of mod.params) {
      const raw = String(fd.get(p.key) ?? "").trim();
      if (raw === "") continue;
      config[p.key] = p.type === "number" ? Number(raw) : p.type === "list" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw;
    }
    return { module: moduleId, name: String(fd.get("name") ?? "").trim(), regions: fd.getAll("regions"), enabled: fd.get("enabled") === "on", config };
  };

  const draw = () => {
    const mod = ov.modules.find((m) => m.id === moduleId);
    form.replaceChildren(
      h("h3", { class: "full" }, src ? `Edit ${src.name}` : "Add source"),
      h(
        "label",
        {},
        "Module",
        h(
          "select",
          { name: "module", onchange: (e) => { moduleId = e.target.value; draw(); } },
          ov.modules.map((m) => h("option", { value: m.id, selected: m.id === moduleId }, m.name)),
        ),
        h("small", {}, mod.description),
      ),
      h("label", {}, "Name", h("input", { name: "name", value: src?.name ?? "", required: true })),
      h(
        "div",
        { class: "full" },
        h("label", {}, "Regions", h("small", {}, "Stories from this source can only be filed under these regions.")),
        h("div", { class: "checks" }, REGIONS.map((r) => h("label", {}, h("input", { type: "checkbox", name: "regions", value: r, checked: src ? src.regions.includes(r) : r === "world" }), label(r)))),
      ),
      mod.params.map((p) => h("label", {}, p.label + (p.required ? " *" : ""), paramInput(p, src?.module === mod.id ? src.config[p.key] : undefined), p.help ? h("small", {}, p.help) : null)),
      h("label", { class: "checks" }, h("label", {}, h("input", { type: "checkbox", name: "enabled", checked: src ? !!src.enabled : true }), "Enabled")),
      preview,
      h(
        "div",
        { class: "full row" },
        h("button", { type: "button", onclick: () => dlg.close() }, "Cancel"),
        h(
          "button",
          {
            type: "button",
            onclick: async () => {
              preview.replaceChildren(h("p", { class: "muted" }, "Fetching…"));
              try {
                const r = await api("/sources/test", { method: "POST", body: collect() });
                preview.replaceChildren(
                  h("p", {}, `${r.count} items. First ${r.items.length}:`),
                  h("ol", {}, r.items.map((i) => h("li", {}, h("a", { href: i.url, target: "_blank", rel: "noopener" }, i.title), i.hint ? h("span", { class: "muted" }, ` · ${i.hint}`) : null))),
                );
              } catch (err) {
                preview.replaceChildren(h("p", { class: "err" }, err.message));
              }
            },
          },
          "Test fetch",
        ),
        h(
          "button",
          {
            type: "button",
            class: "primary",
            onclick: async () => {
              const body = collect();
              try {
                await api(src ? `/sources/${src.id}` : "/sources", { method: src ? "PUT" : "POST", body });
                dlg.close();
                toast(src ? "Source saved" : "Source added. It's fetched on the next refresh.");
                await refresh();
              } catch (err) {
                toast(err.message);
              }
            },
          },
          "Save",
        ),
      ),
    );
  };
  draw();
  dlg.append(form);
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---- API keys ------------------------------------------------------------------------------

function keysPanel() {
  const created = h("div");
  const nameInput = h("input", { placeholder: "e.g. Kitchen e-ink display", "aria-label": "Key name" });
  const base = location.origin;
  return h(
    "section",
    { class: "panel", id: "keys" },
    h("h2", {}, "API keys"),
    h(
      "div",
      { class: "row" },
      h("div", { style: "flex:1;min-width:200px" }, nameInput),
      h(
        "button",
        {
          class: "primary",
          onclick: async () => {
            try {
              const r = await api("/keys", { method: "POST", body: { name: nameInput.value } });
              nameInput.value = "";
              const compact = `${base}/api/v1/news.compact.json?limit=8&ascii=1&maxSummary=160`;
              created.replaceChildren(
                h(
                  "div",
                  { class: "secret" },
                  h("p", {}, h("strong", {}, `Key for “${r.name}”. Copy it now: it won't be shown again.`)),
                  h("pre", {}, r.key),
                  h("button", { onclick: () => navigator.clipboard.writeText(r.key).then(() => toast("Copied")) }, "Copy key"),
                  h("p", {}, "Examples:"),
                  h("pre", {}, `curl -H "Authorization: Bearer ${r.key}" "${compact}"\n\n# RSS reader (key in the URL):\n${base}/api/v1/news.rss?key=${r.key}`),
                ),
              );
              const data = await api("/overview");
              ov = data;
              drawKeysTable();
            } catch (err) {
              toast(err.message);
            }
          },
        },
        "Create key",
      ),
    ),
    created,
    h("div", { class: "table-wrap", id: "keys-table" }),
    h(
      "details",
      {},
      h("summary", {}, "API reference"),
      h(
        "pre",
        {},
        `GET /api/v1/news            JSON (default)
GET /api/v1/news.compact.json  short keys, no URLs, for microcontrollers
GET /api/v1/news.rss        RSS 2.0
GET /api/v1/news.txt        plain text

Auth: "Authorization: Bearer nk_…", "X-API-Key: nk_…" or ?key=nk_…
Query: region=local,national,europe,world  topic=politics,…  minPriority=low|medium|high
       breaking=1  limit=1..100 (20)  summary=0|1  maxSummary=40..2000 (400)  ascii=1  format=json|compact|rss|text
Rate limit: 30 requests/minute per key. The data changes once an hour; responses carry ETags.`,
      ),
    ),
  );
}

function drawKeysTable() {
  const wrap = document.getElementById("keys-table");
  if (!wrap) return;
  wrap.replaceChildren(
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, ["Name", "Key", "Created", "Last used", "", ""].map((t) => h("th", {}, t)))),
      h(
        "tbody",
        {},
        ov.keys.length ? null : h("tr", {}, h("td", { colspan: 6, class: "muted" }, "No keys yet.")),
        ov.keys.map((k) =>
          h(
            "tr",
            {},
            h("td", {}, k.name),
            h("td", {}, h("code", {}, `${k.prefix}…`)),
            h("td", {}, when(k.created_at), h("div", { class: "muted" }, k.created_by ?? "")),
            h("td", {}, when(k.last_used_at)),
            h("td", { class: k.revoked_at ? "err" : "ok" }, k.revoked_at ? `revoked ${when(k.revoked_at)}` : "active"),
            h(
              "td",
              {},
              k.revoked_at ? null : h("button", { class: "danger", onclick: () => confirm(`Revoke "${k.name}"? Devices using it stop working.`) && act(() => api(`/keys/${k.id}`, { method: "DELETE" }), "Key revoked") }, "Revoke"),
            ),
          ),
        ),
      ),
    ),
  );
}

// ---- Stories -------------------------------------------------------------------------------

function storiesPanel() {
  const body = h("tbody");
  const patch = (s, change) =>
    act(async () => {
      await api(`/stories/${s.id}`, { method: "PATCH", body: change });
      await api("/publish", { method: "POST" });
    }, "Saved and front page rebuilt");

  const draw = () =>
    body.replaceChildren(
      ...stories.map((s) =>
        h(
          "tr",
          { class: `story-row${s.hidden ? " hidden" : ""}` },
          h("td", {}, when(s.last_published_at)),
          h("td", {}, s.headline ? h("strong", {}, s.headline) : h("em", { class: "muted" }, "waiting for AI"), s.summary ? h("div", { class: "muted" }, s.summary) : null, s.newsworthy ? null : h("span", { class: "pill" }, "not newsworthy")),
          h("td", {}, s.region ? label(s.region) : "", h("div", { class: "muted" }, s.topic ?? "")),
          h("td", { class: "num" }, s.source_count),
          h(
            "td",
            {},
            h(
              "select",
              { "aria-label": "Priority", onchange: (e) => patch(s, { priority: Number(e.target.value) }) },
              [3, 2, 1].map((p) => h("option", { value: p, selected: s.priority === p }, { 3: "high", 2: "medium", 1: "low" }[p])),
            ),
          ),
          h(
            "td",
            { class: "row" },
            h("button", { onclick: () => patch(s, { breaking: !s.breaking }) }, s.breaking ? "Unmark breaking" : "Breaking"),
            h("button", { onclick: () => patch(s, { pinned: !s.pinned }) }, s.pinned ? "Unpin" : "Pin"),
            h("button", { class: s.hidden ? "" : "danger", onclick: () => patch(s, { hidden: !s.hidden }) }, s.hidden ? "Show" : "Hide"),
          ),
        ),
      ),
    );
  draw();
  return h(
    "section",
    { class: "panel", id: "stories" },
    h("h2", {}, "Stories", h("span", { class: "muted" }, "Newest 300. Changes rebuild the front page.")),
    h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Latest", "Story", "Region", "Sources", "Priority", ""].map((t) => h("th", {}, t)))), body)),
  );
}

// ---- Settings ------------------------------------------------------------------------------

function settingsPanel() {
  const s = ov.settings;
  const form = h("form", { class: "form" });
  const field = (key, text, input, help) => h("label", {}, text, input, help ? h("small", {}, help) : null);
  form.append(
    field("siteTitle", "Site title", h("input", { name: "siteTitle", value: s.siteTitle })),
    field("tagline", "Tagline", h("input", { name: "tagline", value: s.tagline })),
    field("language", "Summary language", h("input", { name: "language", value: s.language }), "\"source\" keeps each story in its original language. An ISO code (en, nl, fr…) translates everything."),
    field("model", "Text model", h("input", { name: "model", value: s.model }), `Workers AI model id. Default ${ov.defaults.model}.`),
    field("embeddingModel", "Embedding model", h("input", { name: "embeddingModel", value: s.embeddingModel }), "Must be multilingual to merge Dutch and English reports."),
    field("similarity", "Duplicate threshold", h("input", { name: "similarity", type: "number", step: "0.01", min: "0.5", max: "0.99", value: s.similarity }), "Higher = stricter merging. 0.75 is a good start."),
    field("windowHours", "Keep stories for (hours)", h("input", { name: "windowHours", type: "number", min: "6", max: "168", value: s.windowHours })),
    field("maxEnrichPerRun", "Max AI rewrites per run", h("input", { name: "maxEnrichPerRun", type: "number", min: "0", max: "200", value: s.maxEnrichPerRun }), "Bounds Workers AI usage (free tier: 10k neurons/day)."),
    h(
      "div",
      { class: "full" },
      h("label", {}, "Regions: label and number of stories"),
      h(
        "div",
        { class: "form" },
        REGIONS.map((r) =>
          h(
            "div",
            { class: "row" },
            h("input", { name: `label_${r}`, value: s.regionLabels[r], "aria-label": `${r} label`, style: "flex:2" }),
            h("input", { name: `quota_${r}`, type: "number", min: "0", max: "50", value: s.quotas[r], "aria-label": `${r} quota`, style: "flex:1" }),
          ),
        ),
      ),
    ),
    h(
      "div",
      { class: "full" },
      h("label", {}, "Leave out topics"),
      h("div", { class: "checks" }, TOPICS.map((t) => h("label", {}, h("input", { type: "checkbox", name: "excludedTopics", value: t, checked: s.excludedTopics.includes(t) }), t))),
    ),
    h(
      "div",
      { class: "full row" },
      h(
        "button",
        {
          type: "button",
          class: "primary",
          onclick: () => {
            const fd = new FormData(form);
            const body = {
              siteTitle: fd.get("siteTitle"),
              tagline: fd.get("tagline"),
              language: fd.get("language"),
              model: fd.get("model"),
              embeddingModel: fd.get("embeddingModel"),
              similarity: Number(fd.get("similarity")),
              windowHours: Number(fd.get("windowHours")),
              maxEnrichPerRun: Number(fd.get("maxEnrichPerRun")),
              regionLabels: Object.fromEntries(REGIONS.map((r) => [r, fd.get(`label_${r}`)])),
              quotas: Object.fromEntries(REGIONS.map((r) => [r, Number(fd.get(`quota_${r}`))])),
              excludedTopics: fd.getAll("excludedTopics"),
            };
            act(async () => {
              await api("/settings", { method: "PUT", body });
              await api("/publish", { method: "POST" });
            }, "Settings saved and front page rebuilt");
          },
        },
        "Save settings",
      ),
      h("button", { type: "button", onclick: () => confirm("Reset all settings to defaults?") && act(() => api("/settings/reset", { method: "POST" }), "Settings reset") }, "Reset to defaults"),
    ),
  );
  return h("section", { class: "panel", id: "settings" }, h("h2", {}, "Settings"), form);
}

// ---- Page ----------------------------------------------------------------------------------

async function refresh() {
  [ov, { stories }] = await Promise.all([api("/overview"), api("/stories")]);
  document.getElementById("who").textContent = ov.email;
  const app = document.getElementById("app");
  const y = window.scrollY;
  app.replaceChildren(statusPanel(), sourcesPanel(), keysPanel(), storiesPanel(), settingsPanel());
  drawKeysTable();
  window.scrollTo({ top: y });
}

refresh().catch((err) => {
  document.getElementById("app").replaceChildren(h("p", { class: "err" }, `Couldn't load the admin: ${err.message}`));
});
