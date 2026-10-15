<script setup lang="ts">
defineProps<{ title: string }>();

const { regions } = useNews();
const { reset } = useTopicFilter();
const route = useRoute();

// Light/dark follows the system until the reader picks one. The button shows the theme it switches to.
const colorMode = useColorMode();
const isDark = computed(() => colorMode.value === "dark");
const themeLabel = computed(() => (isDark.value ? "Switch to light theme" : "Switch to dark theme"));

// Line icons for the phone tab bar, keyed by region id.
const ICONS: Record<string, string> = {
  "": '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  local: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  national: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  europe: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v.01M15.9 8.1v.01M17.5 12v.01M15.9 15.9v.01M12 17.5v.01M8.1 15.9v.01M6.5 12v.01M8.1 8.1v.01" stroke-width="2.6"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};

const items = computed(() => [{ id: "", label: "Home" }, ...regions.value]);
const pathFor = (id: string) => (id ? `/${id}` : "/");

// The home logo and the section links always land on that section from the top, with the
// topic filter cleared, even when the reader is already there.
function goTo(path: string) {
  reset();
  if (route.path === path) window.scrollTo({ top: 0 });
}
</script>

<template>
  <header class="site-header">
    <div class="wrap header-inner">
      <NuxtLink class="brand" to="/" :aria-label="`${title}, home`" @click="goTo('/')">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" /><path d="M10 22V10h2.2l7.6 8.3V10H22v12h-2.2l-7.6-8.3V22z" /></svg>
        <span class="brand-name">{{ title }}</span>
      </NuxtLink>

      <nav class="regions" aria-label="Sections">
        <ul>
          <li v-for="item in items" :key="item.id">
            <NuxtLink
              :to="pathFor(item.id)"
              :aria-current="route.name !== 'story-id' && route.path === pathFor(item.id) ? 'page' : undefined"
              @click="goTo(pathFor(item.id))"
            >
              <!-- eslint-disable-next-line vue/no-v-html -- fixed icon markup above -->
              <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS[item.id] ?? ICONS.world" />
              <span>{{ item.label }}</span>
            </NuxtLink>
          </li>
        </ul>
      </nav>

      <UButton
        class="icon-button"
        color="neutral"
        variant="ghost"
        :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
        :aria-label="themeLabel"
        :title="themeLabel"
        @click="colorMode.preference = isDark ? 'light' : 'dark'"
      />
    </div>
  </header>
</template>
