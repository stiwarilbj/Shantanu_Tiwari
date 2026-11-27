<script setup>
import { computed } from 'vue'
import { AGING_FIELDS, usesOptionalRules, validate } from '../engine/config.js'
import { agingRules, lifespanReached, oldAgeRisk, travelSpeedPercent } from '../engine/aging.js'
import NumberField from './NumberField.vue'

const props = defineProps({ draft: { type:Object, required:true }, issue: { type:Object, required:true } })
const speciesId = defineModel('species')
const selected = computed(() => props.draft.species.find(species => species.id === speciesId.value))
const inherited = computed(() => !!selected.value && !selected.value.aging)
const rules = computed(() => agingRules(props.draft, selected.value))
const lifespanLimit = computed(() => rules.value.maxAge !== null && rules.value.maxAgeEnabled !== false)
const prefix = computed(() => selected.value ? selected.value.id + '.aging.' : 'aging.')

const previewAge = defineModel('previewAge')
const validPreview = computed(() => {
  const age = previewAge.value
  if (!Number.isInteger(age) || age < 0 || age > 1000) return false
  const effectivePrefix = inherited.value ? 'aging.' : prefix.value
  const errors = validate(props.draft)
  return !AGING_FIELDS.some(({ key }) => errors[effectivePrefix + key]) &&
    !['enabled', 'maxAge', 'maxAgeEnabled'].some(key => errors[effectivePrefix + key])
})
const percent = value => value.toLocaleString('en-US', { maximumFractionDigits:1 }) + '%'

function toggleLifespan(event) {
  if (event.target.checked) {
    delete rules.value.maxAgeEnabled
    rules.value.maxAge ??= 20
  } else if (usesOptionalRules(props.draft)) {
    rules.value.maxAgeEnabled = false
  } else {
    rules.value.maxAge = null
  }
}

function customize(event) {
  if (event.target.checked) selected.value.aging = { ...props.draft.aging }
  else delete selected.value.aging
}
</script>

<template>
  <div class="advanced-block">
    <h3>Aging and lifespan</h3>
    <label class="advanced-select">Aging rules for
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
    <p v-if="inherited" class="quiet">Uses the current field default. Turn on custom settings to edit this species separately.</p>
    <label class="advanced-toggle">
      <input :id="prefix+'enabled'" v-model="rules.enabled" type="checkbox" :disabled="inherited"> Enable aging
    </label>
    <NumberField v-for="field in AGING_FIELDS" :key="prefix+field.key" :id="prefix+field.key" v-model="rules[field.key]"
      :label="field.label" :min="field.min" :max="field.max" :step="field.step"
      :disabled="inherited || !rules.enabled" :error="inherited ? undefined : issue[prefix+field.key]"/>
    <p class="quiet">Risk rises by percentage points and is checked at dusk before breeding. Older blobs can move more slowly at the same energy cost.</p>
    <label class="advanced-toggle">
      <input :id="prefix+'maxAgeEnabled'" type="checkbox" :checked="lifespanLimit" :disabled="inherited || !rules.enabled"
        @change="toggleLifespan"> Set a maximum lifespan
    </label>
    <NumberField v-if="lifespanLimit" :key="prefix+'maxAge'" :id="prefix+'maxAge'" v-model="rules.maxAge"
      label="Maximum lifespan" :min="1" :max="1000" :disabled="inherited || !rules.enabled"
      :error="inherited ? undefined : issue[prefix+'maxAge']"/>
  </div>

  <div class="advanced-block">
    <h3>Age preview</h3>
    <NumberField id="aging-preview-age" v-model="previewAge" label="Preview age" :min="0" :max="1000" @keydown.enter.prevent/>
    <p class="quiet">This example uses the same age for speed and risk. During a run, blobs gain a year at dusk, before their risk is checked.</p>
    <div class="quiet" role="status">
      <p v-if="validPreview">
        Age {{ previewAge }} · {{ percent(travelSpeedPercent(rules, previewAge)) }} travel speed
        · {{ percent(oldAgeRisk(rules, previewAge)) }} old-age risk<span v-if="lifespanReached(rules, previewAge)"> (maximum lifespan reached)</span>
      </p>
      <p v-else>Enter a whole preview age from 0 to 1,000 and use valid aging settings.</p>
    </div>
  </div>
</template>
