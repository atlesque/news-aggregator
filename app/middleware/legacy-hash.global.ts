// Links from the old front end used the hash ("/#story-12", "/#local"); send them to the matching page.
export default defineNuxtRouteMiddleware((to) => {
  if (to.path !== "/" || !to.hash) return;
  const legacy = /^#(?:story-(\d+)|(local|national|europe|world))$/.exec(to.hash);
  if (legacy) return navigateTo(legacy[1] ? `/story/${legacy[1]}` : `/${legacy[2]}`, { replace: true });
});
