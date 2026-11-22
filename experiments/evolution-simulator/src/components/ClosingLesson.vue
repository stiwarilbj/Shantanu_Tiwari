<script setup>
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { ArrowRight, Dices, Sprout } from 'lucide-vue-next'
import { useLab } from '../store.js'
import { guideSource } from '../guide-replay.js'
import { trackFrame } from '../track.js'
import Board from './Board.vue'

defineProps({ title: String, text: String })
const emit = defineEmits(['try', 'world'])
const lab = useLab()
const source = guideSource('starter')
const frame = shallowRef(null)
const error = ref(false)
let stopped = false

async function load() {
  error.value = false
  try {
    const track = await lab.getTrack(source, 1)
    if (!stopped) frame.value = trackFrame(track, 1.4)
  } catch {
    if (!stopped) error.value = true
  }
}
onMounted(load)
onBeforeUnmount(() => { stopped = true })
</script>

<template>
  <section class="closing-lesson" aria-labelledby="closing-title">
    <header class="closing-heading">
      <span>Final chapter</span>
      <h3 id="closing-title" tabindex="-1">{{ title }}</h3>
      <p>{{ text }}</p>
    </header>
    <div class="closing-stage">
      <figure class="closing-figure">
        <div class="closing-board" :aria-busy="!frame && !error">
          <div v-if="frame" class="closing-field" inert aria-hidden="true">
            <Board :frame="frame" :species="source.setup.species" camera="board" scope="all" quality="efficient" tabletop centered-field/>
          </div>
          <div v-else class="closing-board-status">
            <p role="status">{{ error ? 'The field preview could not load' : 'Getting the field ready…' }}</p>
            <button v-if="error" class="secondary" @click="load">Retry preview</button>
          </div>
        </div>
        <figcaption>
          <span>Starter field · Day 1 · 1.4 s</span>
          <span class="closing-key"><span>Blobs</span><span>Plants</span></span>
        </figcaption>
      </figure>
      <div class="closing-actions">
        <h4>Change one thing</h4>
        <p>Start from your current run’s settings</p>
        <button class="closing-choice closing-seed" @click="emit('try', 'seed', $event.currentTarget)">
          <Dices :size="21" aria-hidden="true"/><span><strong>Try another seed</strong><small>Change the starting layout</small></span>
          <ArrowRight :size="16" aria-hidden="true"/>
        </button>
        <button class="closing-choice closing-food" @click="emit('try', 'food', $event.currentTarget)">
          <Sprout :size="21" aria-hidden="true"/><span><strong>Change the food supply</strong><small>Set how many plants are available</small></span>
          <ArrowRight :size="16" aria-hidden="true"/>
        </button>
        <button class="link closing-world" @click="emit('world')">Back to World <ArrowRight :size="14" aria-hidden="true"/></button>
      </div>
    </div>
  </section>
</template>
