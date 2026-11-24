<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useLab } from '../store.js'
import { rulesFor, TRAITS } from '../engine/config.js'
import { speciesWithEdits } from '../engine/species-actions.js'
import { format } from '../engine/stats.js'
import { adjustedTrait, MAX_TRAIT_CHANGE, traitAdjustmentGroup, validTraitChange } from '../engine/trait-adjustments.js'

const lab = useLab()
const dialog = ref()
const labels = { speed: 'Speed', size: 'Size', sense: 'Sense range' }
const amounts = reactive({ speed: '0', size: '0', sense: '0' })
const groupChoice = ref('all')
const activity = ref('any')
const selectedSpecies = ref([])
const selectedBlobs = ref([])
const blobSearch = ref('')
const showSelected = ref(false)
const blobResultLimit = 20
const multipleSpecies = computed(() => groupChoice.value === 'multiple')
const individualBlobs = computed(() => groupChoice.value === 'individuals')
const group = computed(() => ({
  activity: activity.value,
  speciesIds: multipleSpecies.value ? [...selectedSpecies.value] :
    groupChoice.value.startsWith('species:') ? [groupChoice.value.slice('species:'.length)] : null,
  creatureIds: individualBlobs.value ? [...selectedBlobs.value] : null,
}))
const scoped = computed(() => groupChoice.value !== 'all' || activity.value !== 'any')
const living = computed(() => lab.frame?.blobs.filter(blob => blob.alive) ?? [])
const matching = computed(() => scoped.value ? traitAdjustmentGroup(living.value, group.value) : living.value)
const rules = computed(() => rulesFor(lab.run.setup, lab.run.revisions, lab.frame?.day ?? lab.viewing))
const species = computed(() => speciesWithEdits(rules.value.species, lab.frame?.speciesEdits).filter(item => item.enabled))
const speciesNames = computed(() => new Map(species.value.map(item => [item.id, item.name])))
const blobResults = computed(() => {
  const query = blobSearch.value.trim().toLowerCase()
  const picked = showSelected.value ? new Set(selectedBlobs.value) : null
  return living.value.filter(blob => (!picked || picked.has(blob.id)) &&
    (!query || `#${blob.id} · ${speciesNames.value.get(blob.species)}`.toLowerCase().includes(query)))
})
const changes = computed(() => Object.fromEntries(TRAITS.map(trait => [
  trait, amounts[trait] === '' ? Number.NaN : Number(amounts[trait]),
])))
const valid = computed(() => TRAITS.every(trait => validTraitChange(changes.value[trait])))
const preview = computed(() => {
  if (!valid.value || !matching.value.length) return null
  const means = Object.fromEntries(TRAITS.map(trait => [trait, { before: 0, after: 0 }]))
  let affected = 0
  for (const blob of matching.value) {
    let changed = false
    for (const trait of TRAITS) {
      const after = adjustedTrait(blob, trait, changes.value[trait], rules.value)
      means[trait].before += blob[trait]
      means[trait].after += after
      changed ||= after !== blob[trait]
    }
    if (changed) affected++
  }
  return { means, affected }
})
const mean = total => format(total / matching.value.length)

function toggleSelectedOnly(event) {
  showSelected.value = event.target.checked
  if (showSelected.value) blobSearch.value = ''
}

function close() {
  if (!lab.adjustingTraits) lab.modal = null
}

function apply() {
  if (preview.value?.affected) lab.adjustTraits(changes.value, group.value)
}

onMounted(() => dialog.value.showModal())
</script>

<template>
  <dialog ref="dialog" class="task-dialog trait-dialog" aria-labelledby="trait-adjustment-title" @cancel.prevent="close">
    <header><h2 id="trait-adjustment-title">Adjust living traits</h2></header>
    <p v-if="lab.frame">Day {{ lab.frame.day }} · {{ format(lab.frame.time) }} s · {{ living.length }} living</p>
    <p class="quiet">Survivors keep the new values and can pass them on under your usual inheritance rules.</p>
    <form novalidate @submit.prevent="apply">
      <div class="target-group">
        <label>
          Group
          <select v-model="groupChoice" autofocus :disabled="lab.adjustingTraits">
            <option value="all">All species</option>
            <optgroup label="One species">
              <option v-for="item in species" :key="item.id" :value="'species:' + item.id">{{ item.name }}</option>
            </optgroup>
            <optgroup label="Custom group">
              <option value="multiple">Multiple species</option>
              <option value="individuals">Individual blobs</option>
            </optgroup>
          </select>
        </label>
        <label>
          Activity
          <select v-model="activity" :disabled="lab.adjustingTraits">
            <option value="any">Any activity</option>
            <option value="active">Active in field</option>
            <option value="home">Settled in refuge</option>
          </select>
        </label>
      </div>
      <fieldset v-if="multipleSpecies" class="group-picker" :disabled="lab.adjustingTraits">
        <legend>Choose species</legend>
        <div class="picker-rows">
          <label v-for="item in species" :key="item.id" class="picker-row">
            <input v-model="selectedSpecies" type="checkbox" :value="item.id">
            {{ item.name }}
          </label>
        </div>
      </fieldset>
      <fieldset v-if="individualBlobs" class="group-picker" :disabled="lab.adjustingTraits">
        <legend>Choose living blobs</legend>
        <label class="blob-search">
          Find by ID or species
          <input v-model="blobSearch" type="search" placeholder="e.g. #51 or Orange" @keydown.enter.prevent>
        </label>
        <div class="picker-toolbar">
          <label class="picker-row">
            <input :checked="showSelected" type="checkbox" @change="toggleSelectedOnly">
            Selected only
          </label>
          <span>{{ selectedBlobs.length }} selected</span>
        </div>
        <div v-if="blobResults.length" class="picker-rows">
          <label v-for="blob in blobResults.slice(0, blobResultLimit)" :key="blob.id" class="picker-row">
            <input v-model="selectedBlobs" type="checkbox" :value="blob.id">
            <span>#{{ blob.id }} · {{ speciesNames.get(blob.species) }}</span>
            <small>{{ blob.home ? 'In refuge' : 'Active' }}</small>
          </label>
        </div>
        <p v-else class="quiet picker-note">No blobs to show.</p>
        <p v-if="blobResults.length > blobResultLimit" class="quiet picker-note">Showing {{ blobResultLimit }} of {{ blobResults.length }}. Search to narrow the list.</p>
      </fieldset>
      <p id="trait-adjustment-help" class="quiet">Enter −{{ MAX_TRAIT_CHANGE }} to +{{ MAX_TRAIT_CHANGE }} points with up to two decimals. Each trait has a lower limit.</p>
      <label v-for="trait in TRAITS" :key="trait" class="dialog-field">
        {{ labels[trait] }}
        <input :value="amounts[trait]" type="number" :min="-MAX_TRAIT_CHANGE" :max="MAX_TRAIT_CHANGE" step="0.01"
          :disabled="lab.adjustingTraits"
          :aria-invalid="!validTraitChange(changes[trait]) || undefined" aria-describedby="trait-adjustment-help"
          @input="amounts[trait] = $event.target.value">
      </label>
      <p v-if="lab.canOpenTraitAdjustment && !matching.length" role="status">
        {{ multipleSpecies && !selectedSpecies.length ? 'Choose at least one species.' :
          individualBlobs && !selectedBlobs.length ? 'Choose at least one blob.' : 'No living blobs match this group.' }}
      </p>
      <div v-else-if="preview && lab.canOpenTraitAdjustment" class="trait-preview">
        <strong role="status">{{ preview.affected }} of {{ matching.length }} {{ scoped ? 'matching' : 'living' }} blobs will change</strong>
        <dl aria-label="Average traits before and after">
          <template v-for="trait in TRAITS" :key="trait">
            <dt>{{ labels[trait] }} average</dt>
            <dd>{{ mean(preview.means[trait].before) }} → {{ mean(preview.means[trait].after) }}</dd>
          </template>
        </dl>
      </div>
      <p v-if="lab.traitAdjustmentError" role="alert">{{ lab.traitAdjustmentError }}</p>
      <p v-else-if="!lab.canOpenTraitAdjustment" role="status">Adjustments are available during an unfinished live generation with living blobs.</p>
      <footer>
        <button type="button" class="secondary" :disabled="lab.adjustingTraits" @click="close">Cancel</button>
        <button type="submit" class="primary" :disabled="!lab.canAdjustTraits || !preview?.affected">
          {{ lab.adjustingTraits ? 'Saving adjustment…' : 'Apply adjustment' }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.target-group { display: flex; gap: 12px }
.target-group label { flex: 1; min-width: 0; color: var(--muted); font-size: 15px }
.target-group select { display: block; width: 100%; margin-top: 4px }
.group-picker { min-width: 0; margin: 12px 0 0; padding: 4px 10px 8px; border: 1px solid var(--line); border-radius: 6px; font-size: 14px }
.group-picker legend { padding-inline: 4px; color: var(--muted) }
.blob-search input { display: block; width: 100%; margin-top: 4px }
.picker-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-block: 4px; color: var(--muted) }
.picker-rows { max-height: 9rem; overflow-y: auto }
.picker-row { display: flex; align-items: center; gap: 8px; min-height: 36px; padding-inline: 3px; overflow-wrap: anywhere; cursor: pointer }
.picker-row input { flex: none }
.picker-row small { margin-inline-start: auto; white-space: nowrap; color: var(--muted) }
.group-picker .picker-note { margin-block: 5px 0 }
.dialog-field input { width: min(7rem, 44%); text-align: right }
.trait-preview { border-top: 1px solid var(--line); padding-top: 12px; font-size: 14px }
.trait-preview dl { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; margin: 8px 0 0 }
.trait-preview dd { margin: 0; text-align: right; font: 13px var(--mono) }
</style>
