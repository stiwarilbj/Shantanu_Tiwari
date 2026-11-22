<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { countAges, format } from '../engine/stats.js'
import { useLab } from '../store.js'

const props = defineProps({ pair: Array, row: Object, days: Array, endpoints: Array, cohort: String, scope: String })
const emit = defineEmits(['day'])
const lab = useLab()
const tracks = shallowRef(null)
const issue = ref('')
const attempt = ref(0)
let request = 0

const columns = computed(() => [
  { key: 'wide', label: 'Wide mutation', summary: props.row.wide?.age },
  { key: 'narrow', label: 'Narrow mutation', summary: props.row.narrow?.age },
])
const position = computed(() => props.days.indexOf(props.row.day))
const counts = computed(() => tracks.value?.map(track => {
  const roster = props.cohort === 'dawn' ? track.opening : track.final.blobs.filter(blob => blob.alive)
  return countAges(roster.filter(blob => props.scope === 'all' || blob.species === props.scope))
}))
const ages = computed(() => counts.value
  ? [...new Set(counts.value.flatMap(count => [...count.keys()]))].sort((a, b) => a - b)
  : [])
const peak = computed(() => Math.max(1, ...ages.value.flatMap(age => counts.value.map(count => count.get(age) ?? 0))))

function selectDay(event) {
  const day = event.target.valueAsNumber
  if (props.days.includes(day)) emit('day', day)
  else event.target.value = props.row.day
}
function newbornShare(index) {
  const samples = columns.value[index].summary?.n
  return samples && counts.value ? format(100 * (counts.value[index].get(0) ?? 0) / samples, 1) + '%' : '—'
}
watch([() => props.pair, () => props.row.day, attempt], async ([pair, day]) => {
  const id = ++request
  tracks.value = null
  issue.value = ''
  try {
    const next = await Promise.all(pair.map(run => lab.getTrack(run, day)))
    if (id === request) tracks.value = next
  } catch {
    if (id === request) issue.value = 'Could not load the exact age counts for this day'
  }
}, { immediate: true })
onBeforeUnmount(() => { request++ })
</script>

<template>
  <section class="age-cohorts" aria-labelledby="age-cohort-title">
    <header>
      <div>
        <h3 id="age-cohort-title">Inside Day {{ row.day }}</h3>
        <p>{{ cohort === 'dawn' ? 'Dawn · Blobs alive at the start of the day' : 'Dusk · Survivors and newborns at the end of the day' }}</p>
      </div>
      <div class="age-day-controls" role="group" aria-label="Day to inspect">
        <button class="icon" aria-label="Previous age day" :disabled="position <= 0" @click="emit('day', days[position - 1])"><ChevronLeft :size="18"/></button>
        <label>Day <input type="number" :value="row.day" :min="days[0]" :max="days.at(-1)" @change="selectDay" @keydown.enter.prevent="selectDay"></label>
        <button class="icon" aria-label="Next age day" :disabled="position >= days.length - 1" @click="emit('day', days[position + 1])"><ChevronRight :size="18"/></button>
      </div>
    </header>

    <div class="age-cohort-cards">
      <article v-for="(column, index) in columns" :key="column.key" :class="'age-' + column.key" :aria-label="column.label">
        <h4>{{ column.label }}</h4>
        <dl>
          <div><dt>Mean age</dt><dd>{{ format(column.summary?.mean) }}<small v-if="column.summary?.n"> days</small></dd></div>
          <div><dt>Living blobs</dt><dd>{{ format(column.summary?.n, 0) }}</dd></div>
          <div><dt>Oldest</dt><dd>{{ format(column.summary?.max, 0) }}<small v-if="column.summary?.n"> days</small></dd></div>
          <div><dt>Age-zero share</dt><dd>{{ newbornShare(index) }}</dd></div>
        </dl>
      </article>
    </div>

    <p v-if="issue" class="age-demo-error" role="alert">{{ issue }} <button class="link" @click="attempt++">Retry age counts</button></p>
    <p v-else-if="!counts" class="quiet" role="status">Loading age counts for Day {{ row.day }}…</p>
    <details v-show="counts" class="age-counts">
      <summary>Show counts by age</summary>
      <p>{{ row.day === 1 && cohort === 'dawn' ? 'The Day 1 founders all start at age zero.' : 'Age zero means the blob was born in the most recent generation.' }}</p>
      <table v-if="ages.length" aria-label="Living blobs by age">
        <thead><tr><th scope="col">Age (days)</th><th scope="col">Wide count</th><th scope="col">Narrow count</th></tr></thead>
        <tbody>
          <tr v-for="age in ages" :key="age">
            <th scope="row">{{ age }}</th>
            <td v-for="(column, index) in columns" :key="column.key" :class="'age-' + column.key">
              <span class="age-count-bar" :style="{ '--count': (100 * (counts[index].get(age) ?? 0) / peak) + '%' }">{{ counts[index].get(age) ?? 0 }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>No living blobs in this cohort on Day {{ row.day }}</p>
    </details>
    <details v-if="endpoints.length > 1" class="age-endpoints">
      <summary>Compare the final days</summary>
      <table aria-label="Mean ages on the final days">
        <thead><tr><th scope="col">Day</th><th scope="col">Wide mean age</th><th scope="col">Narrow mean age</th></tr></thead>
        <tbody><tr v-for="endpoint in endpoints" :key="endpoint.day">
          <th scope="row">{{ endpoint.day }}</th>
          <td v-for="(value, index) in endpoint.values" :key="index">{{ format(value) }}<small v-if="value != null"> days</small></td>
        </tr></tbody>
      </table>
    </details>
  </section>
</template>
