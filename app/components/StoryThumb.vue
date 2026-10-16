<script setup lang="ts">
// A decorative picture (the headline beside it says what it shows). When a story has no picture,
// or it fails to load (hotlink-blocked, gone, a tracking pixel), small thumbnails remove
// themselves so the list closes up. With `placeholder` (the lead story), a calm panel in the
// site's colours with the topic's icon takes its place, so the top block keeps its shape.
const props = defineProps<{ src: string | null; eager?: boolean; placeholder?: boolean; topic?: string; source?: string }>();
const failed = ref(false);
watch(() => props.src, () => (failed.value = false));

// Anything this small is a spacer or tracking pixel, not a news photo.
function onLoad(e: Event) {
  if ((e.target as HTMLImageElement).naturalWidth < 40) failed.value = true;
}
</script>

<template>
  <figure v-if="src && !failed" class="thumb">
    <img
      :src="src"
      alt=""
      :loading="eager ? 'eager' : 'lazy'"
      :fetchpriority="eager ? 'high' : undefined"
      decoding="async"
      referrerpolicy="no-referrer"
      @load="onLoad"
      @error="failed = true"
    />
  </figure>
  <figure v-else-if="placeholder" class="thumb placeholder" aria-hidden="true">
    <UIcon :name="topicIcon(topic)" class="placeholder-icon" />
    <figcaption v-if="source">{{ source }}</figcaption>
  </figure>
</template>
