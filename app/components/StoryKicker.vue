<script setup lang="ts">
const props = withDefaults(defineProps<{ story: Story; showRegion?: boolean }>(), { showRegion: true });
const { regionLabel } = useNews();
const important = computed(() => !props.story.breaking && props.story.priority === "high");
</script>

<template>
  <div class="kicker">
    <UBadge v-if="story.breaking" class="badge breaking-badge" color="error" variant="solid" label="Breaking" />
    <UBadge v-else-if="important" class="badge high-badge" color="primary" variant="soft" label="Important" />
    <span>{{ topicLabel(story.topic) }}</span>
    <span v-if="showRegion" class="region">{{ regionLabel(story.region) }}</span>
  </div>
</template>
