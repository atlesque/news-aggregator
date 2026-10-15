<script setup lang="ts">
// The front page ("/") and each section ("/local", "/national", …): the lead story with the next
// best beside it, then the rest, grouped by section on the front page.
definePageMeta({
  validate: (route) => {
    const region = route.params.region;
    return !region || (typeof region === "string" && REGION_IDS.includes(region));
  },
});

// The lead story plus this many more make up the top block.
const TOP_COUNT = 4;

const route = useRoute();
const { data, error, title, regions, regionLabel } = useNews();
const { topic, enter } = useTopicFilter();
enter(route.path);

const region = computed(() => (typeof route.params.region === "string" ? route.params.region : ""));
const regionName = computed(() => (region.value ? regionLabel(region.value) : ""));
const regionStories = computed(() => (data.value?.stories ?? []).filter((s) => !region.value || s.region === region.value));
const stories = computed(() => regionStories.value.filter((s) => !topic.value || s.topic === topic.value));

const lead = computed(() => stories.value[0]);
const top = computed(() => stories.value.slice(1, 1 + TOP_COUNT));
const remaining = computed(() => stories.value.slice(1 + TOP_COUNT));
const sections = computed(() =>
  regions.value.map((r) => ({ ...r, stories: remaining.value.filter((s) => s.region === r.id) })).filter((r) => r.stories.length),
);

const status = computed(() => {
  const n = stories.value.length;
  const topicName = topic.value ? topicLabel(topic.value) : "";
  return `${n} ${n === 1 ? "story" : "stories"}${regionName.value ? ` in ${regionName.value}` : ""}${topicName ? ` about ${topicName}` : ""}`;
});

useHead({ title: computed(() => (regionName.value ? `${regionName.value} · ${title.value}` : title.value)) });
</script>

<template>
  <div>
    <h1 class="sr-only">{{ regionName || "Latest news" }}</h1>

    <p v-if="error" class="empty">The news couldn't be loaded. Try again in a moment.</p>
    <p v-else-if="!data" class="loading">Loading the latest news…</p>
    <template v-else>
      <BreakingBar :lead-id="lead?.id" />
      <TopicChips :stories="regionStories" />
      <p class="sr-only" role="status">{{ status }}</p>

      <p v-if="!lead" class="empty">
        {{ data.stories.length ? "No stories match this filter right now." : "No news yet. The first update is on its way." }}
      </p>
      <template v-else>
        <!-- Top block: the lead story with its picture, and the next best stories beside it. -->
        <section class="top" aria-labelledby="h-top">
          <h2 id="h-top" class="sr-only">Top stories</h2>
          <StoryItem :story="lead" lead :show-region="!region" />
          <ul v-if="top.length" class="side" role="list">
            <li v-for="s in top" :key="s.id"><StoryItem :story="s" :show-region="!region" /></li>
          </ul>
        </section>

        <template v-if="region">
          <section v-if="remaining.length" class="section" aria-labelledby="h-more">
            <div class="section-head"><h2 id="h-more">More stories</h2></div>
            <div class="flow">
              <StoryItem v-for="s in remaining" :key="s.id" :story="s" :show-region="false" />
            </div>
          </section>
        </template>
        <template v-else>
          <section v-for="r in sections" :key="r.id" class="section" :aria-labelledby="`h-${r.id}`">
            <div class="section-head">
              <h2 :id="`h-${r.id}`">{{ r.label }}</h2>
              <NuxtLink :to="`/${r.id}`">All {{ r.label }} news<UIcon name="i-lucide-arrow-right" class="arrow" /></NuxtLink>
            </div>
            <div class="flow">
              <StoryItem v-for="s in r.stories" :key="s.id" :story="s" :show-region="false" />
            </div>
          </section>
        </template>
      </template>
    </template>
  </div>
</template>
