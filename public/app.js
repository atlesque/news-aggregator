// Front page. Renders /api/public/news.json; no framework, no build step.

const TOPIC_LABELS = {
  politics: "Politics", economy: "Economy", society: "Society", crime: "Crime & justice", health: "Health",
  science: "Science", technology: "Technology", environment: "Environment", culture: "Culture", sports: "Sports",
  mobility: "Mobility", weather: "Weather", other: "Other",
};
const LEAD_COUNT = 5;

let data = null;
let state = { region: "", topic: "" };

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

function storyEl(s, { lead = false, showRegion = true } = {}) {
  const primary = s.sources[0];
  const others = s.sources.slice(1);
  return h(
    "article",
    { class: `story priority-${s.priority}${lead ? " lead" : ""}`, id: `story-${s.id}` },
    lead && s.image
      ? h(
          "figure",
          {},
          h("img", {
            src: s.image,
            alt: "",
            referrerpolicy: "no-referrer",
            decoding: "async",
            // Drop broken images and thumbnails too small to fill the lead slot.
            onerror: (e) => e.target.parentElement.remove(),
            onload: (e) => e.target.naturalWidth < 400 && e.target.parentElement.remove(),
          }),
        )
      : null,
    h(
      "div",
      { class: "kicker" },
      s.breaking ? h("span", { class: "badge breaking-badge" }, "Breaking") : null,
      !s.breaking && s.priority === "high" ? h("span", { class: "badge high-badge" }, "Important") : null,
      h("span", {}, TOPIC_LABELS[s.topic] ?? s.topic),
      showRegion ? h("span", { class: "region" }, regionLabel(s.region)) : null,
    ),
    h("h3", {}, primary ? h("a", { href: primary.url, target: "_blank", rel: "noopener" }, s.headline) : s.headline),
    s.summary ? h("p", { class: "summary" }, s.summary) : null,
    h(
      "div",
      { class: "meta" },
      h("time", { datetime: s.updatedAt, title: new Date(s.updatedAt).toLocaleString("en-GB") }, ago(s.updatedAt)),
      " · ",
      ...s.sources.flatMap((src, i) => [i ? ", " : "", h("a", { href: src.url, target: "_blank", rel: "noopener" }, src.name)]),
      others.length >= 2 ? ` (${s.sources.length} reports)` : "",
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
  return h("div", { class: "topics", role: "group", "aria-label": "Filter by topic" }, chip("", "All topics"), present.sort().map((t) => chip(t, TOPIC_LABELS[t] ?? t)));
}

function render() {
  const main = document.getElementById("main");
  main.replaceChildren();
  document.querySelectorAll("#section-nav a").forEach((a) => {
    if (a.dataset.region === state.region) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  const regionStories = data.stories.filter((s) => !state.region || s.region === state.region);
  const chips = topicChips(regionStories);
  if (chips) main.append(chips);

  const stories = filtered();
  if (!stories.length) {
    main.append(h("p", { class: "empty" }, data.stories.length ? "No stories match this filter right now." : "No news yet. The first update is on its way."));
    return;
  }

  // Front block: the best stories overall (or in this section).
  const [lead, ...rest] = stories;
  const rail = rest.slice(0, LEAD_COUNT - 1);
  main.append(
    h(
      "section",
      { class: "front", "aria-label": "Top stories" },
      storyEl(lead, { lead: true, showRegion: !state.region }),
      rail.length ? h("div", { class: "rail" }, rail.map((s) => storyEl(s, { showRegion: !state.region }))) : null,
    ),
  );
  const shown = new Set([lead, ...rail].map((s) => s.id));
  const remaining = stories.filter((s) => !shown.has(s.id));

  if (state.region) {
    if (remaining.length) main.append(h("section", { class: "section" }, h("div", { class: "grid" }, remaining.map((s) => storyEl(s, { showRegion: false })))));
    return;
  }
  for (const region of data.site.regions) {
    const list = remaining.filter((s) => s.region === region.id);
    if (!list.length) continue;
    main.append(
      h(
        "section",
        { class: "section", "aria-labelledby": `h-${region.id}` },
        h("div", { class: "section-head" }, h("h2", { id: `h-${region.id}` }, region.label), h("a", { href: `#${region.id}` }, `All ${region.label} news →`)),
        h("div", { class: "grid" }, list.map((s) => storyEl(s, { showRegion: false }))),
      ),
    );
  }
}

function renderChrome() {
  document.title = data.site.title;
  document.querySelector("#site-title a").textContent = data.site.title;
  document.getElementById("tagline").textContent = data.site.tagline;
  document.getElementById("today").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  document.getElementById("updated").textContent = data.generatedAt
    ? `Updated ${clock(data.generatedAt)} · next update around ${clock(data.nextUpdateAt)}`
    : "";

  const nav = document.getElementById("section-nav");
  nav.replaceChildren(
    h("li", {}, h("a", { href: "#", "data-region": "" }, "Front page")),
    ...data.site.regions.map((r) => h("li", {}, h("a", { href: `#${r.id}`, "data-region": r.id }, r.label))),
  );

  const breaking = data.stories.filter((s) => s.breaking);
  const bar = document.getElementById("breaking");
  bar.hidden = !breaking.length;
  document.getElementById("breaking-list").replaceChildren(...breaking.map((s) => h("li", {}, h("a", { href: `#story-${s.id}`, onclick: () => { state = { region: "", topic: "" }; } }, s.headline))));
}

function readHash() {
  const id = location.hash.slice(1);
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
    document.getElementById("main").replaceChildren(h("p", { class: "empty" }, "The news couldn't be loaded. Try again in a moment."));
    console.error(err);
  }
}

window.addEventListener("hashchange", () => {
  if (!data) return;
  if (location.hash.startsWith("#story-")) return;
  readHash();
  render();
  window.scrollTo({ top: 0 });
});

// Pick up the next hourly edition when the tab comes back after it was published.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && data?.nextUpdateAt && Date.now() > Date.parse(data.nextUpdateAt)) load();
});

load();
