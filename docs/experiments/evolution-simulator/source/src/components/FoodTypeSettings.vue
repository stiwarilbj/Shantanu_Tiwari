<script setup>
import { computed, ref } from 'vue'
import { plantsForDay } from '../engine/config.js'
import { canEatPlants } from '../engine/food-web.js'
import { DEFAULT_PLANT_FOODS, PLANT_FOOD_TYPES, plantDietFor, plantFoodCounts, validFoodWeight } from '../engine/plant-food.js'

const foods = defineModel({ required: true })
const props = defineProps({
  rules: { type: Object, required: true },
  species: { type: Array, required: true },
  day: { type: Number, required: true },
})
const eaterId = ref(props.species.find(item => item.enabled)?.id ?? props.species[0]?.id)
const eater = computed(() => props.species.find(item => item.id === eaterId.value) ?? props.species[0])
const allowed = computed(() => eater.value ? plantDietFor(foods.value, eater.value.id) : [])
const validWeights = computed(() => foods.value.weights.every(validFoodWeight))
const total = computed(() => {
  const count = plantsForDay(props.rules, props.day)
  return Number.isInteger(count) && count >= 0 ? count : null
})
const portion = computed(() => validWeights.value && total.value !== null ? plantFoodCounts(foods.value.weights, total.value) : null)
const effectiveRules = computed(() => ({ ...props.rules, plantFoods: foods.value }))

function enable(enabled) {
  const weights = enabled ? foods.value.weights : foods.value.weights.map((value, index) =>
    validFoodWeight(value) ? value : DEFAULT_PLANT_FOODS.weights[index])
  foods.value = { ...foods.value, enabled, weights }
}

function changeWeight(index, input) {
  const weights = foods.value.weights.slice()
  weights[index] = input.value === '' ? '' : input.valueAsNumber
  foods.value = { ...foods.value, weights }
}

function changeDiet(id, checked) {
  const types = PLANT_FOOD_TYPES.filter(type => type.id === id ? checked : allowed.value.includes(type.id)).map(type => type.id)
  const diets = { ...foods.value.diets, [eater.value.id]: types }
  if (types.length === PLANT_FOOD_TYPES.length) delete diets[eater.value.id]
  foods.value = { ...foods.value, diets }
}
</script>

<template>
  <div class="advanced-block">
    <h3>Food types</h3>
    <label class="advanced-toggle">
      <input id="plantFoods" type="checkbox" role="switch" :checked="foods.enabled"
        @change="enable($event.target.checked)">
      Enable food types
    </label>
    <p class="quiet">Split the daily plant supply into seeds, berries, and mushrooms. Each gives the usual plant meal and energy reward.</p>
    <p v-if="!foods.enabled" class="quiet">The field uses one food type while this is off. Your weights and diets are kept.</p>

    <fieldset v-if="foods.enabled" class="food-type-fields">
      <legend>Food mix</legend>
      <p class="quiet">Higher weights spawn more of that food. A weight of zero stops it from spawning.</p>
      <div v-for="(type, index) of PLANT_FOOD_TYPES" :key="type.id" class="food-type-row">
        <label class="advanced-select">
          <span><i class="food-type-swatch" :style="{ backgroundColor: type.color }" aria-hidden="true"></i>{{ type.label }} weight</span>
          <input type="number" min="0" max="100" step="1" :value="foods.weights[index]"
            :aria-invalid="!validFoodWeight(foods.weights[index]) || undefined"
            :aria-describedby="!validFoodWeight(foods.weights[index]) ? 'food-type-weight-error' : undefined"
            @input="changeWeight(index, $event.target)">
        </label>
        <small v-if="portion" class="quiet">{{ portion[index] }} on Day {{ day }}</small>
      </div>
      <p v-if="!validWeights" id="food-type-weight-error" class="issue">Enter whole weights from 0 to 100.</p>
      <p v-else-if="!foods.weights.some(Boolean)" class="issue" role="status">Give at least one food a positive weight.</p>
    </fieldset>

    <fieldset v-if="foods.enabled && eater" class="food-type-fields">
      <legend>Species diets</legend>
      <label class="advanced-select">Species
        <select v-model="eaterId">
          <option v-for="item in species" :key="item.id" :value="item.id">{{ item.name }}{{ item.enabled ? '' : ' (Off)' }}</option>
        </select>
      </label>
      <label v-for="type of PLANT_FOOD_TYPES" :key="type.id" class="advanced-toggle">
        <input type="checkbox" :checked="allowed.includes(type.id)" @change="changeDiet(type.id, $event.target.checked)">
        <i class="food-type-swatch" :style="{ backgroundColor: type.color }" aria-hidden="true"></i>{{ type.label }}
      </label>
      <p v-if="!canEatPlants({ species: eater.id }, effectiveRules)" class="quiet" role="status">The Species food web disables plants for this species.</p>
      <p v-else-if="!allowed.some(id => foods.weights[PLANT_FOOD_TYPES.findIndex(type => type.id === id)] > 0)" class="quiet" role="status">
        This species has no plant food in the mix. Its hunting rules still apply.
      </p>
    </fieldset>
  </div>
</template>

<style scoped>
.food-type-fields { display: grid; gap: .6rem; min-inline-size: 0; margin: .4rem 0 0; padding: .65rem; border: 1px solid var(--subtle); border-radius: 5px; }
.food-type-fields legend { padding-inline: .3rem; }
.food-type-fields p, .food-type-fields label { margin: 0; }
.food-type-fields select { max-inline-size: 100%; }
.food-type-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .35rem .9rem; }
.food-type-row label { flex: 1 0 10rem; }
.food-type-row input[type="number"] { inline-size: 5rem; }
.food-type-swatch { display: inline-block; width: .7rem; height: .7rem; border-radius: 50%; margin-inline-end: .4rem; }
</style>
