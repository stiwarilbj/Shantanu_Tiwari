<script setup>
import { computed, ref, watchEffect } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { FOOD_SEASON_FIELDS, foodSupplyForDay, huntingOnDay, rulesFor, usesHabitatRules, validate } from '../engine/config.js'
import { FIELD } from '../engine/geometry.js'
import { openingHabitat } from '../engine/habitat.js'
import { format } from '../engine/stats.js'
import NumberField from './NumberField.vue'

const { topic, draft, fork, run, issue } = defineProps({
  topic: { type: String, required: true }, draft: { type: Object, required: true }, fork: Number, run: Object, issue: Object,
})
const previewDay = defineModel('day')
const map = ref(null)
const custom = computed(() => usesHabitatRules(draft))
const errors = computed(() => validate(draft))
const supplyIssue = computed(() => {
  const issues = errors.value
  return issues.food || (draft.scheduleMode !== 'constant' && issues.schedule) ||
    Object.entries(issues).find(([key]) => key.startsWith('foodSeasons.'))?.[1]
})
const season = computed(() => draft.foodSeasons)
const cycleLength = computed(() => {
  if (errors.value['foodSeasons.decline'] || errors.value['foodSeasons.recovery']) return null
  return season.value.decline + season.value.recovery
})
const rulesAt = day => fork != null && day <= fork ? rulesFor(run.setup, run.revisions, day) : draft
const preview = computed(() => {
  const day = previewDay.value
  if (day === '') return { text: 'Enter a day to see its plant count' }
  if (!Number.isInteger(draft.days) || draft.days < 1) return { text: 'Set the run length first' }
  if (!Number.isInteger(day) || day < 1 || day > draft.days) return { text: `Enter a whole day from 1 to ${draft.days}` }
  const saved = fork != null && day <= fork
  const rules = rulesAt(day)
  const issues = saved ? {} : errors.value
  if (!saved) {
    const keys = ['seed', 'foodPlacement', 'patchCount', 'patchRadius', 'patchRelocation', 'patchInterval', 'refugePercent']
    const error = supplyIssue.value || issues[keys.find(key => issues[key])]
    if (error) return { text: error }
  }
  const habitat = openingHabitat(rules, day)
  const hunting = issues.firstHuntingDay || issues.huntingAdvantage ? 'Check hunting settings' :
    huntingOnDay(rules, day) ? 'Hunting active' : 'Hunting off'
  const refuge = habitat.refugeWidth ? `Refuge covers ${100 * habitat.refugeWidth / FIELD}% from each edge` : 'No refuge border'
  return { habitat, supply: foodSupplyForDay(rules, day), text: `Day ${day} · ${habitat.plants.length.toLocaleString('en-US')} plants at dawn${saved ? ' (saved)' : ''}`,
    details: `${refuge} · ${hunting}` }
})
const seasonPlot = computed(() => {
  const { supply } = preview.value
  if (topic !== 'seasons' || !supply?.phase) return null
  const day = previewDay.value
  const peak = day - supply.offset
  const first = Math.max(1, peak)
  const last = Math.min(draft.days, peak + supply.cycleLength)
  const samples = []
  for (let d = first; d <= last; d++) {
    const rules = rulesAt(d)
    if (rules === draft && supplyIssue.value) break
    samples.push(foodSupplyForDay(rules, d))
  }
  if (samples.length <= day - first) return null
  const high = Math.max(...samples.flatMap(sample => [sample.count, sample.base]))
  const low = Math.min(...samples.flatMap(sample => [sample.count, sample.base]))
  const x = index => samples.length === 1 ? 160 : 8 + index * 304 / (samples.length - 1)
  const y = value => high === low ? 42 : 74 - (value - low) * 64 / (high - low)
  const points = key => samples.map((sample, index) => x(index) + ',' + y(sample[key])).join(' ')
  return { first, last: first + samples.length - 1, count: points('count'), base: points('base'),
    x: x(day - first), y: y(supply.count) }
})
watchEffect(() => {
  const canvas = map.value
  const habitat = preview.value.habitat
  if (!canvas || !habitat) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const scale = canvas.width / FIELD
  const edge = habitat.refugeWidth
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.fillStyle = '#79847f'
  ctx.fillRect(0, 0, FIELD, FIELD)
  ctx.fillStyle = '#edeee2'
  ctx.fillRect(edge, edge, FIELD - 2 * edge, FIELD - 2 * edge)
  function circle(x, y, radius) {
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, 2 * Math.PI)
    ctx.fill()
  }
  ctx.fillStyle = '#cbdbbe'
  for (const patch of habitat.patches) circle(patch.x, patch.y, patch.radius)
  ctx.fillStyle = '#486337'
  for (const plant of habitat.plants) circle(plant.x, plant.y, 3.5)
}, { flush: 'post' })

const validRunLength = computed(() => Number.isInteger(draft.days) && draft.days >= 10 && draft.days <= 1000)
const nextScheduleDay = computed(() => {
  if (!validRunLength.value) return null
  const used = new Set(draft.schedule.map(point => point.day)
    .filter(day => Number.isInteger(day) && day >= 2 && day <= draft.days))
  let day = Math.max(1, ...used) + 1
  if (day > draft.days) {
    day = 2
    while (day <= draft.days && used.has(day)) day++
  }
  return day <= draft.days ? day : null
})
function addAnchor() {
  if (nextScheduleDay.value !== null) draft.schedule.push({ day: nextScheduleDay.value, food: draft.food })
}
</script>

<template>
  <div v-if="topic === 'food'" class="advanced-block">
    <h3>Plant supply</h3>
    <label class="advanced-select">Food schedule
      <select id="schedule" v-model="draft.scheduleMode">
        <option value="constant">Constant (schedule off)</option><option value="ramp">Ramp</option><option value="step">Step</option>
      </select>
    </label>
    <template v-if="draft.scheduleMode !== 'constant'">
      <p class="quiet">Day 1 starts with {{ draft.food }} plants. Add a point for each day the supply should reach a new count.</p>
      <div v-for="(point, i) in draft.schedule" :key="i" class="schedule-row">
        <label>Day <input v-model.number="point.day" type="number" min="2" :max="draft.days"></label>
        <label>Plants <input v-model.number="point.food" type="number" min="10" max="1000"></label>
        <button type="button" class="icon" aria-label="Remove schedule point" @click="draft.schedule.splice(i, 1)"><Trash2 :size="17"/></button>
      </div>
      <p v-if="issue.schedule" class="issue">{{ issue.schedule }}</p>
      <div class="advanced-actions">
        <button type="button" class="secondary" :disabled="nextScheduleDay === null"
          :aria-describedby="nextScheduleDay === null ? 'schedule-capacity' : undefined" @click="addAnchor">Add point</button>
        <button v-if="draft.schedule.length" type="button" class="link" @click="draft.schedule = []">Clear</button>
      </div>
      <p v-if="nextScheduleDay === null" id="schedule-capacity" class="quiet">
        {{ validRunLength ? 'Every available day already has a schedule point.' : 'Set a valid run length before adding a point.' }}
      </p>
    </template>
    <p v-else-if="draft.schedule.length" class="quiet">Constant runs use the daily food count. Starting the run clears any invalid schedule points.</p>
  </div>
  <div v-else-if="topic === 'seasons'" class="advanced-block">
    <h3>Food seasons</h3>
    <template v-if="season">
      <label class="advanced-toggle">
        <input id="foodSeasons.enabled" v-model="season.enabled" type="checkbox"> Enable food seasons
      </label>
      <p class="quiet">A gradual cycle changes the base plant supply across the whole field. The plant count stays between 10 and 1,000.</p>
      <template v-if="season.enabled">
        <NumberField v-for="field in FOOD_SEASON_FIELDS" :key="field.key" :id="'foodSeasons.' + field.key"
          v-model="season[field.key]" :label="field.label" :min="field.min" :max="field.max"
          :error="errors['foodSeasons.' + field.key]"/>
        <p v-if="cycleLength" class="quiet">Cycle length · {{ cycleLength }} generations · Pick a first peak day from 1 to {{ cycleLength }}</p>
        <NumberField id="foodSeasons.peakDay" v-model="season.peakDay" label="First peak day in cycle" :min="1"
          :max="cycleLength ?? 200" :disabled="!cycleLength" :error="errors['foodSeasons.peakDay']"/>
      </template>
    </template>
    <p v-else class="quiet">This setup uses its original food rules.</p>
  </div>
  <div v-else class="advanced-block">
    <h3>Field layout</h3>
    <template v-if="custom">
      <label class="advanced-select">Food placement
        <select id="foodPlacement" v-model="draft.foodPlacement">
          <option value="scattered">Scattered (patches off)</option><option value="patches">Patches</option>
        </select>
      </label>
      <template v-if="draft.foodPlacement === 'patches'">
        <p class="quiet">The scheduled supply is divided as evenly as possible among the patches.</p>
        <NumberField id="patchCount" v-model="draft.patchCount" label="Number of patches" :min="1" :max="8" :error="issue.patchCount"/>
        <NumberField id="patchRadius" v-model="draft.patchRadius" label="Patch radius" :min="10" :max="60" :error="issue.patchRadius"/>
        <label class="advanced-select">Patch relocation
          <select id="patchRelocation" v-model="draft.patchRelocation">
            <option value="fixed">Fixed for the run</option><option value="interval">Move every N generations</option>
          </select>
        </label>
        <NumberField v-if="draft.patchRelocation === 'interval'" id="patchInterval" v-model="draft.patchInterval" label="Generations between moves"
          :min="1" :max="100" :error="issue.patchInterval"/>
        <small class="quiet">Radius is measured in field units. The board is {{ FIELD }} units wide.</small>
      </template>
      <label class="advanced-select">Refuge width
        <select id="refugePercent" v-model="draft.refugePercent">
          <option :value="10">Standard · 10%</option><option :value="15">Wide · 15%</option><option :value="20">Extra wide · 20%</option>
        </select>
      </label>
      <p class="quiet">Measure from each edge. A wider home border leaves less space for plants.</p>
    </template>
    <p v-else class="quiet">This setup uses its original field layout.</p>
  </div>
  <div class="advanced-block habitat-preview">
    <h3>Dawn preview</h3>
    <div class="schedule-preview">
      <label>Preview day
        <input id="food-preview-day" v-model.number="previewDay" type="number" min="1" :max="draft.days"
          :aria-invalid="previewDay !== '' && (!Number.isInteger(previewDay) || previewDay < 1 || previewDay > draft.days) ? 'true' : undefined"
          aria-describedby="food-preview-result" @keydown.enter.prevent>
      </label>
      <output id="food-preview-result" for="food-preview-day">{{ preview.text }}</output>
      <output v-if="preview.supply?.phase" for="food-preview-day" class="season-preview-reading">
        {{ preview.supply.phase }} · {{ format(preview.supply.multiplier, Number.isInteger(preview.supply.multiplier) ? 0 : 2) }}% of {{ format(preview.supply.base, 0) }} base plants
        <template v-if="preview.supply.limit"> · {{ preview.supply.limit === 10 ? 'Minimum' : 'Maximum' }} of {{ format(preview.supply.limit, 0) }} applied</template>
      </output>
      <p v-if="preview.details" class="quiet">{{ preview.details }}</p>
    </div>
    <canvas v-if="preview.habitat" ref="map" width="320" height="320" aria-hidden="true"></canvas>
    <figure v-if="seasonPlot" class="season-plot">
      <figcaption>Food cycle · {{ seasonPlot.first === seasonPlot.last ? 'Day ' + seasonPlot.first : 'Days ' + seasonPlot.first + '–' + seasonPlot.last }}</figcaption>
      <svg viewBox="0 0 320 82" aria-hidden="true">
        <path :d="'M' + seasonPlot.x + ' 5V78'" class="season-cycle-marker"/>
        <polyline :points="seasonPlot.base" class="season-base-line"/>
        <polyline :points="seasonPlot.count" class="season-count-line"/>
        <circle :cx="seasonPlot.x" :cy="seasonPlot.y" r="3.5"/>
      </svg>
      <div class="season-plot-key"><span>Plants at dawn</span><span>Base schedule</span></div>
    </figure>
  </div>
</template>
