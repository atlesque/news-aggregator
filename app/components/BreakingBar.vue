<script setup lang="ts">
// Breaking headlines, minus the one already shown as the lead right below.
const props = defineProps<{ leadId?: number }>();
const { data } = useNews();
const breaking = computed(() => (data.value?.stories ?? []).filter((s) => s.breaking && s.id !== props.leadId));
</script>

<template>
  <div v-if="breaking.length" class="breaking">
    <p class="breaking-label"><span class="pulse" aria-hidden="true" />Breaking</p>
    <ul>
      <li v-for="s in breaking" :key="s.id" :lang="s.lang || undefined">
        <NuxtLink :to="`/story/${s.id}`">{{ s.headline }}</NuxtLink>
      </li>
    </ul>
  </div>
</template>
