// Front page and story pages. Renders /api/public/news.json; no framework, no build step.

const TOPIC_LABELS = {
  politics: "Politics", economy: "Economy", society: "Society", crime: "Crime & justice", health: "Health",
  science: "Science", technology: "Technology", environment: "Environment", culture: "Culture", sports: "Sports",
  mobility: "Mobility", weather: "Weather", other: "Other",
};
// The lead story plus this many more make up the top block.
const TOP_COUNT = 4;
// Line icons for the phone tab bar, keyed by region id.
const ICONS = {
  "": '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  local: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  national: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  europe: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v.01M15.9 8.1v.01M17.5 12v.01M15.9 15.9v.01M12 17.5v.01M8.1 15.9v.01M6.5 12v.01M8.1 8.1v.01" stroke-width="2.6"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};

let data = null;
let state = { region: "", topic: "", story: null };
// Where each list view was scrolled to, so "Back" from a story returns to the same spot.
const listScroll = new Map();
let currentHash = location.hash;

function icon(id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[id] ?? ICONS.world;
  return svg;
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function ago(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function regionLabel(id) {
  return data.site.regions.find((r) => r.id === id)?.label ?? id;
}

// A decorative picture (the headline beside it says what it shows). Hotlink-blocked or broken
// images remove themselves, so the layout never shows an empty box.
function thumb(src, eager = false) {
  if (!src) return null;
  const img = h("img", {
    src,
    alt: "",
    loading: eager ? "eager" : "lazy",
    fetchpriority: eager ? "high" : null,
    decoding: "async",
    referrerpolicy: "no-referrer",
  });
  const fig = h("figure", { class: "thumb" }, img);
  img.addEventListener("error", () => fig.remove(), { once: true });
  return fig;
}

// A story in a list: headline only. It opens the story's own page with the summary and sources.
function storyEl(s, { lead = false, showRegion = true, image = true } = {}) {
  const primary = s.sources[0];
  return h(
    "article",
    { class: `story priority-${s.priority}${lead ? " lead" : ""}`, "data-story": s.id },
    image ? thumb(s.image, lead) : null,
    h(
      "div",
      { class: "body" },
      kicker(s, showRegion),
      h("h3", { lang: s.lang || null }, h("a", { href: `#story-${s.id}` }, s.headline)),
      h(
        "div",
        { class: "meta" },
        h("time", { datetime: s.updatedAt, title: new Date(s.updatedAt).toLocaleString("en-GB") }, ago(s.updatedAt)),
        primary ? h("span", { class: "dot", "aria-hidden": "true" }) : null,
        primary ? h("span", {}, primary.name) : null,
        s.sources.length > 1 ? h("span", { class: "count" }, `+${s.sources.length - 1}`) : null,
      ),
    ),
  );
}

function kicker(s, showRegion = true) {
  return h(
    "div",
    { class: "kicker" },
    s.breaking ? h("span", { class: "badge breaking-badge" }, "Breaking") : null,
    !s.breaking && s.priority === "high" ? h("span", { class: "badge high-badge" }, "Important") : null,
    h("span", {}, TOPIC_LABELS[s.topic] ?? s.topic),
    showRegion ? h("span", { class: "region" }, regionLabel(s.region)) : null,
  );
}

// A story's own page: the AI summary, a clear way out to the original report, and the other reports.
function renderStory(id) {
  const content = document.getElementById("content");
  const s = data.stories.find((x) => String(x.id) === id);
  document.querySelectorAll("#section-nav a").forEach((a) => a.removeAttribute("aria-current"));
  document.getElementById("breaking").hidden = true;
  document.getElementById("page-title").hidden = true;
  document.getElementById("status").textContent = "";

  const backHash = listScroll.has(state.backTo) ? state.backTo : "";
  const backLabel = backHash && backHash !== "#" ? regionLabel(backHash.slice(1)) : "Home";
  const back = h(
    "a",
    {
      class: "back",
      href: backHash || "#",
      // Use the browser's own back step when we came from a list, so its scroll position and history stay intact.
      onclick: (e) => {
        if (backHash) {
          e.preventDefault();
          history.back();
        }
      },
    },
    h("span", { "aria-hidden": "true" }, "←"),
    ` Back to ${backLabel}`,
  );

  if (!s) {
    document.title = data.site.title;
    content.replaceChildren(
      h("div", { class: "detail" }, back, h("h1", {}, "Story not found"), h("p", { class: "muted" }, "This story is no longer on the front page. News older than a day and a half drops off.")),
    );
    return;
  }

  document.title = `${s.headline} · ${data.site.title}`;
  const [primary, ...others] = s.sources;
  const ext = (src, ...children) =>
    h("a", { href: src.url, target: "_blank", rel: "noopener", "aria-describedby": "new-tab-hint" }, ...children);
  content.replaceChildren(
    h(
      "article",
      { class: "detail", "aria-labelledby": "story-title" },
      back,
      kicker(s),
      h("h1", { id: "story-title", lang: s.lang || null }, s.headline),
      h(
        "p",
        { class: "meta" },
        h("time", { datetime: s.updatedAt, title: new Date(s.updatedAt).toLocaleString("en-GB") }, `Updated ${ago(s.updatedAt)}`),
        s.sources.length > 1 ? h("span", { class: "dot", "aria-hidden": "true" }) : null,
        s.sources.length > 1 ? h("span", {}, `${s.sources.length} reports merged`) : null,
      ),
      thumb(s.image, true),
      s.summary ? h("p", { class: "summary", lang: s.lang || null }, s.summary) : null,
      primary
        ? h("p", { class: "read-on" }, ext(primary, `Read the full story at ${primary.name}`, h("span", { "aria-hidden": "true" }, " ↗")))
        : null,
      others.length
        ? h(
            "section",
            { class: "also", "aria-labelledby": "h-also" },
            h("h2", { id: "h-also" }, "Also reported by"),
            h("ul", {}, others.map((src) => h("li", {}, ext(src, src.name, h("span", { "aria-hidden": "true" }, " ↗"))))),
          )
        : null,
      h("p", { class: "ai-note" }, "This summary was written by AI from the linked reports and can contain mistakes."),
    ),
  );
}

function filtered() {
  return data.stories.filter((s) => (!state.region || s.region === state.region) && (!state.topic || s.topic === state.topic));
}

function topicChips(stories) {
  const present = [...new Set(stories.map((s) => s.topic))];
  if (present.length < 2 && !state.topic) return null;
  const chip = (topic, label) =>
    h(
      "button",
      {
        class: "chip",
        type: "button",
        "aria-pressed": String(state.topic === topic),
        onclick: () => {
          state.topic = state.topic === topic ? "" : topic;
          render();
        },
      },
      label,
    );
  return h("div", { class: "topics", role: "group", "aria-label": "Filter by topic" }, chip("", "All"), present.sort().map((t) => chip(t, TOPIC_LABELS[t] ?? t)));
}

function render() {
  if (state.story) return renderStory(state.story);
  document.getElementById("page-title").hidden = false;
  const content = document.getElementById("content");
  content.replaceChildren();
  document.querySelectorAll("#section-nav a").forEach((a) => {
    if (a.dataset.region === state.region) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const regionName = state.region ? regionLabel(state.region) : "";
  document.getElementById("page-title").textContent = regionName || "Latest news";
  document.title = regionName ? `${regionName} · ${data.site.title}` : data.site.title;

  const regionStories = data.stories.filter((s) => !state.region || s.region === state.region);
  const chips = topicChips(regionStories);
  if (chips) content.append(chips);

  const stories = filtered();
  const topicName = state.topic ? (TOPIC_LABELS[state.topic] ?? state.topic) : "";
  document.getElementById("status").textContent = `${stories.length} ${stories.length === 1 ? "story" : "stories"}${regionName ? ` in ${regionName}` : ""}${topicName ? ` about ${topicName}` : ""}`;
  renderBreaking(stories[0]?.id);
  if (!stories.length) {
    content.append(h("p", { class: "empty" }, data.stories.length ? "No stories match this filter right now." : "No news yet. The first update is on its way."));
    return;
  }

  // Top block: the lead story with its picture, and the next best stories beside it.
  const showRegion = !state.region;
  const [lead, ...rest] = stories;
  const top = rest.slice(0, TOP_COUNT);
  content.append(
    h(
      "section",
      { class: "top", "aria-labelledby": "h-top" },
      h("h2", { id: "h-top", class: "sr-only" }, "Top stories"),
      storyEl(lead, { lead: true, showRegion }),
      top.length ? h("ul", { class: "side", role: "list" }, top.map((s) => h("li", {}, storyEl(s, { showRegion })))) : null,
    ),
  );
  const shown = new Set([lead, ...top].map((s) => s.id));
  const remaining = stories.filter((s) => !shown.has(s.id));

  if (state.region) {
    if (remaining.length)
      content.append(
        h(
          "section",
          { class: "section", "aria-labelledby": "h-more" },
          h("div", { class: "section-head" }, h("h2", { id: "h-more" }, "More stories")),
          h("div", { class: "flow" }, remaining.map((s) => storyEl(s, { showRegion: false }))),
        ),
      );
    return;
  }
  for (const region of data.site.regions) {
    const list = remaining.filter((s) => s.region === region.id);
    if (!list.length) continue;
    content.append(
      h(
        "section",
        { class: "section", "aria-labelledby": `h-${region.id}` },
        h(
          "div",
          { class: "section-head" },
          h("h2", { id: `h-${region.id}` }, region.label),
          h("a", { href: `#${region.id}` }, `All ${region.label} news`, h("span", { "aria-hidden": "true" }, "→")),
        ),
        h("div", { class: "flow" }, list.map((s) => storyEl(s, { showRegion: false }))),
      ),
    );
  }
}

function renderChrome() {
  document.getElementById("site-title").textContent = data.site.title;
  document.querySelector(".brand").setAttribute("aria-label", `${data.site.title}, home`);
  document.getElementById("updated").textContent = data.generatedAt ? `Updated ${clock(data.generatedAt)}.` : "";

  const navItem = (id, label) => h("li", {}, h("a", { href: `#${id}`, "data-region": id }, icon(id), h("span", {}, label)));
  document.getElementById("section-nav").replaceChildren(navItem("", "Home"), ...data.site.regions.map((r) => navItem(r.id, r.label)));
}

// Breaking headlines, minus the one already shown as the lead right below.
function renderBreaking(leadId) {
  const breaking = data.stories.filter((s) => s.breaking && s.id !== leadId);
  document.getElementById("breaking").hidden = !breaking.length;
  document.getElementById("breaking-list").replaceChildren(
    ...breaking.map((s) =>
      h(
        "li",
        { lang: s.lang || null },
        h(
          "a",
          {
            href: `#story-${s.id}`,
          },
          s.headline,
        ),
      ),
    ),
  );
}

function readHash() {
  const id = location.hash.slice(1);
  state.story = id.startsWith("story-") ? id.slice(6) : null;
  if (state.story) return;
  state.region = data?.site.regions.some((r) => r.id === id) ? id : "";
  state.topic = "";
}

async function load() {
  try {
    const res = await fetch("/api/public/news.json", { credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    if (!data.site) {
      data = { ...data, site: { title: document.title, tagline: "", regions: [] }, stories: [] };
    }
    readHash();
    renderChrome();
    render();
  } catch (err) {
    document.getElementById("content").replaceChildren(h("p", { class: "empty" }, "The news couldn't be loaded. Try again in a moment."));
    console.error(err);
  }
}

const isStoryHash = (hash) => hash.startsWith("#story-");

window.addEventListener("hashchange", () => {
  if (!data) return;
  const from = currentHash || "#";
  const to = location.hash || "#";
  currentHash = to;
  const leavingList = !isStoryHash(from) && isStoryHash(to);
  const returningToList = isStoryHash(from) && !isStoryHash(to);
  if (leavingList) {
    listScroll.set(from, window.scrollY);
    state.backTo = from;
  }
  const keepFilter = returningToList && listScroll.has(to);
  const topic = state.topic;
  readHash();
  if (keepFilter) state.topic = topic;
  render();

  if (returningToList && listScroll.has(to)) {
    // Back from a story: same scroll position, and focus on the story the reader opened.
    window.scrollTo({ top: listScroll.get(to) });
    const link = document.querySelector(`[data-story="${from.slice(7)}"] h3 a`);
    (link ?? document.getElementById("main")).focus({ preventScroll: true });
    return;
  }
  window.scrollTo({ top: 0 });
  // Move keyboard and screen reader focus to the new view, as a page load would.
  document.getElementById("main").focus({ preventScroll: true });
});

// Light/dark: follows the system until the reader picks one; the choice is remembered.
const root = document.documentElement;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => root.dataset.theme || (darkQuery.matches ? "dark" : "light");
function syncThemeUi() {
  const theme = currentTheme();
  const toggle = document.getElementById("theme-toggle");
  toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  toggle.title = toggle.getAttribute("aria-label");
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", bg));
}
document.getElementById("theme-toggle").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {}
  syncThemeUi();
});
darkQuery.addEventListener("change", syncThemeUi);
syncThemeUi();

// Pick up the next hourly edition when the tab comes back after it was published.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && data?.nextUpdateAt && Date.now() > Date.parse(data.nextUpdateAt)) load();
});

load();
