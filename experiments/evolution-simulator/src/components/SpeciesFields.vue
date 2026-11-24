<script setup>
import { computed } from 'vue'
import { TRAITS } from '../engine/config.js'
import { cost, travel } from '../engine/geometry.js'
import { SPECIES_PRESETS, SPECIES_TRAIT_LABELS } from '../engine/species-actions.js'
import NumberField from './NumberField.vue'

const props = defineProps({
  species: { type: Object, required: true },
  rules: { type: Object, required: true },
  issue: { type: Object, default: () => ({}) },
  starting: Boolean,
  presets: Boolean,
  live: Boolean,
})

const swatches = { speed: '#9A5A57', size: '#44877C', sense: '#468298' }
const endurance = computed(() => props.species.energy / cost(props.species, props.rules))
const readout = computed(() => TRAITS.every(key => props.species[key] >= 1) && Number.isFinite(endurance.value))
</script>

<template>
  <div class="species-fields">
    <div class="species-identity">
      <label>Name
        <input :id="species.id+'.name'" v-model="species.name" maxlength="30"
          :aria-invalid="!!issue[species.id+'.name'] || undefined">
      </label>
      <label>Color
        <input :id="species.id+'.color'" v-model="species.color" type="color"
          :aria-invalid="!!issue[species.id+'.color'] || undefined">
      </label>
      <label v-if="starting && !live" class="picker-row"><input v-model="species.enabled" type="checkbox"> Enabled</label>
    </div>
    <p v-if="issue[species.id+'.name'] || issue[species.id+'.color']" class="issue">
      {{ issue[species.id+'.name'] || issue[species.id+'.color'] }}
    </p>
    <template v-if="starting">
      <div v-if="presets" class="species-presets" role="group" aria-label="Starting trait presets">
        <button v-for="(values, name) in SPECIES_PRESETS" :key="name" type="button" class="secondary"
          :aria-pressed="TRAITS.every(key => species[key] === values[key])" @click="Object.assign(species, values)">
          {{ name }}
        </button>
      </div>
      <div class="species-starting-fields">
        <NumberField :id="species.id+'.count'" v-model="species.count" :label="live ? 'Blobs to introduce' : 'Founders'"
          :min="live ? 1 : 10" :max="1000" compact :error="issue[species.id+'.count']"/>
        <NumberField :id="species.id+'.energy'" v-model="species.energy" label="Energy"
          :min="10" :max="1000" :pace="100" tint="#8F8048" compact :error="issue[species.id+'.energy']"/>
        <NumberField v-for="key in TRAITS" :key="key" :id="species.id+'.'+key" v-model="species[key]"
          :label="SPECIES_TRAIT_LABELS[key]" :min="1" :max="100" :tint="swatches[key]" compact :error="issue[species.id+'.'+key]"/>
      </div>
      <small v-if="readout" class="quiet">
        {{ travel(species, rules).toFixed(0) }} units/s · {{ endurance.toFixed(1) }} s of movement on starting energy
      </small>
    </template>
  </div>
</template>
