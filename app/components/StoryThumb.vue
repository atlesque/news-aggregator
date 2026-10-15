<script setup lang="ts">
// A decorative picture (the headline beside it says what it shows). Hotlink-blocked or broken
// images remove themselves, so the layout never shows an empty box.
defineProps<{ src: string | null; eager?: boolean }>();
const failed = ref(false);
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
      @error="failed = true"
    />
  </figure>
</template>
