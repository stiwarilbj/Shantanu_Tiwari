<script setup>
import { computed, ref, shallowRef, watch, watchEffect } from 'vue'
import { rulesFor, TERRITORY_EDGES, TERRITORY_FIELDS, usesOptionalRules, validate } from '../engine/config.js'
import { FIELD } from '../engine/geometry.js'
import { dawn, founders } from '../engine/simulation.js'
import { startingEdge, territoryFor } from '../engine/starting-territories.js'
import { useLab } from '../store.js'
import NumberField from './NumberField.vue'

const { draft, issue, fork } = defineProps({ draft: Object, issue: Object, fork: Number })
const speciesId = defineModel('species')
const lab = useLab()
const day = (fork ?? 0) + 1
const map = ref(null)
const checkpoint = shallowRef(null)
const unavailable = ref(false)
const retry = ref(0)
const selected = computed(() => draft.species.find(species => species.id === speciesId.value))
const inherited = computed(() => !!selected.value && !selected.value.territory)
const placement = computed(() => territoryFor(draft, selected.value))
const prefix = computed(() => selected.value ? selected.value.id + '.territory.' : 'territories.')
const territoryIssue = key => key.startsWith('territories.') || key.includes('.territory.')
const showFields = computed(() => draft.territories.enabled || Object.keys(issue).some(territoryIssue))
const edgeLabel = edge => edge[0].toUpperCase() + edge.slice(1)

function clearTerritoryErrors(event) {
  if (event.target.checked || !usesOptionalRules(draft)) return
  for (const key of Object.keys(issue)) {
    if (territoryIssue(key)) delete issue[key]
  }
}

function customize(event) {
  const { edges, center, width } = draft.territories
  if (event.target.checked) selected.value.territory = { edges: [...edges], center, width }
  else delete selected.value.territory
  for (const key of Object.keys(issue)) {
    if (key.startsWith(prefix.value)) delete issue[key]
  }
}

watch([() => draft.territories.enabled, () => lab.run, retry], async ([enabled, run], _, onCleanup) => {
  checkpoint.value = null
  unavailable.value = false
  if (!enabled || fork == null || !run) return
  let current = true
  onCleanup(() => { current = false })
  try {
    const opening = await lab.checkpointAt(run, fork)
    if (current) checkpoint.value = opening
  } catch {
    if (current) unavailable.value = true
  }
}, { immediate: true })

const preview = computed(() => {
  if (!draft.territories.enabled) return {}
  if (unavailable.value) return { text: 'Could not load the fork roster' }
  if (fork != null && !checkpoint.value) return { text: 'Loading the fork roster…' }

  const errors = validate(draft)
  const habitatKeys = ['food', 'seed', 'foodPlacement', 'patchCount', 'patchRadius',
    'patchRelocation', 'patchInterval', 'refugePercent']
  if (draft.scheduleMode !== 'constant') habitatKeys.push('schedule')
  if (errors.days || day > draft.days) return { text: 'Set a run length that includes Day ' + day }
  if (Object.keys(errors).some(key => territoryIssue(key) || habitatKeys.includes(key) ||
      key === 'species' || /\.(count|size|name|color)$/.test(key))) {
    return { text: 'Check the territory, habitat, and species settings to preview Day ' + day }
  }

  const previous = fork == null ? draft : rulesFor(lab.run.setup, lab.run.revisions, fork)
  const board = dawn(draft, day, checkpoint.value ?? founders(draft), previous)
  const counts = new Map(draft.species.filter(species => species.enabled).map(species => [
    species.id, { name: species.name, color: species.color, total: 0, edges: [0, 0, 0, 0] },
  ]))
  for (const blob of board.blobs) {
    const count = counts.get(blob.species)
    count.total++
    count.edges[TERRITORY_EDGES.indexOf(startingEdge(blob))]++
  }
  return { board, counts, text: 'Day ' + day + ' at dawn · ' + board.blobs.length.toLocaleString('en-US') + ' blobs' }
})

watchEffect(() => {
  const canvas = map.value
  const { board, counts } = preview.value
  if (!canvas || !board) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const scale = canvas.width / FIELD
  const edge = board.refugeWidth
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.fillStyle = '#79847f'
  ctx.fillRect(0, 0, FIELD, FIELD)
  ctx.fillStyle = '#edeee2'
  ctx.fillRect(edge, edge, FIELD - 2 * edge, FIELD - 2 * edge)
  function circle(x, y, radius) {
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, 2 * Math.PI)
  }
  ctx.fillStyle = '#486337'
  for (const plant of board.plants) {
    circle(plant.x, plant.y, 2)
    ctx.fill()
  }
  ctx.strokeStyle = '#ffffff99'
  ctx.lineWidth = 1.25
  for (const blob of board.blobs) {
    ctx.fillStyle = counts.get(blob.species).color
    circle(blob.x, blob.y, Math.max(3.5, blob.r))
    ctx.stroke()
    ctx.fill()
  }
}, { flush: 'post' })
</script>

<template>
  <div class="advanced-block">
    <h3>Starting territories</h3>
    <label class="advanced-toggle">
      <input id="territories.enabled" v-model="draft.territories.enabled" type="checkbox" @change="clearTerritoryErrors">
      Use starting territories
    </label>
    <p class="quiet">Choose where each species enters the field. Blobs still return to the usual refuge.</p>
    <template v-if="showFields">
      <label class="advanced-select">Apply territories
        <select id="territories.timing" v-model="draft.territories.timing" @change="delete issue['territories.timing']">
          <option value="opening">Opening generation only</option>
          <option value="daily">Every dawn</option>
        </select>
      </label>
      <p class="quiet">Opening-only placement also applies when a branch changes the starting territories.</p>
      <label class="advanced-select">Placement for
        <select v-model="speciesId">
          <option :value="null">Field default</option>
          <option v-for="species in draft.species" :key="species.id" :value="species.id">
            {{ species.name }}{{ species.enabled ? '' : ' (Off)' }}
          </option>
        </select>
      </label>
      <label v-if="selected" class="advanced-toggle">
        <input type="checkbox" :checked="!inherited" @change="customize"> Use custom settings
      </label>
      <p v-if="inherited" class="quiet">This species uses the field default.</p>
      <fieldset class="territory-edges" :disabled="inherited"
        :aria-describedby="!inherited && issue[prefix + 'edges'] ? 'territory-edge-error' : undefined">
        <legend>Starting edges</legend>
        <div class="territory-options">
          <label v-for="(edge, index) in TERRITORY_EDGES" :key="edge" class="advanced-toggle">
            <input :id="index === 0 ? prefix + 'edges' : undefined" v-model="placement.edges" :value="edge" type="checkbox"
              :aria-invalid="!inherited && !!issue[prefix + 'edges'] || undefined" @change="delete issue[prefix + 'edges']">
            {{ edgeLabel(edge) }}
          </label>
        </div>
        <small v-if="!inherited && issue[prefix + 'edges']" id="territory-edge-error" class="issue">{{ issue[prefix + 'edges'] }}</small>
      </fieldset>
      <NumberField v-for="field in TERRITORY_FIELDS" :key="prefix + field.key" :id="prefix + field.key"
        v-model="placement[field.key]" :label="field.label" :min="field.min" :max="field.max"
        :disabled="inherited" :error="inherited ? undefined : issue[prefix + field.key]"
        @update:model-value="delete issue[prefix + field.key]"/>
      <p class="quiet">Bands read left to right along horizontal edges and top to bottom along vertical edges. Near a corner, the band slides inward to keep its width.</p>
    </template>
  </div>

  <div v-if="draft.territories.enabled" class="advanced-block">
    <h3>Dawn preview</h3>
    <p role="status">{{ preview.text }}</p>
    <div v-if="preview.board" class="territory-layout">
      <div class="territory-map" aria-hidden="true">
        <span class="territory-top">Top</span>
        <span class="territory-left">Left</span>
        <canvas ref="map" width="320" height="320"></canvas>
        <span class="territory-right">Right</span>
        <span class="territory-bottom">Bottom</span>
      </div>
      <div>
        <p class="quiet">Green dots are plants. The gray border is the refuge.</p>
        <ul class="territory-counts">
          <li v-for="[id, group] in preview.counts" :key="id" :data-species="id">
            <strong><i :style="{ background: group.color }" aria-hidden="true"></i>{{ group.name }} · {{ group.total }}</strong>
            <span class="quiet">{{ TERRITORY_EDGES.map((edge, index) => edgeLabel(edge) + ' ' + group.edges[index]).join(' · ') }}</span>
          </li>
        </ul>
      </div>
    </div>
    <div v-if="unavailable" class="advanced-actions">
      <button type="button" class="secondary" @click="retry++">Retry preview</button>
    </div>
  </div>
</template>

<style scoped>
.territory-edges{min-width:0;margin:0;padding:0 10px 4px;border:1px solid var(--line);border-radius:5px}
.territory-edges legend{padding:0 5px;color:var(--cream)}
.territory-edges:disabled{opacity:.65}
.territory-options{display:flex;flex-wrap:wrap;gap:0 16px}
.territory-layout{display:grid;align-items:center;grid-template-columns:minmax(0,250px) minmax(0,1fr);gap:16px}
.territory-map{display:grid;align-items:center;justify-items:center;grid-template-columns:auto minmax(0,1fr) auto;
  grid-template-areas:". top ." "left field right" ". bottom .";gap:4px 6px;color:var(--muted);font-size:12px}
.territory-top{grid-area:top}
.territory-left{grid-area:left}
.territory-right{grid-area:right}
.territory-bottom{grid-area:bottom}
.territory-map canvas{grid-area:field;display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:5px}
.territory-counts{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:6px}
.territory-counts li{display:grid;gap:2px;padding:6px 0;border-top:1px solid var(--subtle);overflow-wrap:anywhere}
.territory-counts strong{display:flex;align-items:baseline;gap:6px;color:var(--cream)}
.territory-counts i{flex:none;width:10px;height:10px;border:1px solid var(--muted);border-radius:50%}
@media(max-width:580px){
  .territory-layout{grid-template-columns:minmax(0,1fr);gap:10px}
  .territory-map{width:min(100%,250px);margin-inline:auto}
}
</style>
