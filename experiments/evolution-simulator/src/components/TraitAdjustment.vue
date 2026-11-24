<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useLab } from '../store.js'
import { rulesFor, TRAITS } from '../engine/config.js'
import { format } from '../engine/stats.js'
import { adjustedTrait, MAX_TRAIT_CHANGE, traitAdjustmentGroup, validTraitChange } from '../engine/trait-adjustments.js'

const lab = useLab()
const dialog = ref()
const labels = { speed: 'Speed', size: 'Size', sense: 'Sense range' }
const amounts = reactive({ speed: '0', size: '0', sense: '0' })
const speciesId = ref(null)
const activity = ref('any')
const group = computed(() => ({ speciesId: speciesId.value, activity: activity.value }))
const scoped = computed(() => speciesId.value !== null || activity.value !== 'any')
const living = computed(() => lab.frame?.blobs.filter(blob => blob.alive) ?? [])
const matching = computed(() => scoped.value ? traitAdjustmentGroup(living.value, group.value) : living.value)
const rules = computed(() => rulesFor(lab.run.setup, lab.run.revisions, lab.frame?.day ?? lab.viewing))
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
          Species
          <select v-model="speciesId" autofocus :disabled="lab.adjustingTraits">
            <option :value="null">All species</option>
            <option v-for="species in rules.species.filter(species => species.enabled)" :key="species.id" :value="species.id">
              {{ species.name }}
            </option>
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
      <p id="trait-adjustment-help" class="quiet">Enter −{{ MAX_TRAIT_CHANGE }} to +{{ MAX_TRAIT_CHANGE }} points with up to two decimals. Each trait has a lower limit.</p>
      <label v-for="trait in TRAITS" :key="trait" class="dialog-field">
        {{ labels[trait] }}
        <input :value="amounts[trait]" type="number" :min="-MAX_TRAIT_CHANGE" :max="MAX_TRAIT_CHANGE" step="0.01"
          :disabled="lab.adjustingTraits"
          :aria-invalid="!validTraitChange(changes[trait]) || undefined" aria-describedby="trait-adjustment-help"
          @input="amounts[trait] = $event.target.value">
      </label>
      <p v-if="lab.canOpenTraitAdjustment && !matching.length" role="status">No living blobs match this group.</p>
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
.dialog-field input { width: min(7rem, 44%); text-align: right }
.trait-preview { border-top: 1px solid var(--line); padding-top: 12px; font-size: 14px }
.trait-preview dl { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; margin: 8px 0 0 }
.trait-preview dd { margin: 0; text-align: right; font: 13px var(--mono) }
</style>
