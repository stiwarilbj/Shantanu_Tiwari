<script setup>
import { computed, ref, watch } from 'vue'
import { dietFor, encounterResult, setDiet } from '../engine/food-web.js'
import { huntBlock } from '../engine/geometry.js'
import DietFields from './DietFields.vue'

const web = defineModel({ required: true })
const props = defineProps({
  rules: { type: Object, required: true },
  species: { type: Array, required: true },
  startingDay: { type: Number, default: 1 },
  readonly: Boolean,
})
const eaterId = ref(props.species[0]?.id ?? '')
const targetId = ref('')
const day = ref(props.startingDay)
const eaterSize = ref(10), preySize = ref(10)
const eater = computed(() => props.species.find(item => item.id === eaterId.value) ?? props.species[0])
const prey = computed(() => props.species.find(item => item.id === targetId.value))
watch(eater, species => {
  eaterId.value = species?.id ?? ''
  eaterSize.value = species?.size ?? 10
}, { immediate: true })
watch(prey, species => { preySize.value = species?.size ?? 10 }, { immediate: true })

const diet = computed({
  get: () => dietFor(web.value, eater.value.id),
  set: next => { web.value = setDiet(web.value, eater.value.id, next) },
})
const result = computed(() => {
  if (!eater.value) return ''
  if (!Number.isInteger(day.value) || day.value < 1 || day.value > props.rules.days) return 'Enter a generation within the run limit.'
  if (prey.value && [eaterSize.value, preySize.value].some(size => !Number.isFinite(size) || size <= 0)) {
    return 'Enter sizes greater than zero.'
  }
  const hunter = { ...eater.value, id: 1, species: eater.value.id, size: eaterSize.value }
  const target = prey.value && { ...prey.value, id: 2, species: prey.value.id, size: preySize.value }
  return encounterResult({ ...props.rules, foodWeb: web.value }, hunter, target, day.value, huntBlock)
})
</script>

<template>
  <div class="food-web-settings">
    <label class="diet-check">
      <input type="checkbox" role="switch" :checked="web.enabled" :disabled="readonly"
        @change="web = { ...web, enabled: $event.target.checked }"> Enable species food web
    </label>
    <p class="quiet">{{ web.enabled ? 'Each species uses its own diet. Field hunting rules still apply.' :
      'Creatures use the usual feeding rules. Your custom diets are saved for later.' }}</p>
    <template v-if="eater">
      <label class="dialog-field food-web-eater">
        <span><span class="diet-swatch" :style="{ backgroundColor: eater.color }" aria-hidden="true"></span> Eating species</span>
        <select v-model="eaterId">
          <option value="" disabled>Choose a species</option>
          <option v-for="item in species" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </label>
      <DietFields v-model="diet" :eater="eater" :species="species" :readonly="readonly"/>
      <fieldset class="diet-fields">
        <legend>Test an encounter</legend>
        <label class="dialog-field">Food source
          <select v-model="targetId">
            <option value="">Plant</option>
            <option v-for="item in species" :key="item.id" :value="item.id">{{ item.name }}{{ item.id === eater.id ? ' (same species)' : '' }}</option>
          </select>
        </label>
        <label class="dialog-field">Generation
          <input v-model.number="day" type="number" min="1" :max="rules.days" step="1">
        </label>
        <template v-if="prey">
          <label class="dialog-field">Hunter size <input v-model.number="eaterSize" type="number" min="0.01" step="any"></label>
          <label class="dialog-field">Prey size <input v-model.number="preySize" type="number" min="0.01" step="any"></label>
        </template>
        <p class="food-web-result" role="status">{{ result }}</p>
      </fieldset>
    </template>
  </div>
</template>

<style>
.food-web-settings { display: flex; flex-direction: column; align-items: flex-start; gap: .8rem; }
.food-web-settings > p, .food-web-settings > .dialog-field { margin: 0; }
.food-web-settings > fieldset { width: 100%; box-sizing: border-box; }
.food-web-eater .diet-swatch { display: inline-block; margin-inline-end: .25rem; }
.food-web-settings select { max-width: 100%; }
.food-web-settings .diet-fields input[type="number"] { width: 7rem; max-width: 100%; }
.food-web-result { margin: 0; flex-basis: 100%; }
</style>
