// After each page change, move keyboard and screen reader focus to the new view as a page load
// would, or back onto the story the reader just closed.
export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter();

  let closedStory: string | null = null;
  let navigated = false;
  router.afterEach((to, from) => {
    if (!from.matched.length || to.path === from.path) return;
    navigated = true;
    closedStory = from.name === "story-id" ? String(from.params.id) : null;
  });
  nuxtApp.hook("page:finish", () => {
    if (!navigated) return;
    navigated = false;
    const link = closedStory ? document.querySelector<HTMLElement>(`[data-story="${closedStory}"] h3 a`) : null;
    (link ?? document.getElementById("main"))?.focus({ preventScroll: true });
  });
});
