import type { RouterConfig } from "@nuxt/schema";

// Back to a list returns to where the reader was; anything else starts at the top.
export default <RouterConfig>{
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.hash) return { el: to.hash, top: 80 };
    return { top: 0 };
  },
};
