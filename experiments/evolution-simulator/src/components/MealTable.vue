<script setup>
import { computed, shallowRef, watch } from 'vue'
import { preyMeals } from '../engine/stats.js'
import { runSpecies } from '../engine/species-actions.js'
import { useLab } from '../store.js'

const props = defineProps({ day: { type: Number, required: true } })
const lab = useLab()
const summary = computed(() => lab.run.summaries.find(row => row.day === props.day))
const species = computed(() => runSpecies(lab.run, props.day).filter(item =>
  item.enabled && Object.hasOwn(summary.value?.rows ?? {}, item.id)))
const eaters = computed(() => species.value.filter(item => lab.scope === 'all' || item.id === lab.scope))
const historical = shallowRef(null)
const loading = shallowRef(false)
const retry = shallowRef(0)
const cache = new Map()
const breakdown = computed(() => summary.value?.preyMeals ?? historical.value)
const missing = computed(() => !breakdown.value && !loading.value)

watch([() => lab.run.id, () => props.day, summary, retry], async ([id, day, row], _, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  historical.value = null
  loading.value = false
  if (!row || row.preyMeals) return
  if (row.rows.all.hunts === 0) {
    historical.value = {}
    return
  }
  const key = id + ':' + day
  if (cache.has(key)) {
    historical.value = cache.get(key)
    return
  }
  loading.value = true
  try {
    const track = await lab.getTrack(lab.run, day)
    const pairs = preyMeals(track.events)
    const counted = Object.values(pairs).flatMap(Object.values).reduce((sum, count) => sum + count, 0)
    if (counted === row.rows.all.hunts) {
      cache.set(key, pairs)
      if (cache.size > 12) cache.delete(cache.keys().next().value)
      if (current) historical.value = pairs
    }
  } catch {
    // Saved summary totals remain available when a historical replay fails.
  } finally {
    if (current) loading.value = false
  }
}, { immediate: true })

function countFor(eater, prey) {
  if (!breakdown.value) return '—'
  const pairs = Object.hasOwn(breakdown.value, eater) ? breakdown.value[eater] : {}
  return Object.hasOwn(pairs, prey) ? pairs[prey] : 0
}
</script>

<template>
  <section v-if="summary" class="meal-section">
    <h3 id="meal-table-title">Meals by species</h3>
    <p v-if="loading" role="status">Recovering prey counts from the replay…</p>
    <p v-if="missing" role="status">
      Prey breakdown unavailable for this generation.
      <button type="button" class="link" @click="retry++">Try again</button>
    </p>
    <p v-if="!eaters.length" class="quiet">This species was absent in Generation {{ day }}.</p>
    <div v-else class="meal-scroll" tabindex="0" role="region" aria-labelledby="meal-table-title">
      <table>
        <caption>Generation {{ day }}</caption>
        <thead><tr>
          <th scope="col">Eating species</th><th scope="col">Plants</th>
          <th v-for="item in species" :key="item.id" scope="col">{{ item.name }} prey</th>
          <th scope="col">Hunts</th><th scope="col">Total meals</th>
        </tr></thead>
        <tbody><tr v-for="item in eaters" :key="item.id">
          <th scope="row"><span class="diet-swatch" :style="{ backgroundColor: item.color }" aria-hidden="true"></span>{{ item.name }}</th>
          <td>{{ summary.rows[item.id].plants }}</td>
          <td v-for="prey in species" :key="prey.id">{{ countFor(item.id, prey.id) }}</td>
          <td>{{ summary.rows[item.id].hunts }}</td>
          <td>{{ summary.rows[item.id].hunts + summary.rows[item.id].plants }}</td>
        </tr></tbody>
      </table>
    </div>
  </section>
</template>

<style>
.meal-section { min-width: 0; margin-top: 1.2rem; }
.meal-section h3 { margin-bottom: .6rem; }
.meal-scroll { max-width: 100%; overflow-x: auto; }
.meal-scroll table { width: 100%; border-collapse: collapse; text-align: left; }
.meal-scroll caption { text-align: left; padding-bottom: .45rem; }
.meal-scroll th, .meal-scroll td { padding: .65rem .75rem; border-bottom: 1px solid #ffffff28; white-space: nowrap; }
.meal-scroll .diet-swatch { display: inline-block; margin-inline-end: .5em; }
.meal-scroll td { font-variant-numeric: tabular-nums; }
</style>
