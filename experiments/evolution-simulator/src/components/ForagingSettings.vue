<script setup>
import { computed, ref } from 'vue'
import { FORAGING_DEFAULTS, FORAGING_FIELDS, usesForagingDecisionRules, usesOptionalRules,
  usesRefugeBorder, usesStandardDeviation } from '../engine/config.js'
import { canPursuePrey, keepsMeal, mealFitsBudget, remembersPlant, returnReserve, shouldReturn,
  shouldReturnWithoutMeal, timeSavedPercent } from '../engine/foraging-decisions.js'
import { DT, WALKTHROUGH_STEP } from '../engine/geometry.js'
import NumberField from './NumberField.vue'

const { draft, issue } = defineProps({ draft:Object, issue:Object })
const speciesId = defineModel('species')
const mode = defineModel('mode')
const selected = computed(() => draft.species.find(species => species.id === speciesId.value))
const customDecisions = computed(() => draft.advanced?.customForaging !== false)
const inherited = computed(() => !!selected.value && !selected.value.foragingDecisions)
const settings = computed(() => selected.value?.foragingDecisions ?? draft.foragingDecisions)
const prefix = computed(() => selected.value ? selected.value.id + '.foragingDecisions.' : 'foragingDecisions.')
const stepSeconds = computed(() => draft.metabolism === 'walkthrough' ? WALKTHROUGH_STEP : DT)
const reserveLabel = computed(() => {
  const margin = settings.value?.returnMargin
  if (!Number.isInteger(margin) || margin < 0 || margin > 20) return ''
  return returnReserve(settings.value, stepSeconds.value).toFixed(2) + ' s in reserve with this energy model.'
})
const scenario = ref('memory')

function useCustomDecisions(event) {
  draft.advanced.customForaging = event.target.checked
  delete issue['advanced.customForaging']
  if (!event.target.checked) {
    for (const key of Object.keys(issue)) {
      if (key.includes('foragingDecisions.')) delete issue[key]
    }
  }
}

function customize(event) {
  if (event.target.checked) selected.value.foragingDecisions = { ...draft.foragingDecisions }
  else delete selected.value.foragingDecisions
}

const preview = computed(() => {
  const rules = customDecisions.value ? settings.value : FORAGING_DEFAULTS
  if (!rules || !FORAGING_FIELDS.every(({ key, min, max, step }) => {
    const value = rules[key]
    const scaled = value * (step === 0.1 ? 10 : 1)
    return Number.isFinite(value) && value >= min && value <= max && Math.abs(scaled - Math.round(scaled)) < 1e-9
  })) return { result:'Enter valid foraging settings to see the decision.' }

  if (scenario.value === 'memory') {
    const elapsed = 0.7
    const remembers = remembersPlant(elapsed, rules.plantMemory)
    return {
      numbers:'Plant last seen 0.7 s ago',
      result:remembers ? 'Pursue the remembered plant' : 'Search for another meal',
      explanation:rules.plantMemory === 0 ? 'This strategy drops a plant as soon as it leaves sight.' :
        `The plant was last seen ${remembers ? 'within' : 'beyond'} the ${rules.plantMemory} s memory window.`,
    }
  }
  if (scenario.value === 'switch') {
    const current = 4, closer = 3.4
    const keeps = keepsMeal(current, closer, rules.switchSavings)
    return {
      numbers:`Current meal 4 s · Other meal 3.4 s · ${timeSavedPercent(current, closer).toFixed(0)}% less travel time`,
      result:keeps ? 'Keep the current meal' : 'Switch to the quicker meal',
      explanation:`Switching requires a saving greater than ${rules.switchSavings}% of the current trip.`,
    }
  }
  if (scenario.value === 'return') {
    const left = 1.2, homeNow = .25, toMeal = .6, mealToHome = .35
    const reserve = returnReserve(rules, stepSeconds.value)
    const goHome = shouldReturn(left, homeNow, reserve)
    const canEat = !goHome && mealFitsBudget(toMeal, mealToHome, left - reserve)
    const returnNow = goHome || (!canEat && shouldReturnWithoutMeal(left, homeNow, reserve))
    return {
      numbers:`1 food credit · 1.2 s left · 0.25 s straight home · 0.95 s via the meal · ${reserve.toFixed(2)} s in reserve`,
      result:canEat ? 'Go for another meal' : returnNow ? 'Return to the refuge' : 'Keep looking nearby',
      explanation:canEat ? 'The trip via the meal fits with the safety margin.' :
        goHome ? 'The time left has reached the return time plus the safety margin.' :
        'The trip via the meal would use time kept in reserve.',
    }
  }
  const intercept = 1.2
  const canPursue = canPursuePrey(intercept, rules.preyPursuit)
  return {
    numbers:'Estimated intercept 1.2 s',
    result:canPursue ? 'Pursue the prey' : 'Let the prey go',
    explanation:rules.preyPursuit === 0 ? 'Deliberate pursuit is turned off.' :
      `The chase ${canPursue ? 'fits within' : 'exceeds'} the ${rules.preyPursuit} s pursuit limit.`,
  }
})
</script>

<template>
  <div class="advanced-block">
    <h3>Foraging decisions</h3>
    <label v-if="usesStandardDeviation(draft)" class="advanced-select">Foraging rules
      <select v-model="mode"><option value="standard">Standard</option><option value="walkthrough">Video experiment</option></select>
    </label>
    <p v-if="mode === 'walkthrough'" class="quiet">
      Video experiment uses its own movement rules.
      {{ usesRefugeBorder(draft) ? 'Blobs turn in steps and start in the gray refuge.' :
        'Blobs turn in steps and start the next day where their parents reached the edge.' }}
      These settings and the preview apply when you use Standard.
    </p>
    <template v-if="usesForagingDecisionRules(draft)">
      <label v-if="usesOptionalRules(draft)" class="advanced-toggle">
        <input id="advanced.customForaging" type="checkbox" :checked="customDecisions" @change="useCustomDecisions">
        Use custom foraging decisions
      </label>
      <p v-if="!customDecisions" class="quiet">Standard runs use the built-in decision rules. Your field and species settings are saved.</p>
      <label class="advanced-select">Foraging decisions for
        <select v-model="speciesId">
          <option :value="null">Field default</option>
          <option v-for="species in draft.species" :key="species.id" :value="species.id">
            {{ species.name }}{{ species.enabled ? '' : ' (Off)' }}
          </option>
        </select>
      </label>
      <label v-if="selected" class="advanced-toggle">
        <input type="checkbox" :checked="!inherited" :disabled="!customDecisions" @change="customize"> Use custom settings
      </label>
      <p v-if="inherited" class="quiet">This species uses the field default.</p>
      <NumberField v-for="field in FORAGING_FIELDS" :key="prefix + field.key" :id="prefix + field.key"
        v-model="settings[field.key]" :label="field.label" :min="field.min" :max="field.max" :step="field.step"
        :disabled="inherited || !customDecisions" :error="inherited || !customDecisions ? undefined : issue[prefix + field.key]"/>
      <p v-if="customDecisions && reserveLabel" class="quiet">{{ reserveLabel }}</p>
      <p class="quiet">Set memory, switching threshold, reserve, or pursuit to 0 to remove that limit or behavior. Blobs can still hunt on contact with pursuit off.</p>
    </template>
    <p v-else class="quiet">This setup uses its original foraging decisions.</p>
  </div>
  <div v-if="usesForagingDecisionRules(draft)" class="advanced-block">
    <h3>Try a decision</h3>
    <label class="advanced-select">Situation
      <select v-model="scenario">
        <option value="memory">Plant leaves sight</option>
        <option value="switch">Quicker meal appears</option>
        <option value="return">One more meal or head home</option>
        <option value="pursuit">Prey pulls away</option>
      </select>
    </label>
    <div class="foraging-preview" role="status">
      <p v-if="preview.numbers" class="quiet">{{ preview.numbers }}</p>
      <strong>{{ preview.result }}</strong>
      <p v-if="preview.explanation" class="quiet">{{ preview.explanation }}</p>
    </div>
  </div>
</template>
