<script setup>
import { computed, defineAsyncComponent, nextTick, ref } from 'vue'
import { format, METRICS, metricValue } from '../engine/stats.js'
import { useLab } from '../store.js'

const lab = useLab()
const emit = defineEmits(['watch'])
const TrendPlot = defineAsyncComponent(() => import('./TrendPlot.vue'))
const generations = computed(() => lab.run.summaries)
const species = computed(() => lab.run.setup.species.filter(item => item.enabled))
const view = ref('table')
const stat = ref('population')
const statSelect = ref(null)
const pinnedDay = ref(null)
const columns = [
  { key:'opening', label:'Opening population' },
  { key:'population', label:'Closing population' },
  { key:'births', label:'Births' },
  { key:'deaths', label:'Deaths' },
  { key:'net', label:'Net change' },
  ...METRICS.filter(metric => metric.key !== 'population')
    .map(({ key, label, unit, color }) => ({ key, label, unit, color, average:true })),
  { key:'food', label:'Plants spawned', unit:'field total' },
  { key:'plants', label:'Plants eaten' },
  { key:'plantsLeft', label:'Plants left', unit:'field total' },
  { key:'hunts', label:'Successful hunts' },
]

function valueOf(row, column) {
  return column.average ? metricValue(row, column.key) : row?.[column.key]
}

const column = computed(() => columns.find(item => item.key === stat.value))
const trendRows = computed(() => generations.value.map(({ day, rows }) => ({
  day,
  value: valueOf(rows[lab.scope], column.value) ?? null,
  population: rows[lab.scope]?.population,
})))
const trendColor = computed(() => column.value.color ?? '#71D2C0')
const series = computed(() => [{
  label: column.value.label,
  color: trendColor.value,
  value: row => row.value,
  integer: !column.value.average,
  zero: !column.value.average,
  prediction: {
    min: column.value.key === 'net' ? -Infinity : 0,
    max: ['food','plants','plantsLeft'].includes(column.value.key) ? 1000 : Infinity,
    extinct: ['opening','population'].includes(column.value.key) ? row=>row.population===0 : undefined,
  },
}])
const trendScope = computed(() => column.value.unit === 'field total'
  ? 'Whole field'
  : species.value.find(item => item.id === lab.scope)?.name ?? 'All species')
const latest = computed(() => trendRows.value.at(-1))
const pinned = computed(() => trendRows.value.find(row => row.day === pinnedDay.value))

function trendValue(row) {
  return format(row.value, column.value.average ? 2 : 0)
}

async function showTrend(key) {
  stat.value = key
  pinnedDay.value = null
  view.value = 'trend'
  await nextTick()
  statSelect.value?.focus()
}
</script>

<template>
  <div class="generation-sheet-tools">
    <div class="generation-view-buttons" role="group" aria-label="Generation view">
      <button type="button" class="secondary" :aria-pressed="view === 'table'" @click="view = 'table'">Spreadsheet</button>
      <button type="button" class="secondary" :aria-pressed="view === 'trend'" @click="view = 'trend'">Stat trends</button>
    </div>
    <label>Species <select v-model="lab.scope">
      <option value="all">All species</option>
      <option v-for="item in species" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select></label>
    <span class="quiet">{{ format(generations.length, 0) }} completed</span>
  </div>
  <template v-if="view === 'table'">
    <p class="generation-sheet-note quiet">End-of-day results · Select a stat to chart it or a generation to replay it</p>
    <div class="generation-sheet" role="region" aria-label="Generation spreadsheet" tabindex="0">
      <table aria-label="Completed generations">
        <thead>
          <tr>
            <th scope="col">Generation</th>
            <th v-for="column in columns" :key="column.key" scope="col" :aria-label="column.label">
              <button type="button" :aria-label="'View '+column.label+' trend'" @click="showTrend(column.key)">
                {{ column.label }}<small v-if="column.unit">{{ column.unit }}</small>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in generations" :key="record.day" v-memo="[record, lab.scope]">
            <th scope="row"><button class="link" :aria-label="'Replay generation '+record.day" @click="emit('watch',record.day)">{{ record.day }}</button></th>
            <td v-for="column in columns" :key="column.key" :title="valueOf(record.rows[lab.scope],column)?.toString()">
              {{ format(valueOf(record.rows[lab.scope],column), column.average ? 2 : 0) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!generations.length" class="quiet">The first row appears when Generation 1 finishes.</p>
  </template>
  <div v-else class="generation-stat-trend">
    <div class="generation-sheet-tools generation-stat-tools">
      <label>Stat <select ref="statSelect" v-model="stat">
        <option v-for="item in columns" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select></label>
      <span v-if="latest" class="generation-stat-latest">Latest · Generation {{ latest.day }} <strong>{{ trendValue(latest) }}</strong></span>
    </div>
    <TrendPlot :key="stat" :title="column.label" :unit="column.unit" :rows="trendRows" :series="series"
      :scope="trendScope" :color="trendColor" :pin="pinned?.day" :embedded="true"
      @pin="pinnedDay = $event" @watch="emit('watch', $event)"/>
    <div v-if="pinned" class="generation-sheet-tools generation-stat-pin" aria-live="polite">
      <span>Generation {{ pinned.day }} <strong>{{ trendValue(pinned) }}</strong></span>
      <button type="button" class="secondary" @click="emit('watch', pinned.day)">Replay generation {{ pinned.day }}</button>
    </div>
  </div>
</template>
