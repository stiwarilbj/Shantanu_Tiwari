<script setup>
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue'
import { DEATH_CAUSES, METRICS, foragingStats, format, survivalStats, traitSpread } from '../engine/stats.js'
import { useLab } from '../store.js'

const TrendPlot = defineAsyncComponent(() => import('./TrendPlot.vue'))
const lab = useLab()
const emit = defineEmits(['watch'])
const view = ref('survival')
const range = ref('all')
const trait = ref('speed')
const pinnedDay = ref(null)
const chosen = reactive({ survival:'survivalRate', traits:'iqr', food:'plantsPerStarter' })
const traits = METRICS.filter(({ key }) => ['speed', 'size', 'sense'].includes(key))
const views = {
  survival: {
    label: 'Survival & Growth',
    color: '#71D2C0',
    read: survivalStats,
    metrics: [
      { key:'survivalRate', label:'Survival rate', unit:'Percent of starting creatures that survived', suffix:'%', min:0, max:100 },
      { key:'growthRate', label:'Net population growth', unit:'Percent change from opening to closing population', suffix:'%' },
      { key:'birthRate', label:'Births per 100 starting creatures', option:'Births per 100 starters', unit:'Births per 100 starting creatures', min:0 },
    ],
  },
  traits: {
    label: 'Trait Spread',
    read: row => traitSpread(row?.[trait.value]),
    metrics: [
      { key:'mean', label:'Average' },
      { key:'iqr', label:'Middle 50% width', min:0 },
      { key:'sd', label:'Sample standard deviation', min:0 },
    ],
  },
  food: {
    label: 'Food & Hunting',
    color: '#B7D65A',
    read: foragingStats,
    metrics: [
      { key:'plantsPerStarter', label:'Plants eaten per starting creature', option:'Plants per starting creature', unit:'Plants per starting creature', digits:3, min:0 },
      { key:'huntsPerStarter', label:'Successful hunts per starting creature', option:'Hunts per starting creature', unit:'Hunts per starting creature', digits:3, min:0 },
      { key:'fieldUse', label:'Plants used', unit:'Percent of plants used across the whole field', suffix:'%', field:true, min:0, max:100 },
    ],
  },
}

const species = computed(() => lab.run.setup.species.filter(item => item.enabled))
const scopeName = computed(() => species.value.find(item => item.id === lab.scope)?.name ?? 'All species')
const section = computed(() => views[view.value])
const metric = computed(() => section.value.metrics.find(item => item.key === chosen[view.value]))
const traitMetric = computed(() => traits.find(item => item.key === trait.value))
const title = computed(() => view.value === 'traits'
  ? traitMetric.value.short + ' · ' + metric.value.label : metric.value.label)
const unit = computed(() => view.value === 'traits'
  ? traitMetric.value.unit + ' · End of generation' : metric.value.unit)
const rows = computed(() => {
  const summaries = lab.run.summaries
  const visible = range.value === 'all' ? summaries : summaries.slice(-Number(range.value))
  return visible.map(({ day, rows }) => ({ day, ...section.value.read(rows[lab.scope], rows.all) }))
})
const latest = computed(() => rows.value.at(-1))
const pinned = computed(() => rows.value.find(row => row.day === pinnedDay.value))
const reading = computed(() => pinned.value ?? latest.value)
watch(pinned, row => { if (!row) pinnedDay.value = null })

const color = computed(() => section.value.color ?? traitMetric.value.color)
const series = computed(() => [{
  label: title.value,
  color: color.value,
  suffix: metric.value.suffix,
  digits: metric.value.digits,
  value: row => row[metric.value.key],
  primary: true,
  zero: metric.value.key === 'growthRate',
}])

const readings = computed(() => {
  const row = reading.value
  if (!row) return []
  if (view.value === 'survival') return [
    ['Opening population', format(row.opening, 0)],
    ['Closing population', format(row.population, 0)],
    ['Births', format(row.births, 0)],
    ['Deaths', format(row.deaths, 0)],
    ...DEATH_CAUSES.map(cause => [cause, format(row.causes?.[cause], 0)]),
  ]
  if (view.value === 'traits') return [
    ['Creatures sampled', format(row.n, 0)],
    ['Minimum', format(row.min)],
    ['Lower quartile (25%)', format(row.p25)],
    ['Upper quartile (75%)', format(row.p75)],
    ['Maximum', format(row.max)],
  ]
  return [
    ['Starting creatures', format(row.opening, 0)],
    ['Plants spawned (whole field)', format(row.food, 0)],
    ['Plants eaten', format(row.plants, 0)],
    ['Plants left (whole field)', format(row.plantsLeft, 0)],
    ['Successful hunts', format(row.hunts, 0)],
  ]
})

function statValue(row) {
  const value = row[metric.value.key]
  return value == null ? '—' : format(value, metric.value.digits) + (metric.value.suffix ?? '')
}
</script>

<template>
  <div class="advanced-stats-views" role="group" aria-label="Advanced stats views">
    <button v-for="(item, key) in views" :key="key" type="button" class="secondary"
      :aria-pressed="view === key" @click="view = key">{{ item.label }}</button>
  </div>
  <div class="advanced-stats-controls">
    <label>Species <select v-model="lab.scope">
      <option value="all">All species</option>
      <option v-for="item in species" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select></label>
    <label>Range <select v-model="range">
      <option value="all">Full run</option>
      <option value="25">Last 25</option>
      <option value="100">Last 100</option>
    </select></label>
    <label v-if="view === 'traits'">Trait <select v-model="trait">
      <option v-for="item in traits" :key="item.key" :value="item.key">{{ item.short }}</option>
    </select></label>
    <label>Stat <select v-model="chosen[view]">
      <option v-for="item in section.metrics" :key="item.key" :value="item.key">{{ item.option ?? item.label }}</option>
    </select></label>
    <span v-if="latest" class="advanced-stats-latest quiet">Latest completed · Generation {{ latest.day }}</span>
  </div>
  <div class="advanced-stats-body">
    <TrendPlot :key="title" embedded :title="title" :unit="unit" :rows="rows" :series="series" :color="color" :min="metric.min" :max="metric.max"
      :scope="metric.field ? 'Whole field' : scopeName" :pin="pinned?.day"
      @pin="pinnedDay = $event" @watch="emit('watch', $event)"/>
    <section v-if="reading" class="advanced-stats-reading" aria-label="Generation readings">
      <div class="advanced-reading-heading">
        <h3>Generation {{ reading.day }}</h3>
        <button type="button" class="secondary" :aria-pressed="!pinned" @click="pinnedDay = null">Latest</button>
      </div>
      <p class="advanced-reading-value">{{ title }} <strong>{{ statValue(reading) }}</strong></p>
      <dl>
        <template v-for="[label, value] in readings" :key="label">
          <dt>{{ label }}</dt><dd>{{ value }}</dd>
        </template>
      </dl>
      <button type="button" class="secondary" @click="emit('watch', reading.day)">Replay generation {{ reading.day }}</button>
    </section>
  </div>
</template>
