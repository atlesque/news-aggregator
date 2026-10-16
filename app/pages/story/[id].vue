<script setup lang="ts">
// A story's own page: the AI summary, a clear way out to the original report, and the other reports.
const route = useRoute();
const router = useRouter();
const { data, error, title, regionLabel } = useNews();

const story = computed(() => data.value?.stories.find((s) => String(s.id) === route.params.id));
const others = computed(() => story.value?.sources.slice(1) ?? []);

// "Back" returns to the list the reader came from, using the browser's own back step so its
// scroll position and history stay intact. Opened directly, it goes to the front page.
const backPath = typeof window !== "undefined" ? (window.history.state?.back as string | null) : null;
const fromList = typeof backPath === "string" && (backPath === "/" || REGION_IDS.includes(backPath.slice(1)));
const backLabel = computed(() => (fromList && backPath !== "/" ? regionLabel(backPath!.slice(1)) : "Home"));
function back(e: MouseEvent) {
  if (!fromList) return;
  e.preventDefault();
  router.back();
}

useHead({ title: computed(() => (story.value ? `${story.value.headline} · ${title.value}` : title.value)) });
</script>

<template>
  <p v-if="error" class="empty">The news couldn't be loaded. Try again in a moment.</p>
  <p v-else-if="!data" class="loading">Loading the latest news…</p>
  <div v-else-if="!story" class="detail">
    <UButton class="back" :to="fromList ? backPath! : '/'" variant="link" color="neutral" icon="i-lucide-arrow-left" :label="`Back to ${backLabel}`" @click="back" />
    <h1>Story not found</h1>
    <p class="muted">This story is no longer on the front page. News older than a day and a half drops off.</p>
  </div>
  <article v-else class="detail" aria-labelledby="story-title">
    <UButton class="back" :to="fromList ? backPath! : '/'" variant="link" color="neutral" icon="i-lucide-arrow-left" :label="`Back to ${backLabel}`" @click="back" />
    <StoryKicker :story="story" />
    <h1 id="story-title" :lang="story.lang || undefined">{{ story.headline }}</h1>
    <p class="meta">
      <time :datetime="story.updatedAt" :title="fullDate(story.updatedAt)">Updated {{ ago(story.updatedAt) }}</time>
      <template v-if="story.sources.length > 1">
        <span class="dot" aria-hidden="true" />
        <span>{{ story.sources.length }} reports merged</span>
      </template>
    </p>
    <StoryThumb :src="story.image" eager />
    <p v-if="story.summary" class="summary" :lang="story.lang || undefined">{{ story.summary }}</p>
    <p v-if="story.sources[0]" class="read-on">
      <UButton
        :to="story.sources[0].url"
        target="_blank"
        rel="noopener"
        aria-describedby="new-tab-hint"
        color="neutral"
        variant="solid"
        trailing-icon="i-lucide-arrow-up-right"
        :label="`Read the full story at ${story.sources[0].name}`"
      />
    </p>
    <section v-if="others.length" class="also" aria-labelledby="h-also">
      <h2 id="h-also">Also reported by</h2>
      <ul>
        <li v-for="src in others" :key="src.url">
          <UButton
            :to="src.url"
            target="_blank"
            rel="noopener"
            aria-describedby="new-tab-hint"
            color="neutral"
            variant="ghost"
            trailing-icon="i-lucide-arrow-up-right"
            :label="src.name"
          />
        </li>
      </ul>
    </section>
    <p class="ai-note">This summary was written by AI from the linked reports and can contain mistakes.</p>
  </article>
</template>
