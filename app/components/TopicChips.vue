<script setup lang="ts">
// Topic filter: one scrollable row, so it never pushes the news down.
const props = defineProps<{ stories: Story[] }>();
const { topic } = useTopicFilter();
const present = computed(() => [...new Set(props.stories.map((s) => s.topic))].sort());
const toggle = (t: string) => (topic.value = topic.value === t ? "" : t);
</script>

<template>
  <div v-if="present.length >= 2 || topic" class="topics" role="group" aria-label="Filter by topic">
    <UButton class="chip" color="neutral" variant="ghost" :aria-pressed="topic === ''" label="All" @click="toggle('')" />
    <UButton
      v-for="t in present"
      :key="t"
      class="chip"
      color="neutral"
      variant="ghost"
      :aria-pressed="topic === t"
      :label="topicLabel(t)"
      @click="toggle(t)"
    />
  </div>
</template>
