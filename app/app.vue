<script setup lang="ts">
const { data, title, load } = useNews();
const colorMode = useColorMode();

// The browser's own UI (address bar, overscroll) takes the page background.
useHead({
  meta: [{ name: "theme-color", content: computed(() => (colorMode.value === "dark" ? "#131214" : "#f7f4ef")) }],
});

const updated = computed(() => (data.value?.generatedAt ? `Updated ${clock(data.value.generatedAt)}.` : ""));

// Pick up the next edition when the tab comes back after it was published.
function onVisible() {
  const next = data.value?.nextUpdateAt;
  if (document.visibilityState === "visible" && next && Date.now() > Date.parse(next)) load();
}

onMounted(() => {
  load();
  document.addEventListener("visibilitychange", onVisible);
});
onBeforeUnmount(() => document.removeEventListener("visibilitychange", onVisible));
</script>

<template>
  <UApp>
    <a class="skip-link" href="#main">Skip to the news</a>
    <SiteHeader :title="title" />

    <main id="main" class="wrap" tabindex="-1">
      <NuxtPage />
    </main>

    <footer class="wrap footer">
      <p>Summaries are written by AI from the linked reports and can contain mistakes. {{ updated }}</p>
    </footer>

    <span id="new-tab-hint" hidden>Opens the source in a new tab</span>
  </UApp>
</template>
