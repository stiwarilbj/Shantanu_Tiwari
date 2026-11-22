<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { ChevronRight, Pause, Play, RotateCcw } from 'lucide-vue-next'
import { dawn, founders, snapshot } from '../engine/simulation.js'
import { distribution, format } from '../engine/stats.js'
import { sizePreviewSetup, SIZE_PREVIEW_DAYS } from '../experiments.js'
import { prepareExperiment, useLab } from '../store.js'
import { trackFrame } from '../track.js'
import Board from './Board.vue'

defineProps({ title: String, text: String })
const emit = defineEmits(['compare'])
const lab = useLab()
const setup = sizePreviewSetup()
const founder = setup.species[0]
const dawnFrame = snapshot(dawn(setup, 1, founders(setup)))
const run = shallowRef(null), track = shallowRef(null)
const preparing = ref(false), progress = ref(0), loading = ref(false), error = ref(''), notice = ref('')
const day = ref(1), shot = ref('field'), rate = ref(4), time = ref(0), playing = ref(false)
const startButton = ref(null), playButton = ref(null), cancelButton = ref(null), retryButton = ref(null)
const focusDay = 6
let preparation, request = 0, animation, previous
const lastDay = computed(() => run.value?.summaries.at(-1)?.day)
const milestoneDays = computed(() => [...new Set([1, Math.min(focusDay, lastDay.value), lastDay.value])])
const labels = { prey:'Catch prey', plant:'Eat a plant', home:'Reach refuge' }

function subjects(replay) {
  if (replay?.day !== focusDay) return {}
  const candidates = replay.opening.flatMap(blob => {
    const events = replay.changes.get(blob.id) ?? []
    const meals = events.filter(event => event.type === 'plant' || event.type === 'prey')
    const home = events.find(event => event.type === 'home')
    return meals.length && home ? [{ blob, meals, home }] : []
  })
  const hunters = candidates.filter(item => item.meals[0].type === 'prey')
  const hunter = hunters.find(item => item.blob.id === 100) ?? hunters[0]
  const foragers = candidates.filter(item => item.meals.every(event => event.type === 'plant')
    && (!hunter || item.blob.size < hunter.blob.size))
  const forager = foragers.find(item => item.blob.id === 93) ?? foragers.reduce(
    (latest, item) => !latest || item.meals[0].time > latest.meals[0].time ? item : latest, null)
  return { hunter, forager }
}

const focusedSubjects = computed(() => subjects(track.value))
const subject = computed(() => focusedSubjects.value[shot.value])
const end = computed(() => subject.value?.home.time ?? track.value?.duration ?? 0)
const frame = computed(() => track.value ? trackFrame(track.value, time.value) : run.value ? null : dawnFrame)
const creature = computed(() => frame.value?.blobs.find(blob => blob.id === subject.value?.blob.id))
const events = computed(() => subject.value ? [...subject.value.meals, subject.value.home] : [])
const currentEvent = computed(() => events.value.findLast(event => event.time <= time.value))
const dawnSize = computed(() => track.value && distribution(track.value.opening.map(blob => blob.size)).mean)

function pause() {
  playing.value = false
  cancelAnimationFrame(animation)
}
function seek(seconds) {
  pause()
  time.value = Math.min(end.value, seconds)
}
function tick(now) {
  if (!playing.value) return
  const delta = previous ? Math.min(.1, (now - previous) / 1000) : 0
  previous = now
  time.value = Math.min(end.value, time.value + delta * rate.value)
  if (time.value < end.value) animation = requestAnimationFrame(tick)
  else pause()
}
function toggle() {
  if (playing.value) { pause(); return }
  if (time.value >= end.value) time.value = 0
  previous = 0
  playing.value = true
  animation = requestAnimationFrame(tick)
}
function chooseShot(value) {
  if (value === shot.value) return
  shot.value = value
  rate.value = value === 'field' ? 4 : 1
  seek(0)
}

async function loadDay(value) {
  if (loading.value && day.value === value) return

  const token = ++request
  day.value = value
  chooseShot('field')
  seek(0)
  error.value = ''
  loading.value = true
  track.value = null
  try {
    const replay = await lab.getTrack(run.value, value)
    if (token === request) track.value = replay
  } catch {
    if (token === request) error.value = 'This day could not load.'
  } finally {
    if (token === request) loading.value = false
  }
}

async function prepare() {
  const focused = document.activeElement === startButton.value
  const controller = new AbortController()
  preparation = controller
  preparing.value = true
  progress.value = 0
  error.value = ''
  notice.value = ''
  if (focused) nextTick(() => cancelButton.value?.focus())
  try {
    const preview = await prepareExperiment(setup, controller.signal, value => { progress.value = value })
    if (controller.signal.aborted) return
    run.value = preview
    if (lastDay.value < SIZE_PREVIEW_DAYS) notice.value = 'The last blobs died on Day ' + lastDay.value + '.'
    await loadDay(1)
  } catch {
    if (!controller.signal.aborted) error.value = 'The preview could not be prepared.'
  } finally {
    if (!controller.signal.aborted) {
      const active = document.activeElement
      const restoreFocus = focused && (active === document.body || active === cancelButton.value)
      preparing.value = false
      if (restoreFocus) {
        nextTick(() => (retryButton.value ?? playButton.value ?? startButton.value)?.focus())
      }
    }
  }
}
function cancel() {
  preparation.abort()
  preparing.value = false
  notice.value = 'Preview canceled.'
  nextTick(() => startButton.value?.focus())
}
function pauseWhenHidden() { if (document.hidden) pause() }
onMounted(() => document.addEventListener('visibilitychange', pauseWhenHidden))
onBeforeUnmount(() => {
  preparation?.abort()
  request++
  pause()
  document.removeEventListener('visibilitychange', pauseWhenHidden)
})
</script>

<template>
  <section class="size-preview" aria-labelledby="size-preview-title">
    <header class="size-preview-heading">
      <p class="size-preview-kicker">Experiment preview · {{ SIZE_PREVIEW_DAYS }} days</p>
      <h3 id="size-preview-title" tabindex="-1">{{ title }}</h3>
      <p>{{ text }}</p>
    </header>

    <div class="size-preview-stage">
      <div class="size-preview-player">
        <div class="size-preview-board" :aria-busy="loading">
          <div v-if="frame" class="size-preview-field" inert aria-hidden="true">
            <Board :frame="frame" :species="setup.species" :camera="subject ? 'close' : 'board'"
              :selected="subject?.blob.id" :follow="!!subject" :tabletop="!subject" :centered-field="!subject"
              :layers="subject ? { credits:true, energy:true, selected:true } : {}" quality="efficient" scope="all"/>
          </div>
          <div v-else class="stage-note">
            <p role="status">{{ error || 'Loading Day ' + day + '…' }}</p>
            <button v-if="error" ref="retryButton" class="secondary" @click="loadDay(day)">Retry Day {{ day }}</button>
          </div>
          <div class="size-preview-badge">
            <strong>Day {{ day }}</strong>
            <span>{{ subject ? 'Follow · Blob #' + subject.blob.id : 'Field view' }}</span>
          </div>
        </div>

        <div v-if="run" class="size-preview-controls">
          <div class="size-preview-transport">
            <button ref="playButton" class="icon" :aria-label="playing ? 'Pause preview' : 'Play preview'"
              :disabled="!track" @click="toggle">
              <Pause v-if="playing" :size="17"/><Play v-else :size="17"/>
            </button>
            <button class="icon" aria-label="Restart preview" :disabled="!track" @click="seek(0)"><RotateCcw :size="16"/></button>
            <input type="range" aria-label="Preview time" min="0" :max="end" step="0.001" :value="time" :disabled="!track"
              @input="seek($event.target.valueAsNumber)">
            <span class="size-preview-clock">{{ format(time,3) }} s / {{ format(end,3) }} s</span>
            <select v-model.number="rate" aria-label="Preview playback speed" :disabled="!track">
              <option :value="1">1×</option><option :value="4">4×</option>
            </select>
          </div>
          <div class="size-preview-moments">
            <div role="group" aria-label="Preview days">
              <button v-for="value in milestoneDays" :key="value" type="button" class="secondary"
                :aria-pressed="day===value" :aria-disabled="loading && day===value" @click="loadDay(value)">Day {{ value }}</button>
            </div>
            <div v-if="day===focusDay" role="group" aria-label="Preview cameras">
              <button type="button" class="secondary" :aria-pressed="shot==='field'" :disabled="!track" @click="chooseShot('field')">Field view</button>
              <button type="button" class="secondary" :aria-pressed="shot==='hunter'" :disabled="!focusedSubjects.hunter" @click="chooseShot('hunter')">Follow hunter</button>
              <button type="button" class="secondary" :aria-pressed="shot==='forager'" :disabled="!focusedSubjects.forager" @click="chooseShot('forager')">Follow forager</button>
            </div>
            <p v-if="track && day===focusDay && (!focusedSubjects.hunter || !focusedSubjects.forager)" class="size-preview-hint">
              A close-up is available when a matching blob finds food and reaches refuge in this replay.
            </p>
          </div>
        </div>
        <div v-else class="size-preview-poster">
          <span>Dawn · {{ dawnFrame.blobs.length }} founders</span><span>{{ setup.food }} plants</span>
        </div>
      </div>

      <aside class="size-preview-readout" :aria-label="subject ? 'Creature readout' : 'Preview setup'">
        <template v-if="subject">
          <h4>{{ shot==='hunter' ? 'Hunter' : 'Plant forager' }} <small>· Blob #{{ subject.blob.id }}</small></h4>
          <dl>
            <div><dt>Body size</dt><dd>{{ format(subject.blob.size,2) }}</dd></div>
            <div><dt>Energy now</dt><dd>{{ format(creature?.energy,1) }}</dd></div>
            <div><dt>Food credits</dt><dd>{{ creature?.credits ?? '—' }}</dd></div>
            <div><dt>Refuge</dt><dd>{{ creature?.home ? 'Home' : 'Outside' }}</dd></div>
          </dl>
          <p class="size-preview-hint">First meal at {{ format(subject.meals[0].time,3) }} s · Active for {{ format(subject.home.time,3) }} s</p>
          <h5>Recorded moments</h5>
          <button v-for="event in events" :key="event.time+'-'+event.type" class="size-preview-event"
            :data-reached="currentEvent===event" @click="seek(event.time)">
            <span>{{ labels[event.type] }}</span><span>{{ format(event.time,3) }} s</span>
          </button>
        </template>
        <template v-else>
          <h4>Run setup</h4>
          <dl>
            <div><dt>Random seed</dt><dd>{{ setup.seed }}</dd></div>
            <div><dt>Size spread (σ)</dt><dd>{{ format(founder.standardDeviation.size,2) }}</dd></div>
            <div><dt>Starting size</dt><dd>{{ founder.size }}</dd></div>
            <div><dt>Daily plants</dt><dd>{{ setup.food }}</dd></div>
          </dl>
          <p v-if="track" class="size-preview-hint">Day {{ day }} at dawn · {{ track.opening.length }} blobs<span v-if="dawnSize != null"> · Mean size {{ format(dawnSize,2) }}</span></p>
          <p v-else class="size-preview-hint">The spread controls how much a newborn’s size can vary from its parent’s size.</p>
          <button v-if="!run && !preparing" ref="startButton" class="primary" @click="prepare">{{ error ? 'Retry preview' : 'Prepare 100-day preview' }}</button>
          <div v-if="preparing && !run" class="size-preview-progress">
            <progress :value="progress" :max="SIZE_PREVIEW_DAYS" aria-label="100-day preview preparation"></progress>
            <span>Day {{ progress }} / {{ SIZE_PREVIEW_DAYS }}</span>
            <button ref="cancelButton" class="secondary" @click="cancel">Cancel</button>
          </div>
          <p v-if="error && !run" class="issue" role="status">{{ error }}</p>
          <p v-if="notice" class="quiet" role="status">{{ notice }}</p>
        </template>
      </aside>
    </div>

    <footer class="size-preview-footer">
      <p>Use the preview to watch individual blobs. Use the two longer runs to compare what happens to size over time.</p>
      <button class="secondary" @click="pause(); emit('compare')">Set up the 600-day comparison <ChevronRight :size="16"/></button>
    </footer>
  </section>
</template>
