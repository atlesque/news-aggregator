<script setup lang="ts">
// A story in a list: headline only. It opens the story's own page with the summary and sources.
const props = withDefaults(defineProps<{ story: Story; lead?: boolean; showRegion?: boolean; image?: boolean }>(), {
  lead: false,
  showRegion: true,
  image: true,
});
const primary = computed(() => props.story.sources[0]);
</script>

<template>
  <article :class="['story', `priority-${story.priority}`, { lead }]" :data-story="story.id">
    <StoryThumb v-if="image" :src="story.image" :eager="lead" :placeholder="lead" :topic="story.topic" :source="primary?.name" />
    <div class="body">
      <StoryKicker :story="story" :show-region="showRegion" />
      <h3 :lang="story.lang || undefined">
        <NuxtLink :to="`/story/${story.id}`">{{ story.headline }}</NuxtLink>
      </h3>
      <div class="meta">
        <time :datetime="story.updatedAt" :title="fullDate(story.updatedAt)">{{ ago(story.updatedAt) }}</time>
        <template v-if="primary">
          <span class="dot" aria-hidden="true" />
          <span>{{ primary.name }}</span>
        </template>
        <span v-if="story.sources.length > 1" class="count">+{{ story.sources.length - 1 }}</span>
      </div>
    </div>
  </article>
</template>
