<script setup>
import { computed, onMounted, ref } from 'vue'
import { useLab } from '../store.js'
import { rulesFor, TRAITS } from '../engine/config.js'
import { format } from '../engine/stats.js'
import { MAX_TRAIT_CHANGE } from '../engine/trait-adjustments.js'
import { newSpecies, SPECIES_TRAIT_LABELS, speciesActionIssue, speciesTraitValue, speciesWithEdits, splitSample } from '../engine/species-actions.js'
import SpeciesFields from './SpeciesFields.vue'

const lab = useLab()
const dialog = ref()
const kind = ref('introduce')
const target = ref('')
const definition = ref(null)
const selection = ref('sample')
const count = ref(1)
const ids = ref([])
const query = ref('')
const traitMode = ref('adjust')
const checked = ref([])
const values = ref({})
const frame = computed(() => lab.frame)
const rules = computed(() => {
  const base = rulesFor(lab.run.setup, lab.run.revisions, frame.value?.day ?? lab.viewing)
  return { ...base, species: speciesWithEdits(base.species, frame.value?.speciesEdits) }
})
const living = computed(() => frame.value?.blobs.filter(blob => blob.alive) ?? [])
const livingCounts = computed(() => {
  const counts = new Map()
  for (const blob of living.value) counts.set(blob.species, (counts.get(blob.species) ?? 0) + 1)
  return counts
})
const choices = computed(() => rules.value.species.filter(item => item.enabled &&
  (kind.value !== 'split' || livingCounts.value.has(item.id))))
const source = computed(() => choices.value.find(item => item.id === target.value))
const available = computed(() => living.value.filter(blob => blob.species === target.value))
const searchResults = computed(() => available.value.filter(blob =>
  String(blob.id).includes(query.value.trim().replace(/^#/, ''))))
const chosen = computed(() => {
  if (kind.value === 'edit') return available.value
  if (kind.value !== 'split') return []
  if (selection.value === 'ids') {
    const selected = new Set(ids.value)
    return available.value.filter(blob => selected.has(blob.id))
  }
  if (!Number.isInteger(count.value) || count.value < 1 || count.value > available.value.length) return []
  const { day, time, stepSeconds } = frame.value
  return splitSample(available.value, count.value, rules.value.seed, day, Math.round(time / stepSeconds))
})
const traits = computed(() => checked.value.length ? {
  mode: traitMode.value,
  values: Object.fromEntries(checked.value.map(key => [key, values.value[key] === '' ? null : values.value[key]])),
} : undefined)
const action = computed(() => {
  if (!definition.value) return null
  const { id, name, color } = definition.value
  const creatureIds = chosen.value.map(blob => blob.id)
  if (kind.value === 'edit') return { kind: 'edit', id, identity: { name: name.trim(), color }, creatureIds, traits: traits.value }
  const full = { ...definition.value, name: name.trim(), count: Math.max(10, definition.value.count), enabled: true }
  if (kind.value === 'split') {
    return { kind: 'split', id, definition: full, sourceId: source.value?.id, creatureIds, traits: traits.value }
  }
  return { kind: 'introduce', id, definition: full, count: definition.value.count }
})
const issue = computed(() => action.value ? speciesActionIssue(action.value, rules.value, frame.value?.blobs) : '')
const preview = computed(() => {
  if (!definition.value || issue.value) return []
  return TRAITS.map(key => {
    if (kind.value === 'introduce') return [key, definition.value[key], definition.value[key]]
    let min = Infinity, max = -Infinity
    for (const blob of chosen.value) {
      const after = speciesTraitValue(blob, key, traits.value, rules.value)
      min = Math.min(min, after)
      max = Math.max(max, after)
    }
    return [key, min, max]
  }).filter(([, min]) => Number.isFinite(min))
})
const total = computed(() => kind.value === 'introduce' ? definition.value?.count : chosen.value.length)
const nextIds = computed(() => {
  if (kind.value !== 'introduce') return chosen.value.map(blob => blob.id)
  if (issue.value || !frame.value?.nextId) return []
  return Array.from({ length: total.value }, (_, index) => frame.value.nextId + index)
})
const resultText = computed(() => {
  const result = lab.speciesResult
  if (!result) return ''
  if (result.kind === 'edit') return 'Updated ' + result.identity.name
  const amount = result.creatureIds.length
  return (result.kind === 'split' ? 'Moved ' : 'Introduced ') + amount + (amount === 1 ? ' blob' : ' blobs') + ' in ' + result.definition.name
})

function resetTarget() {
  ids.value = []
  query.value = ''
  count.value = 1
  checked.value = []
  values.value = {}
  traitMode.value = 'adjust'
  definition.value = kind.value === 'edit'
    ? source.value && { ...source.value }
    : newSpecies(rules.value.species, rules.value.version, kind.value === 'split' ? source.value : undefined)
}

function choose(nextKind) {
  kind.value = nextKind
  target.value = choices.value[0]?.id ?? ''
  selection.value = 'sample'
  resetTarget()
}

function moreChanges() {
  lab.speciesResult = null
  choose('introduce')
}

function close() {
  if (!lab.adjustingTraits) lab.modal = null
}

function resume() {
  close()
  lab.play()
}

function apply() {
  if (!issue.value && action.value) lab.changeSpecies(action.value)
}

onMounted(() => {
  choose('introduce')
  dialog.value.showModal()
})
</script>

<template>
  <dialog ref="dialog" class="task-dialog species-dialog" aria-labelledby="world-species-title" @cancel.prevent="close">
    <header><h2 id="world-species-title">Species</h2></header>
    <p v-if="frame" class="quiet">Day {{ frame.day }} · {{ format(frame.time) }} s{{ lab.replay ? ' · Replay' : ' · Paused' }}</p>
    <template v-if="lab.replay">
      <p>Open the live day to change its species.</p>
      <footer><button type="button" class="secondary" @click="close">Close</button>
        <button v-if="lab.canEnterLive" type="button" class="primary" @click="lab.goLive()">Back to Live</button></footer>
    </template>
    <template v-else-if="lab.speciesResult">
      <p role="status">{{ resultText }}. The world is still paused.</p>
      <footer>
        <button type="button" class="secondary" @click="close">Done</button>
        <button type="button" class="secondary" @click="moreChanges">Make another change</button>
        <button type="button" class="primary" @click="resume">Resume</button>
      </footer>
    </template>
    <template v-else-if="lab.recordedChangesAhead || !lab.canChangeSpecies">
      <p role="status">{{ lab.recordedChangesAhead ? 'Play through the remaining imported changes before making a new one.' : 'Species can change during an unfinished live generation.' }}</p>
      <footer><button type="button" class="secondary" @click="close">Close</button></footer>
    </template>
    <form v-else novalidate @submit.prevent="apply">
      <fieldset class="species-workflow" :disabled="lab.adjustingTraits || !lab.canAdjustSpecies">
        <div class="species-presets" role="group" aria-label="Species action">
          <button v-for="[key, label] in [['introduce', 'Introduce species'], ['split', 'Split living blobs'], ['edit', 'Edit species']]" :key="key"
            type="button" class="secondary" :aria-pressed="kind === key" @click="choose(key)">{{ label }}</button>
        </div>
        <label v-if="kind !== 'introduce' && choices.length" class="dialog-field">
          {{ kind === 'split' ? 'Source species' : 'Species to edit' }}
          <select v-model="target" @change="resetTarget">
            <option v-for="item in choices" :key="item.id" :value="item.id">{{ item.name }} · {{ livingCounts.get(item.id) ?? 0 }} living</option>
          </select>
        </label>
        <p v-if="kind === 'split' && !choices.length">There are no living blobs to split.</p>
        <template v-else-if="definition">
          <p v-if="kind === 'split'" class="quiet">Selected blobs keep their IDs, positions, food, energy, age, and lineage.</p>
          <SpeciesFields :species="definition" :rules="rules" :starting="kind === 'introduce'" presets live/>
          <template v-if="kind === 'split'">
            <label class="dialog-field">Pick blobs
              <select v-model="selection"><option value="sample">Seeded sample</option><option value="ids">Choose by ID</option></select>
            </label>
            <label v-if="selection === 'sample'" class="dialog-field">Number to move
              <input v-model.number="count" type="number" min="1" :max="available.length" step="1">
            </label>
            <fieldset v-else class="group-picker">
              <legend>Choose living blobs</legend>
              <label class="blob-search">Find by ID <input v-model="query" type="search" placeholder="e.g. #12" @keydown.enter.prevent></label>
              <p class="quiet">{{ ids.length }} selected</p>
              <div class="picker-rows">
                <label v-for="blob in searchResults.slice(0, 30)" :key="blob.id" class="picker-row">
                  <input v-model="ids" type="checkbox" :value="blob.id"> #{{ blob.id }}
                  <small>{{ blob.home ? 'In refuge' : 'Active' }}</small>
                </label>
              </div>
              <p v-if="!searchResults.length" class="quiet">No matching IDs.</p>
              <p v-else-if="searchResults.length > 30" class="quiet">Showing 30 of {{ searchResults.length }}. Search for an exact ID to narrow the list.</p>
            </fieldset>
          </template>
          <fieldset v-if="kind !== 'introduce' && chosen.length" class="group-picker">
            <legend>Living traits · optional</legend>
            <label class="dialog-field">Change type
              <select v-model="traitMode"><option value="adjust">Add or subtract points</option><option value="set">Set exact values</option></select>
            </label>
            <div v-for="key in TRAITS" :key="key" class="species-trait-row">
              <label class="picker-row"><input v-model="checked" type="checkbox" :value="key">{{ SPECIES_TRAIT_LABELS[key] }}</label>
              <input v-if="checked.includes(key)" v-model.number="values[key]" type="number" :aria-label="SPECIES_TRAIT_LABELS[key] + ' value'"
                :min="traitMode === 'adjust' ? -MAX_TRAIT_CHANGE : key === 'sense' ? 0 : 0.01" :max="MAX_TRAIT_CHANGE" step="0.01">
            </div>
          </fieldset>
        </template>
      </fieldset>
      <p v-if="lab.traitAdjustmentError" role="alert" class="issue">{{ lab.traitAdjustmentError }}</p>
      <p v-else-if="lab.adjustingTraits || !lab.canAdjustSpecies" role="status">{{ lab.adjustingTraits ? 'Applying changes…' : 'Confirming the paused tick…' }}</p>
      <p v-else-if="issue" role="status" class="quiet">{{ issue }}</p>
      <div v-else-if="action" class="trait-preview">
        <strong>{{ total }} {{ total === 1 ? 'blob' : 'blobs' }} · Day {{ frame.day }} at {{ format(frame.time) }} s</strong>
        <details v-if="nextIds.length">
          <summary>{{ nextIds.length === 1 ? '#' + nextIds[0] : 'View ' + nextIds.length + ' creature IDs' }}</summary>
          <p class="species-id-list">{{ nextIds.map(id => '#' + id).join(', ') }}</p>
        </details>
        <p v-if="preview.length" class="quiet">
          {{ preview.map(([key, min, max]) => SPECIES_TRAIT_LABELS[key] + ' ' + format(min) + (min === max ? '' : '–' + format(max))).join(' · ') }}
        </p>
      </div>
      <footer>
        <button type="button" class="secondary" :disabled="lab.adjustingTraits" @click="close">Cancel</button>
        <button type="submit" class="primary" :disabled="!lab.canAdjustSpecies || !action || !!issue">Apply changes</button>
      </footer>
    </form>
  </dialog>
</template>
