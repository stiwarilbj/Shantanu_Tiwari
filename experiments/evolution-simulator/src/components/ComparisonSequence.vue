<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Pause, Play, RotateCcw, X } from 'lucide-vue-next'
import Board from './Board.vue'
import { useLab } from '../store.js'
import { trackFrame } from '../track.js'
import { format } from '../engine/stats.js'

const props = defineProps({ pair: { type: Object, required: true } })
const emit = defineEmits(['exit'])
const lab = useLab()
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const chapters = [
  { day: 6, side: 0, preferredId: 100, title: 'Early hunt', anchor: ['prey', 0.100], moments: ['prey', 'plant', 'home'] },
  { day: 52, side: 1, preferredId: 762, title: 'Plant foraging', anchor: ['plant', 6.900], moments: ['plant', 'home'] },
  { day: 77, side: 1, preferredId: 1072, title: 'Later hunt', anchor: ['prey', 1.500], moments: ['prey', 'home'] },
]
const momentLabels = { prey: 'Catch prey', plant: 'Eat a plant', home: 'Reach refuge' }
const stopButton = ref(null)
const scenes = shallowRef([])
const step = ref(0), elapsed = ref(0), playing = ref(false), finished = ref(false), error = ref('')
const prepared = computed(() => scenes.value.length > 0)
const scene = computed(() => scenes.value[step.value])
const activeFrame = computed(() => scene.value && trackFrame(scene.value.track, elapsed.value))
const parked = computed(() => prepared.value && [
  trackFrame(scenes.value[0].track, scenes.value[0].end),
  trackFrame(scenes.value[1].track, 0),
])
const sides = [props.pair.wide, props.pair.narrow]
const closeOnRight = computed(() => step.value === 1 && elapsed.value >= (scene.value.cues[0]?.time ?? Infinity) - 1.2)
const shots = computed(() => {
  if (!prepared.value) return []
  const right = scene.value.side === 1
  return [
    { day: 6, frame: right ? parked.value[0] : activeFrame.value, selected: scenes.value[0].id, follow: scenes.value[0].id != null },
    { day: right ? scene.value.day : 52, frame: right ? activeFrame.value : parked.value[1],
      selected: right ? scene.value.id : null, follow: right && scene.value.id != null && closeOnRight.value },
  ]
})

const subject = computed(() => activeFrame.value?.blobs.find(blob => blob.id === scene.value.id))
const currentCue = computed(() => scene.value?.cues.findLast(cue => cue.time <= elapsed.value))
const timeLabel = seconds => seconds.toFixed(3) + ' s'
const durationLabel = computed(() => timeLabel(scene.value.end))
const totals = computed(() => {
  if (!scene.value) return null
  return sides[scene.value.side].summaries[scene.value.day - 1].rows.all
})

let loading, animation, previous = 0, hold = 0
function pause() {
  playing.value = false
  cancelAnimationFrame(animation)
}
function selectChapter(index) {
  pause()
  step.value = index
  elapsed.value = 0
  hold = 0
  finished.value = false
}
function tick(now) {
  if (!playing.value) return
  const delta = previous ? Math.min(0.1, (now - previous) / 1000) : 0
  previous = now
  if (elapsed.value >= scene.value.end) hold += delta
  else elapsed.value = Math.min(scene.value.end, elapsed.value + delta)
  if (hold >= 1.4) {
    if (step.value === chapters.length - 1) {
      finished.value = true
      pause()
      return
    }
    step.value++
    elapsed.value = 0
    hold = 0
  }
  animation = requestAnimationFrame(tick)
}
function play() {
  if (finished.value) selectChapter(0)
  previous = 0
  playing.value = true
  animation = requestAnimationFrame(tick)
}
function seek(seconds) {
  pause()
  elapsed.value = Math.min(scene.value.end, Math.max(0, seconds))
  hold = 0
  finished.value = false
}
function changePosition(event) {
  seek(scene.value.end * event.target.valueAsNumber / 1000)
}

function findSubject(track, chapter) {
  const [anchor, preferredTime] = chapter.anchor
  let best, bestDistance = Infinity
  for (const blob of track.opening) {
    const events = track.changes.get(blob.id) ?? []
    const meal = events.find(event => event.type === anchor)
    if (!meal || (anchor === 'plant' && events.some(event => event.type === 'prey'))) continue
    const moments = chapter.moments
      .map(type => events.find(event => event.time >= meal.time && event.type === type))
      .filter(Boolean)
    const distance = Math.abs(meal.time - preferredTime) + (chapter.moments.length - moments.length) * track.duration
    const preferred = blob.id === chapter.preferredId && moments.length === chapter.moments.length
    if (!preferred && distance >= bestDistance) continue
    best = { id: blob.id, moments }
    bestDistance = distance
    if (preferred) break
  }
  return best
}

function selectObservation(track, chapter) {
  const anchor = chapter.anchor[0]
  const primary = findSubject(track, chapter)
  const alternative = !primary && anchor === 'prey' && findSubject(track, {
    anchor: ['plant', chapter.anchor[1]], moments: ['plant', 'home'],
  })
  const best = primary || alternative
  const cues = best?.moments.map(event => ({ label: momentLabels[event.type], time: event.time })) ?? []
  const settled = best?.moments.some(event => event.type === 'home')
  const secondMeal = best?.moments.some(event => event.type === 'plant')
  let description
  if (!best) description = 'Watch the recorded field. This day has no matching food event'
  else if (alternative) description = 'Watch a plant meal with the whole field in view. This day has no recorded hunt'
  else if (anchor === 'plant') description = settled
    ? 'Start with the whole field, then follow one blob as it finds a plant and heads home'
    : 'Start with the whole field, then follow one blob as it finds a plant'
  else if (chapter.side === 0) description = secondMeal && settled
    ? 'Follow one blob as it catches another blob, eats a plant, and gets back to the refuge'
    : 'Follow one blob as it catches another blob'
  else description = 'Watch a successful hunt in the narrow-mutation run with the whole field in view'
  return { ...chapter, track, id: best?.id ?? null, cues, description,
    title: primary ? chapter.title : 'Field view', end: Math.max(0.001, cues.at(-1)?.time ?? track.duration) }
}

async function load() {
  error.value = ''
  const controller = new AbortController()
  loading = controller
  try {
    const tracks = await Promise.all(chapters.map(({ day, side }) => lab.getTrack(sides[side], day)))
    if (controller.signal.aborted) return
    scenes.value = chapters.map((chapter, index) => selectObservation(tracks[index], chapter))
    if (!reduced.matches && !document.hidden) play()
  } catch (cause) {
    if (!controller.signal.aborted) error.value = 'Could not load the recorded scenes. ' + cause.message
  }
}

function handleKeys(event) {
  if (event.key === 'Escape' && !event.defaultPrevented) emit('exit')
}
function pauseWhenHidden() {
  if (document.hidden) pause()
}

onMounted(() => {
  stopButton.value.focus()
  window.addEventListener('keydown', handleKeys)
  document.addEventListener('visibilitychange', pauseWhenHidden)
  void load()
})
onBeforeUnmount(() => {
  loading?.abort()
  pause()
  window.removeEventListener('keydown', handleKeys)
  document.removeEventListener('visibilitychange', pauseWhenHidden)
})
</script>

<template>
  <Teleport to="#app">
    <section class="cinematic-sequence" aria-labelledby="sequence-title">
      <header class="sequence-header">
        <div>
          <h1 id="sequence-title">Size mutation replay</h1>
          <p>Seed {{ pair.wide.setup.seed }} <span aria-hidden="true">·</span> Wide and narrow mutation</p>
        </div>
        <button ref="stopButton" class="secondary sequence-close" @click="emit('exit')"><X :size="16" aria-hidden="true"/> <span>Stop video sequence</span></button>
      </header>
      <div v-if="!prepared" class="sequence-message" :aria-busy="!error">
        <p role="status">{{ error || 'Opening the three recorded days…' }}</p>
        <button v-if="error" class="secondary" @click="load">Retry scenes</button>
      </div>
      <template v-else>
        <div class="sequence-boards">
          <section v-for="(shot, index) in shots" :key="index" :aria-labelledby="'sequence-lane-' + index"
            :class="[index === 0 ? 'run-left' : 'run-right', { 'sequence-active': index === scene.side }]">
            <header>
              <h2 :id="'sequence-lane-' + index">{{ index === 0 ? 'Wide mutation' : 'Narrow mutation' }} <span>Day {{ shot.day }}</span></h2>
              <span class="sequence-camera">{{ shot.follow ? 'Close view' : 'Field view' }} <span>{{ timeLabel(shot.frame.time) }}</span></span>
            </header>
            <div class="sequence-field">
              <Board :frame="shot.frame" :species="sides[index].setup.species" :camera="shot.follow ? 'close' : 'board'"
                :selected="shot.selected" :follow="shot.follow" :layers="{ credits: true }" scope="all" quality="efficient" tabletop centered-field/>
            </div>
          </section>
        </div>
        <div class="sequence-console">
          <div class="sequence-chapters" role="group" aria-label="Replay chapters">
            <button v-for="(chapter, index) in scenes" :key="chapter.day" class="secondary"
              :class="chapter.side === 0 ? 'run-left' : 'run-right'" :aria-current="step === index ? 'step' : undefined" @click="selectChapter(index)">
              <span>Day {{ chapter.day }}</span> {{ chapter.title }}
            </button>
          </div>
          <div class="sequence-caption">
            <p role="status">{{ scene.description }}</p>
            <p class="sequence-totals">Day total <strong>{{ totals.plants }} plants</strong> <strong>{{ totals.hunts }} hunts</strong></p>
          </div>
          <div class="sequence-playback">
            <button class="icon" :aria-label="playing ? 'Pause sequence' : finished ? 'Replay sequence' : 'Play sequence'" @click="playing ? pause() : play()">
              <Pause v-if="playing" :size="18" aria-hidden="true"/><RotateCcw v-else-if="finished" :size="18" aria-hidden="true"/><Play v-else :size="18" aria-hidden="true"/>
            </button>
            <input type="range" min="0" max="1000" :value="elapsed / scene.end * 1000" aria-label="Scene progress"
              :aria-valuetext="timeLabel(elapsed) + ' of ' + durationLabel" @input="changePosition">
            <span class="sequence-clock">{{ timeLabel(elapsed) }} / {{ durationLabel }}</span>
          </div>
          <p v-if="subject" class="sequence-subject">
            <strong>Blob #{{ subject.id }}</strong>
            <span>{{ format(subject.energy, 1) }} energy</span>
            <span>{{ subject.credits }} food {{ subject.credits === 1 ? 'credit' : 'credits' }}</span>
            <span v-if="subject.home">At refuge</span>
          </p>
          <div class="sequence-actions">
            <div class="sequence-cues" role="group" aria-label="Recorded moments">
              <button v-for="cue in scene.cues" :key="cue.label" class="secondary"
                :aria-current="currentCue === cue ? 'true' : undefined" @click="seek(cue.time)">
                {{ cue.label }} <span>{{ timeLabel(cue.time) }}</span>
              </button>
            </div>
            <div class="sequence-jumps">
              <button class="secondary" @click="emit('exit', 'align')">Compare Day 52</button>
              <button class="secondary" @click="emit('exit', 'trends')">Size trends</button>
            </div>
          </div>
        </div>
      </template>
    </section>
  </Teleport>
</template>

<style scoped>
.cinematic-sequence {
  position: absolute;
  inset: 0;
  z-index: 12;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: clamp(8px, 1.35vw, 20px);
  overflow: auto;
  background: var(--stage);
}
.sequence-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 9px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: linear-gradient(115deg, #182C40, #101E2D 72%);
}
.sequence-header h1 { margin: 0; font-size: clamp(18px, 2vw, 27px); line-height: 1.12; }
.sequence-header p { margin: 3px 0 0; color: var(--muted); font-size: 13px; }
.sequence-close { flex: none; display: flex; align-items: center; gap: 6px; min-height: 36px; }
.sequence-message { display: grid; align-content: center; justify-items: center; flex: 1; color: var(--muted); }
.sequence-boards {
  flex: 1 0 200px;
  display: flex;
  min-height: 200px;
  gap: 10px;
}
.sequence-boards > section {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--dock);
}
.sequence-boards > .sequence-active { border-color: var(--run-color); }
.sequence-boards header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  flex-wrap: wrap;
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
  background: var(--input);
}
.sequence-active header { box-shadow: inset 3px 0 var(--run-color); }
.sequence-boards h2 {
  margin: 0;
  color: var(--ink);
  font-family: var(--sans);
  font-size: clamp(13px, 1.5vw, 18px);
}
.sequence-boards h2 span {
  margin-inline-start: 5px;
  color: var(--run-color);
  font-family: var(--mono);
}
.sequence-camera { color: var(--muted); font-size: 12px; }
.sequence-camera span { display: inline-block; min-width: 8ch; text-align: right; font-family: var(--mono); }
.sequence-field {
  position: relative;
  flex: 1;
  min-height: 0;
  opacity: .72;
}
.sequence-active .sequence-field { opacity: 1; }
.sequence-console {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 9px 12px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--dock);
}
.sequence-chapters { display: flex; gap: 6px; }
.sequence-chapters button { flex: 1; padding: 5px 8px; font-weight: 650; min-height: 36px; }
.sequence-chapters button span { margin-inline-end: 4px; color: var(--run-color); font-family: var(--mono); }
.sequence-chapters [aria-current="step"] { background: var(--inset); border-color: var(--run-color); }
.sequence-caption { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 14px; }
.sequence-caption p { margin: 0; font-size: 13px; line-height: 1.28; }
.sequence-totals { color: var(--muted); display: flex; flex-wrap: wrap; column-gap: 8px; }
.sequence-totals strong { color: var(--ink); font-weight: 550; }
.sequence-playback { display: flex; align-items: center; gap: 9px; }
.sequence-playback .icon { flex: none; min-height: 34px; min-width: 36px; }
.sequence-playback input { flex: 1; min-width: 0; accent-color: #76C5EB; }
.sequence-clock { color: var(--muted); font: 12px var(--mono); white-space: nowrap; }
.sequence-subject { display: flex; flex-wrap: wrap; gap: 3px 9px; color: var(--muted); font-size: 12px; line-height: 1.2; }
.sequence-subject strong { color: var(--ink); font-family: var(--mono); }
.sequence-actions, .sequence-cues, .sequence-jumps { display: flex; flex-wrap: wrap; gap: 5px 6px; }
.sequence-actions { justify-content: space-between; }
.sequence-actions button { min-height: 34px; font-size: 12px; }
.sequence-cues span { margin-inline-start: 2px; color: var(--muted); font-family: var(--mono); }
.sequence-cues [aria-current="true"] { background: var(--inset); border-color: #76C5EB; }
@media (max-width: 560px) {
  .cinematic-sequence { gap: 7px; }
  .sequence-header { padding: 8px 9px; gap: 7px; }
  .sequence-header p { font-size: 11px; }
  .sequence-close { font-size: 11px; padding: 4px 6px; }
  .sequence-boards { flex: 1 0 250px; flex-direction: column; gap: 6px; }
  .sequence-console { gap: 5px; padding: 7px; }
  .sequence-chapters button { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; font-size: 11px; }
}
</style>
