<script setup lang="ts">
import type { NuxtError } from "#app";

defineProps<{ error: NuxtError }>();
useHead({ title: "Page not found" });
</script>

<template>
  <UApp>
    <main class="wrap">
      <p class="empty">This page doesn't exist. <a href="/" @click.prevent="clearError({ redirect: '/' })">Back to the home page</a>.</p>
    </main>
  </UApp>
</template>
