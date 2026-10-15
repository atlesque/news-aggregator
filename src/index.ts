import { requireAdmin } from "./access.ts";
import { handleAdmin } from "./admin.ts";
import { keyedNews, publicNews } from "./api.ts";
import { errorResponse, HttpError } from "./http.ts";
import type { Format } from "./formats.ts";

export { RefreshWorkflow } from "./pipeline.ts";

const KEYED_ROUTES: Record<string, Format | null> = {
  "/api/v1/news": null,
  "/api/v1/news.json": "json",
  "/api/v1/news.rss": "rss",
  "/api/v1/news.txt": "text",
  "/api/v1/news.compact.json": "compact",
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/api/public/news.json" && (request.method === "GET" || request.method === "HEAD")) {
        return await publicNews(request, env, ctx);
      }
      if (path in KEYED_ROUTES) {
        if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Method not allowed");
        return await keyedNews(request, env, ctx, KEYED_ROUTES[path]);
      }
      if (path.startsWith("/api/admin/")) {
        const email = await requireAdmin(request, env);
        return await handleAdmin(request, env, path.slice("/api/admin".length), email);
      }
      if (path === "/admin" || path.startsWith("/admin/")) {
        await requireAdmin(request, env);
        if (path === "/admin") return Response.redirect(new URL("/admin/", url).toString(), 302);
        const res = await env.ASSETS.fetch(request);
        const out = new Response(res.body, res);
        out.headers.set("Cache-Control", "no-store");
        return out;
      }
      if (path.startsWith("/api/")) throw new HttpError(404, "Not found");
      return env.ASSETS.fetch(request);
    } catch (err) {
      return errorResponse(err);
    }
  },

  async scheduled(controller, env, ctx) {
    // One instance per hour: the id makes a duplicate cron delivery a no-op.
    const hour = new Date(controller.scheduledTime).toISOString().slice(0, 13).replace(/\D/g, "");
    ctx.waitUntil(
      env.REFRESH.create({ id: `cron-${hour}`, params: { trigger: "cron" } }).catch((err: unknown) => {
        if (!String(err).includes("already exists")) throw err;
      }),
    );
  },
} satisfies ExportedHandler<Env>;
