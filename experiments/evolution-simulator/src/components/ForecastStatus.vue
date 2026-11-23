<script setup>
import { computed } from 'vue'

const props = defineProps({ forecasts: { type: Array, required: true } })
const pending = computed(() => props.forecasts.some(forecast => forecast.pending.value))
const failed = computed(() => props.forecasts.filter(forecast => forecast.error.value))
</script>

<template>
  <div v-if="pending || failed.length" class="forecast-status quiet" role="status">
    <span v-if="pending">Preparing predictions…</span>
    <template v-if="failed.length">
      <span>Predictions couldn’t load</span>
      <button type="button" class="secondary" @click="failed.forEach(forecast => forecast.retry())">Retry predictions</button>
    </template>
  </div>
</template>

<style scoped>
.forecast-status {
  display: flex;
  align-items: center;
  gap: .5rem;
  padding: .25rem .5rem;
  font-size: .8rem;
}
</style>
