<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useLab } from '../store.js'
import { rulesFor, TRAITS } from '../engine/config.js'
import { format } from '../engine/stats.js'
import { adjustedTrait, MAX_TRAIT_CHANGE, validTraitChange } from '../engine/trait-adjustments.js'

const lab = useLab()
const dialog = ref()
const labels = { speed: 'Speed', size: 'Size', sense: 'Sense range' }
const amounts = reactive({ speed: '0', size: '0', sense: '0' })
const living = computed(() => lab.frame?.blobs.filter(blob => blob.alive) ?? [])
const rules = computed(() => rulesFor(lab.run.setup, lab.run.revisions, lab.frame?.day ?? lab.viewing))
const changes = computed(() => Object.fromEntries(TRAITS.map(trait => [
  trait, amounts[trait] === '' ? Number.NaN : Number(amounts[trait]),
])))
const valid = computed(() => TRAITS.every(trait => validTraitChange(changes.value[trait])))
const preview = computed(() => {
  if (!valid.value || !living.value.length) return null
  const means = Object.fromEntries(TRAITS.map(trait => [trait, { before: 0, after: 0 }]))
  let affected = 0
  for (const blob of living.value) {
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
const mean = total => format(total / living.value.length)

function close() {
  if (!lab.adjustingTraits) lab.modal = null
}

function apply() {
  if (preview.value?.affected) lab.adjustTraits(changes.value)
}

onMounted(() => dialog.value.showModal())
</script>

<template>
  <dialog ref="dialog" class="task-dialog trait-dialog" aria-labelledby="trait-adjustment-title" @cancel.prevent="close">
    <header><h2 id="trait-adjustment-title">Adjust living traits</h2></header>
    <p v-if="lab.frame">Day {{ lab.frame.day }} · {{ format(lab.frame.time) }} s · {{ living.length }} living</p>
    <p class="quiet">Add or subtract points across all living blobs, including those in refuge. Survivors keep the new values, and their offspring inherit them under your usual rules.</p>
    <form novalidate @submit.prevent="apply">
      <p id="trait-adjustment-help" class="quiet">Enter −{{ MAX_TRAIT_CHANGE }} to +{{ MAX_TRAIT_CHANGE }} per trait, with up to two decimal places. A reduction may stop at a trait’s lower limit.</p>
      <label v-for="trait in TRAITS" :key="trait" class="dialog-field">
        {{ labels[trait] }}
        <input :value="amounts[trait]" type="number" :min="-MAX_TRAIT_CHANGE" :max="MAX_TRAIT_CHANGE" step="0.01"
          :autofocus="trait === 'speed'" :disabled="lab.adjustingTraits"
          :aria-invalid="!validTraitChange(changes[trait]) || undefined" aria-describedby="trait-adjustment-help"
          @input="amounts[trait] = $event.target.value">
      </label>
      <div v-if="preview && lab.canOpenTraitAdjustment" class="trait-preview">
        <strong>{{ preview.affected }} of {{ living.length }} living blobs will change</strong>
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
.dialog-field input { width: min(7rem, 44%); text-align: right }
.trait-preview { border-top: 1px solid var(--line); padding-top: 12px; font-size: 14px }
.trait-preview dl { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; margin: 8px 0 0 }
.trait-preview dd { margin: 0; text-align: right; font: 13px var(--mono) }
</style>
