<script setup>
import { computed, ref, watchEffect } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { huntingOnDay, rulesFor, usesHabitatRules, validate } from '../engine/config.js'
import { FIELD } from '../engine/geometry.js'
import { openingHabitat } from '../engine/habitat.js'
import NumberField from './NumberField.vue'

const { topic, draft, fork, run, issue } = defineProps({
  topic: { type: String, required: true }, draft: { type: Object, required: true }, fork: Number, run: Object, issue: Object,
})
const previewDay = defineModel('day')
const map = ref(null)
const custom = computed(() => usesHabitatRules(draft))
const preview = computed(() => {
  const day = previewDay.value
  if (day === '') return { text: 'Enter a day to see its plant count' }
  if (!Number.isInteger(draft.days) || draft.days < 1) return { text: 'Set the run length first' }
  if (!Number.isInteger(day) || day < 1 || day > draft.days) return { text: `Enter a whole day from 1 to ${draft.days}` }
  const saved = fork != null && day <= fork
  const rules = saved ? rulesFor(run.setup, run.revisions, day) : draft
  const errors = saved ? {} : validate(rules)
  if (!saved) {
    const keys = ['food', 'seed', 'foodPlacement', 'patchCount', 'patchRadius', 'patchRelocation', 'patchInterval', 'refugePercent']
    if (rules.scheduleMode !== 'constant') keys.push('schedule')
    const error = keys.find(key => errors[key])
    if (error) return { text: errors[error] }
  }
  const habitat = openingHabitat(rules, day)
  const hunting = errors.firstHuntingDay || errors.huntingAdvantage ? 'Check hunting settings' :
    huntingOnDay(rules, day) ? 'Hunting active' : 'Hunting off'
  const refuge = habitat.refugeWidth ? `Refuge covers ${100 * habitat.refugeWidth / FIELD}% from each edge` : 'No refuge border'
  return { habitat, text: `Day ${day} · ${habitat.plants.length.toLocaleString('en-US')} plants at dawn${saved ? ' (saved)' : ''}`,
    details: `${refuge} · ${hunting}` }
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

function addAnchor() {
  const used = new Set(draft.schedule.map(point => point.day))
  let day = Math.max(1, ...used) + 1
  if (day > draft.days) {
    day = 2
    while (day <= draft.days && used.has(day)) day++
  }
  if (day <= draft.days) draft.schedule.push({ day, food: draft.food })
}
</script>

<template>
  <div v-if="topic === 'food'" class="advanced-block">
    <h3>Plant supply</h3>
    <label class="advanced-select">Food schedule
      <select id="schedule" v-model="draft.scheduleMode" @change="delete issue.schedule">
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
        <button type="button" class="secondary" @click="addAnchor">Add point</button>
        <button v-if="draft.schedule.length" type="button" class="link" @click="draft.schedule = []">Clear</button>
      </div>
    </template>
    <p v-else-if="draft.schedule.length" class="quiet">Constant runs use the daily food count. Starting the run clears any invalid schedule points.</p>
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
      <p v-if="preview.details" class="quiet">{{ preview.details }}</p>
    </div>
    <canvas v-if="preview.habitat" ref="map" width="320" height="320" aria-hidden="true"></canvas>
  </div>
</template>
