// The front end: a Nuxt app rendered in the browser and generated to static files
// (`nuxt generate` → .output/public), which Workers Static Assets serves without running
// the Worker. The Worker itself (src/) only answers /api/* and /admin.
export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  modules: ["@nuxt/ui"],
  css: ["~/assets/css/main.css"],

  // The news is fetched in the browser from /api/public/news.json, as before, so there is
  // nothing to render on a server and the pages stay plain static files.
  ssr: false,

  // Inter is self-hosted from public/fonts; don't let @nuxt/fonts download a copy.
  ui: { fonts: false },
  fonts: { providers: { google: false, googleicons: false, bunny: false, fontshare: false, fontsource: false, adobe: false, npm: false } },

  // Bundle the few icons we use into the page, so nothing is fetched from the Iconify API.
  icon: {
    provider: "none",
    clientBundle: {
      scan: true,
      icons: ["lucide:sun", "lucide:moon", "lucide:arrow-left", "lucide:arrow-right", "lucide:arrow-up-right",
      // Picture placeholders, one per topic (app/utils/format.ts TOPIC_ICONS).
      "lucide:landmark", "lucide:trending-up", "lucide:users", "lucide:scale", "lucide:heart-pulse", "lucide:flask-conical",
      "lucide:cpu", "lucide:leaf", "lucide:palette", "lucide:trophy", "lucide:train-front", "lucide:cloud-sun", "lucide:newspaper",
    ],
    },
  },

  // Light/dark follows the system until the reader picks one. "theme" is the key the
  // previous front end used, so a reader's earlier choice carries over.
  colorMode: { preference: "system", fallback: "light", storageKey: "theme" },

  app: {
    head: {
      htmlAttrs: { lang: "en" },
      title: "Atlesque News",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        { name: "description", content: "Bruges, Belgium, Europe and the world. Hourly, deduplicated and without the clickbait." },
        { name: "color-scheme", content: "light dark" },
      ],
      link: [
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "preload", href: "/fonts/inter-latin-opsz-normal.woff2", as: "font", type: "font/woff2", crossorigin: "" },
        { rel: "preload", href: "/api/public/news.json", as: "fetch", crossorigin: "anonymous" },
      ],
      noscript: [{ innerHTML: '<p class="wrap">This page needs JavaScript to show the news.</p>', tagPosition: "bodyClose" }],
    },
  },

  // `pnpm dev:web` runs the Nuxt dev server; /api goes to `pnpm dev` (wrangler) on 8787.
  nitro: {
    devProxy: { "/api": { target: "http://localhost:8787/api", changeOrigin: true } },
    // Only the app shell is generated; don't follow links (such as the news.json preload).
    prerender: { crawlLinks: false, routes: ["/"] },
  },

  devtools: { enabled: false },
  telemetry: false,
});
