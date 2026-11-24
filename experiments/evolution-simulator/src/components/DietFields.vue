<script setup>
import { computed } from 'vue'

const diet = defineModel({ required: true })
const props = defineProps({
  eater: { type: Object, required: true },
  species: { type: Array, required: true },
  readonly: Boolean,
})
const prey = computed(() => [...props.species.filter(item => item.id !== props.eater.id), props.eater])
const empty = computed(() => !diet.value.plants &&
  (diet.value.hunt === 'none' || (diet.value.hunt === 'selected' && !diet.value.prey.length)))

function togglePrey(id, checked) {
  const next = new Set(diet.value.prey)
  if (checked) next.add(id)
  else next.delete(id)
  diet.value = { ...diet.value, prey: [...next] }
}
</script>

<template>
  <fieldset class="diet-fields" :disabled="readonly">
    <legend>Diet for {{ eater.name || 'new species' }}</legend>
    <label class="diet-check">
      <input type="checkbox" :checked="diet.plants" @change="diet = { ...diet, plants: $event.target.checked }"> Eats plants
    </label>
    <label class="dialog-field">Can hunt
      <select :value="diet.hunt" @change="diet = { ...diet, hunt: $event.target.value }">
        <option value="any">Any eligible species</option>
        <option value="selected">Selected species</option>
        <option value="none">None</option>
      </select>
    </label>
    <fieldset v-if="diet.hunt === 'selected'" class="diet-prey">
      <legend>Allowed prey</legend>
      <label v-for="item in prey" :key="item.id" class="diet-check">
        <input type="checkbox" :checked="diet.prey.includes(item.id)" @change="togglePrey(item.id, $event.target.checked)">
        <span class="diet-swatch" :style="{ backgroundColor: item.color }" aria-hidden="true"></span>
        {{ eater.id === item.id ? 'Own species' : item.name }}
      </label>
    </fieldset>
    <p v-if="empty" class="diet-warning" role="status">{{ eater.name || 'This species' }} has no food sources when this diet is active.</p>
  </fieldset>
</template>

<style>
.diet-fields, .diet-prey {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: .65rem 1.25rem;
  min-inline-size: 0;
  border: 1px solid #ffffff28;
  border-radius: .6rem;
  padding: .75rem 1rem 1rem;
}
.diet-fields legend, .diet-prey legend { padding-inline: .3rem; font-weight: 600; }
.diet-fields .dialog-field { margin: 0; }
.diet-check { display: inline-flex; align-items: center; gap: .45rem; }
.diet-prey { flex-basis: 100%; }
.diet-swatch { width: .7em; height: .7em; border-radius: 50%; border: 1px solid currentColor; }
.diet-warning { flex-basis: 100%; margin: 0; color: #ffbf79; }
</style>
