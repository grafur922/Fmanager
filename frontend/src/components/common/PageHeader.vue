<template>
  <section class="page-heading">
    <div>
      <div v-if="eyebrow" class="page-heading__eyebrow">{{ eyebrow }}</div>
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div class="page-heading__actions">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  eyebrow?: string
}>()
</script>
