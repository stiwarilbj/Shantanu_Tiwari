<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Aperture, BatteryMedium, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Copy, Ellipsis,
  Eye, FastForward, Layers, Pause, Play, Rabbit, RotateCcw, StepBack, StepForward, Utensils, Video, X } from 'lucide-vue-next'
import { useLab } from '../store.js'
import { STATES } from '../engine/simulation.js'
import { foodSupplyForDay, rulesFor, usesWalkthroughForaging } from '../engine/config.js'
import { DECISION, tracksForagingDecisions } from '../engine/foraging-decisions.js'
import { format, runSpeedRange } from '../engine/stats.js'
import { cost, edgePoint, homePoints, radius, refugeDistance, travel, walkthroughStepCost } from '../engine/geometry.js'
import Board from './Board.vue'
import Flower from './Flower.vue'
import Ribbon from './Ribbon.vue'
import TraitAdjustment from './TraitAdjustment.vue'

const props = defineProps({ active: Boolean })
const lab = useLab()
const emit = defineEmits(['reroll', 'fullscreen-change'])
const board = ref(), surface = ref(), fullscreenActive = ref(false), playbackActions = ref()
const tool = ref(null), camera = ref('board'), quality = ref('auto'), details = ref(false)
const copyState = shallowRef(null)
const eventFilter = ref('all')
const dim = ref(false), hud = ref(false), rateReadout = ref(false), wasPlaying = ref(false)
const layers = ref({ sense:false, speed:false, energy:false, credits:false, homes:false, selected:false, vision:false, cohortSense:false })
const fallback = ref(false)
const layerNames = [
  ['sense',Eye,'Sense range','Show each creature’s sensing radius'],
  ['speed',Rabbit,'Color by speed','Brown is slower · red is faster · same scale across the run'],
  ['energy',BatteryMedium,'Energy','Gold is full · gray is spent'],
  ['credits',Utensils,'Food credits','Olive for plants · rust for prey'],
]
const visible = computed(() => lab.frame?.blobs.find(b => b.id===lab.selected))
const creatureState = computed(() => STATES[visible.value?.state])
const species = computed(() => lab.run.setup.species.find(s => s.id===visible.value?.species))
const traitStats = computed(() => {
  const blob = visible.value
  return blob ? [['Speed', format(blob.speed)], ['Size', format(blob.size)], ['Sense range', format(blob.sense)]] : []
})
const rules = computed(() => rulesFor(lab.run.setup,lab.run.revisions,lab.frame?.day ?? lab.viewing))
const foodSeason = computed(() => {
  const day = lab.frame?.day
  if (day == null || !rules.value.foodSeasons?.enabled) return null
  const supply = foodSupplyForDay(rules.value, day)
  return supply.phase ? supply : null
})
const foragingDecision = computed(() => {
  const blob = visible.value
  if (!blob || !tracksForagingDecisions(rules.value)) return ''
  if (!blob.alive) return 'Died'
  if (blob.home) return 'Reached the refuge'
  if (blob.state === 7) return 'Born at dusk'
  const savings = blob.foragingSavings == null ? '' : format(blob.foragingSavings, 1).replace(/\.0$/, '') + '%'
  switch (blob.foragingDecision) {
    case DECISION.plant: return 'Heading for a reachable plant'
    case DECISION.prey: return 'Pursuing reachable prey'
    case DECISION.rememberedPlant: return 'Heading to where it last saw the plant'
    case DECISION.keepMeal: return `Kept its meal target. The alternative saves ${savings} of the trip.`
    case DECISION.switchPlant: return `Switched to a plant that saves ${savings} of the trip.`
    case DECISION.switchPrey: return `Switched to prey that saves ${savings} of the trip.`
    case DECISION.returnWithFood: return 'Heading home with two food credits'
    case DECISION.returnForTime: {
      const steps = blob.foragingSettings?.returnMargin ?? 0
      return `Turned home to keep ${steps} ${steps === 1 ? 'step' : 'steps'} in reserve.`
    }
    case DECISION.escape: return 'Changed course to escape a predator'
    case DECISION.retreat: return 'Headed for the refuge to escape a predator'
    case DECISION.noSafeMeal: return 'Turned home when it found no meal it could reach and still get back in time.'
    case DECISION.forgotPlant: return 'Looked for another meal after its plant memory expired'
    case DECISION.pursuitLimit: return 'Gave up the chase when the prey moved beyond its pursuit limit'
    case DECISION.missingPlant: return 'Looked for another meal after seeing the plant was gone'
    default: return 'Searching for a reachable meal'
  }
})
const distanceHome = computed(() => {
  const blob = visible.value
  if (lab.frame?.refugeWidth) return refugeDistance(blob, lab.frame.refugeWidth)
  if (!usesWalkthroughForaging(rules.value)) return homePoints(blob)[0].distance
  const edge = edgePoint(blob.x, blob.y)
  return Math.hypot(blob.x - edge.x, blob.y - edge.y)
})
const movementCost = computed(() => {
  const blob = visible.value
  if (!blob) return ''
  return rules.value.metabolism==='walkthrough' ?
    format(walkthroughStepCost(blob,rules.value),3)+' per step' : format(cost(blob,rules.value),1)+'/s'
})
const cohort = computed(() => {
  const frame = lab.frame
  if (!frame || !visible.value) return {}
  const sampled = lab.scope === 'all' || visible.value.species !== lab.scope ? frame.blobs : frame.blobs.filter(b => b.species===lab.scope)
  const result = {}
  for (const key of ['age','speed','size','sense']) result[key] = sampled.reduce((a,b) =>
    ({ min:Math.min(a.min,b[key]), max:Math.max(a.max,b[key]) }), { min:Infinity,max:-Infinity })
  return result
})
const fraction = computed(() => lab.dayEnded ? 1 : lab.displayDuration ? (lab.frame?.time ?? 0) / lab.displayDuration : 0)
const transportLabel = computed(() => lab.playing ? 'Pause' : lab.replay && lab.dayEnded ? 'Replay day' : 'Play')
const playbackSpeed = computed(() => 2 ** ((lab.rate - 6) / 2))
const rateText = computed(() => Number(playbackSpeed.value.toFixed(3))+'×')
const liveRate = computed(() => !lab.replay && lab.playing && !lab.loading && !lab.batch ? playbackSpeed.value : null)
const events = computed(() => (lab.frame?.events ?? []).filter(e => e.time <= (lab.frame?.time ?? 0)))
const creatureEvents = computed(() => events.value.filter(e => e.id===lab.selected || e.target===lab.selected && e.type==='prey' ||
  e.type==='birth' && (e.parent===lab.selected || e.secondParent===lab.selected)))
const visibleEvents = computed(() => creatureEvents.value.filter(e => eventFilter.value==='all' || e.type===eventFilter.value))
const living = computed(() => lab.frame?.blobs.filter(b => b.alive) ?? [])
const speedRange = computed(() => layers.value.speed ? runSpeedRange(lab.run) : undefined)
const quickLabel = computed(() => lab.batch && lab.batch.label !== 'Preparing' ? 'Progress' : 'Quick Sim')
const replayCanSeek = computed(() => lab.replay && !lab.loading)
const canAdvanceDay = computed(() => !!lab.frame && !lab.dayEnded && !lab.loading && (lab.replay || lab.canEnterLive))
function select(id) {
  lab.selected = id
  lab.following = id != null
  eventFilter.value='all'
  if (id != null && camera.value === 'overhead') camera.value = 'board'
}
function follow() {
  if (lab.following) { lab.following = false; return }
  const candidate = living.value.find(b => b.id===lab.selected) ?? living.value[0]
  if (candidate) select(candidate.id)
  else details.value = true
}
function toggle(name) { tool.value = tool.value === name ? null : name }
function toggleLayer(key) {
  layers.value[key]=!layers.value[key]
  if (key==='sense') layers.value.cohortSense=false
}
function startSeek() {
  if (!replayCanSeek.value) return
  wasPlaying.value = lab.playing
  lab.stopPlayback()
  rateReadout.value = true
}
function finishSeek() {
  rateReadout.value = false
  if (wasPlaying.value && lab.frame.time < lab.displayDuration) lab.play()
  wasPlaying.value = false
}
function fit() { camera.value='board'; lab.following=false; board.value?.fit(); tool.value=null }
async function fullscreen() {
  tool.value=null
  try {
    if (fullscreenActive.value) await document.exitFullscreen()
    else await surface.value.requestFullscreen()
  } catch { lab.error='Full screen is unavailable in this browser.' }
}
function updateFullscreen() {
  fullscreenActive.value = document.fullscreenElement === surface.value
  emit('fullscreen-change', fullscreenActive.value ? surface.value : null)
}
onMounted(() => document.addEventListener('fullscreenchange', updateFullscreen))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', updateFullscreen))
function shortcuts(event) {
  if (lab.settings || lab.modal || /INPUT|BUTTON|SELECT|TEXTAREA|A/.test(event.target.tagName)) return
  if (event.code === 'Space') { event.preventDefault(); lab.play() }
  if (event.key === 'Escape') { tool.value=null; details.value=false }
}
function endDay() {
  if (lab.replay) { lab.stopPlayback(); lab.seek(lab.displayDuration) }
  else lab.simulate(lab.liveDay,'Finish Day')
  tool.value=null
}
function eventName(e) {
  if (e.type === 'death') return e.cause
  if (e.type === 'plant') return 'Ate a plant'
  if (e.type === 'prey') return 'Hunted #'+e.target
  if (e.type === 'home') return 'Reached refuge'
  if (e.type === 'traits') return 'Traits adjusted'
  return e.id===lab.selected ? 'Born to '+parentNames(e) : 'Offspring #'+e.id
}
function parentNames({ parent, secondParent }) {
  if (secondParent != null) return `#${parent} and #${secondParent}`
  return parent == null ? 'Founder' : '#'+parent
}
async function copyStats() {
  const blob = visible.value
  if (!blob) return
  const stats = [
    ['ID', '#'+blob.id], ['Species', species.value?.name ?? blob.species], ['Day', lab.frame.day],
    ...traitStats.value
  ]
  const text = stats.map(([label, value]) => `${label}: ${value}`).join('\n')
  const attempt = { status:'pending', text }
  copyState.value = attempt
  let status = 'copied'
  try { await navigator.clipboard.writeText(text) }
  catch { status = 'manual' }
  if (copyState.value === attempt) copyState.value = { status, text }
}
watch([details, () => lab.run.id, () => lab.frame?.day, () => visible.value?.id], () => { copyState.value = null })
watch(() => lab.run.id, () => { details.value=false; tool.value=null; layers.value.cohortSense=false; fit() })
watch(() => lab.modal, async (current, previous) => {
  if (current || previous !== 'traits' || !props.active) return
  await nextTick()
  playbackActions.value?.focus()
})
watch(() => visible.value?.id, id => {
  if (id == null) layers.value.selected = false
})
watch(() => visible.value?.alive, alive => { if (alive===false) lab.following=false })
function overhead(cohortSense) {
  lab.following=false
  if (cohortSense) {
    select(null)
    layers.value.selected=false
  }
  camera.value='overhead'
  layers.value.sense=true
  layers.value.cohortSense=cohortSense
}
defineExpose({ select, overhead })
</script>
<template>
  <main ref="surface" class="world" :class="{ 'is-following':lab.following, 'is-overhead':camera==='overhead', 'is-replay':replayCanSeek }" tabindex="-1" @keydown="shortcuts">
    <section class="stage" aria-label="Simulation field">
      <Board ref="board" :frame="lab.frame" :species="lab.run.setup.species" :layers="layers" :selected="lab.selected"
        :follow="lab.following" :camera="camera" :scope="lab.scope" :dim="dim" :quality="quality" :speed-range="speedRange" tabletop
        :playback-run="lab.replay ? undefined : lab.run.id" :live-rate="liveRate" :live-finished="!lab.replay && lab.dayEnded"
        @select="select" @fallback="fallback=true"/>
      <div class="view-tools">
        <button class="icon" aria-label="Layers" title="Layers" :aria-expanded="tool==='layers'" @click="toggle('layers')"><Layers :size="23"/></button>
        <button class="icon" aria-label="Follow creature" title="Follow creature" :aria-pressed="lab.following" :disabled="lab.loading || !lab.frame" @click="follow"><Video :size="23"/></button>
        <button class="icon view-menu-button" aria-label="View options" title="View options" :aria-expanded="tool==='view'" @click="toggle('view')"><Ellipsis :size="21"/></button>
      </div>
      <div v-if="tool==='layers'" class="layer-panel pop">
        <button class="icon" aria-label="Close layers" @click="tool=null"><ChevronUp :size="20"/></button>
        <button v-for="[key,Icon,label,tip] in layerNames" :key="key" class="icon layer" :aria-label="label" :aria-pressed="layers[key]" @click="toggleLayer(key)">
          <component :is="Icon" :size="22"/><span class="layer-name">{{ label }}</span><span class="layer-tip">{{ label }}<small>{{ key==='sense' && layers.cohortSense ? 'Show living creatures in the species filter' : tip }}</small></span>
        </button>
        <button class="icon" aria-label="More layer options" @click="toggle('layer-options')"><ChevronDown :size="17"/></button>
      </div>
      <div v-if="tool==='view' || tool==='layer-options'" class="pop view-menu">
        <template v-if="tool==='view'">
          <button @click="fit">Fit board</button>
          <button @click="camera='overhead'; lab.following=false; tool=null">Overhead <span v-if="camera==='overhead'">✓</span></button>
          <button @click="fullscreen">{{ fullscreenActive ? 'Exit full screen' : 'Full screen' }}</button>
          <button @click="details=!details; tool=null">Creatures</button>
          <label>Graphics <select v-model="quality"><option value="auto">Auto</option><option value="full">Full</option><option value="efficient">Efficient</option></select></label>
          <label><input v-model="dim" type="checkbox"> Dim other species</label>
          <label><input v-model="hud" type="checkbox"> HUD</label>
        </template>
        <template v-else>
          <button @click="tool='layers'">Back to layers</button>
          <label><input v-model="layers.selected" type="checkbox" :disabled="!visible"> Selected creature only</label>
          <label><input v-model="layers.homes" type="checkbox"> Show refuges</label>
        </template>
      </div>
      <div v-if="hud" class="world-hud">
        <span>Alive <b>{{ living.length }}</b></span><span>Home <b>{{ living.filter(b=>b.home).length }}</b></span>
        <span>Plants left <b>{{ lab.frame?.plants.length ?? 0 }}</b></span><span>Hunts <b>{{ events.filter(e=>e.type==='prey').length }}</b></span>
        <span>Deaths <b>{{ events.filter(e=>e.type==='death').length }}</b></span>
      </div>
      <div v-if="lab.following && visible" class="creature-flower"
        :class="{ 'layers-open':tool==='layers', 'rate-open':tool==='rate' }">
        <Flower :values="visible" :bounds="cohort" individual compact/>
        <button class="creature-caption" :aria-label="'Current creature details · '+species?.name+' · #'+visible.id" @click="details=true">
          <i :style="{background:species?.color}"></i>{{ species?.name }} · #{{ visible.id }}
        </button>
        <button class="vision-toggle" type="button" :aria-pressed="layers.vision" @click="layers.vision=!layers.vision"
          title="Dim the area beyond this creature’s sense range"><Aperture :size="14"/> Sense focus</button>
      </div>
      <div v-if="speedRange && !['rate','player'].includes(tool)" class="speed-key" aria-label="Body color by speed">
        <span>Run speed · points</span>
        <i v-if="speedRange.min !== speedRange.max" aria-hidden="true"></i>
        <div v-if="speedRange.min === speedRange.max">All {{ format(speedRange.min) }}</div>
        <div v-else><span>{{ format(speedRange.min) }}</span><span>{{ format(speedRange.max) }}</span></div>
      </div>
      <div v-if="lab.loading" class="stage-note" role="status">Building replay for Day {{ lab.replayDay }}…</div>
      <div class="player">
        <div class="transport" role="group" aria-label="Day playback">
          <button class="icon" title="Previous day" aria-label="Previous day" :disabled="lab.viewing<=1 || lab.loading" @click="lab.moveDay(-1)"><ChevronLeft :size="19"/></button>
          <button class="icon play" :title="transportLabel" :aria-label="transportLabel"
            :disabled="!lab.frame || lab.loading || !lab.replay && (!lab.workerReady || !!lab.batch)" @click="lab.play">
            <Pause v-if="lab.playing" :size="18" fill="currentColor"/>
            <RotateCcw v-else-if="transportLabel==='Replay day'" :size="18"/>
            <Play v-else :size="18" fill="currentColor"/>
          </button>
          <button class="icon" title="Next day" aria-label="Next day" :disabled="!lab.canMoveNext || lab.loading" @click="lab.moveDay(1)"><ChevronRight :size="19"/></button>
        </div>
        <button class="icon through" title="Play through generations" aria-label="Play through generations" :aria-pressed="lab.through" @click="lab.toggleThrough"><StepForward :size="15"/></button>
      </div>
      <div class="player-actions">
        <button class="quick" :disabled="!!lab.extinctDay && !lab.batch" @click="lab.modal=lab.batch ? 'quick-progress' : 'quick'"><FastForward :size="15" fill="currentColor"/>{{ quickLabel }}</button>
        <button ref="playbackActions" class="icon" aria-label="Playback actions" title="Playback actions" @click="toggle('player')"><Ellipsis :size="20"/></button>
        <button class="icon" aria-label="Viewing speed" :title="'Viewing speed · '+rateText" :aria-expanded="tool==='rate'" @click="toggle('rate')"><Clock :size="21"/></button>
      </div>
      <div v-if="tool==='rate'" class="pop rate-panel">
        <label for="play-rate">Viewing speed</label>
        <div class="rate-scale">
          <input id="play-rate" v-model.number="lab.rate" type="range" min="0" max="12" aria-label="Viewing speed multiplier" :aria-valuetext="rateText" orient="vertical">
          <div class="rate-ticks" aria-hidden="true"><span>8×</span><span :class="{ normal:lab.rate===6 }">1×</span><span>⅛×</span></div>
        </div>
        <button class="rate-value" title="Reset to 1×" :aria-label="'Reset to 1×; viewing speed '+rateText" @click="lab.rate=6">{{ rateText }}</button>
        <button class="icon compact" aria-label="Close speed controls" @click="tool=null"><ChevronDown :size="16"/></button>
      </div>
      <div v-if="tool==='player'" class="pop player-menu">
        <button :disabled="!canAdvanceDay" @click="endDay">{{ lab.replay ? 'Go to end' : 'Finish Day' }}</button>
        <button :disabled="!canAdvanceDay" @click="lab.stepOnce(); tool=null">Step one tick</button>
        <button :disabled="!lab.canOpenTraitAdjustment" @click="lab.openTraitAdjustment(); tool=null">Adjust living traits</button>
        <button v-if="lab.completed" @click="lab.openDay(lab.completed); tool=null">Go to frontier</button>
        <button v-if="lab.replay && lab.canEnterLive" @click="lab.goLive(); tool=null">Back to Live</button>
      </div>
      <aside v-if="details" class="details" aria-label="Creature details">
        <header><strong>{{ visible ? (species?.name+' · #'+visible.id) : 'Creatures' }}</strong><button class="icon" aria-label="Close creature details" @click="details=false"><X :size="19"/></button></header>
        <label>Creature <select :value="lab.selected ?? ''" @change="select(Number($event.target.value) || null)">
          <option value="">Choose a creature</option>
          <option v-if="visible && !visible.alive" :value="visible.id">#{{ visible.id }} · Deceased</option>
          <option v-for="b in living" :key="b.id" :value="b.id">#{{ b.id }} · {{ lab.run.setup.species.find(s=>s.id===b.species)?.name }}</option>
        </select></label>
        <template v-if="visible">
          <div class="creature-copy">
            <button type="button" class="secondary" :disabled="copyState?.status==='pending'" @click="copyStats">
              <Copy :size="14" aria-hidden="true"/> Copy stats
            </button>
            <span role="status" :class="copyState?.status==='copied' ? 'teal' : 'quiet'">
              {{ copyState?.status==='copied' ? 'Stats copied' : copyState?.status==='manual' ? 'Clipboard unavailable. Copy the text below.' : '' }}
            </span>
          </div>
          <textarea v-if="copyState?.status==='manual'" class="creature-copy-text" aria-label="Creature stats to copy"
            rows="6" readonly :value="copyState.text" @focus="$event.target.select()"></textarea>
          <p>{{ creatureState }} <span v-if="!visible.alive">· {{ creatureEvents.find(e=>e.type==='death')?.cause }}</span></p>
          <p v-if="foragingDecision" class="foraging-decision"><strong>Foraging decision</strong> {{ foragingDecision }}</p>
          <p v-if="creatureState === 'Returning'" class="quiet">{{ format(distanceHome,1) }} units from the nearest refuge</p>
          <progress :value="visible.energy" :max="visible.capacity" aria-label="Remaining energy"></progress>
          <small>{{ format(visible.energy,1) }} / {{ visible.capacity }} energy</small>
          <dl><template v-for="[name,value] in [
            ['Age',visible.age+' days'],['Food credits',visible.credits],...traitStats,
            ['Travel rate',format(visible.speedWorld ?? travel(visible,rules),1)+' units/s'],
            ['Body radius',format(radius(visible.size),2)],['Energy cost',movementCost],
            ['Born', 'Day '+visible.born],[visible.secondParent != null ? 'Parents' : 'Parent',parentNames(visible)]
          ]" :key="name"><dt>{{ name }}</dt><dd>{{ value }}</dd></template></dl>
          <h3>Events</h3>
          <select v-model="eventFilter" aria-label="Filter creature events">
            <option v-for="[type,label] in [['all','All events'],['plant','Plants'],['prey','Hunts'],['home','Refuge'],['death','Deaths'],['birth','Births'],['traits','Trait adjustments']]" :key="type" :value="type">{{ label }}</option>
          </select>
          <p v-if="!visibleEvents.length" class="quiet">No matching events at this point in the day.</p>
          <button v-for="(event,index) in visibleEvents" :key="index" class="event-row" :disabled="!lab.replay" @click="lab.seek(event.time)">
            <time>{{ format(event.time) }} s</time>{{ eventName(event) }}
          </button>
        </template>
      </aside>
    </section>
    <div class="time-rail" :class="{ seekable:replayCanSeek, 'open-ended':lab.displayDuration == null }" :style="{ '--elapsed':fraction*100+'%' }"
      @mouseenter="rateReadout=true" @mouseleave="rateReadout=false">
      <div class="time-track">
        <div class="time-readouts">
          <div class="time-clock">
            <div v-if="replayCanSeek || rateReadout || lab.frame && lab.displayDuration == null" class="time-label">
              {{ format(lab.frame?.time ?? 0) }} {{ lab.displayDuration == null ? 's elapsed' : '/ '+format(lab.displayDuration)+' s' }}
            </div>
          </div>
          <span v-if="fallback" class="render-note" title="Canvas rendering is active">Canvas view</span>
        </div>
        <div class="time-fill"></div><div class="time-thumb"></div>
        <input v-if="replayCanSeek" :value="lab.frame?.time ?? 0" type="range" min="0" :max="lab.displayDuration" step=".05"
          aria-label="Replay time" :aria-valuetext="format(lab.frame?.time ?? 0)+' seconds of '+format(lab.displayDuration)"
          @pointerdown="startSeek" @pointerup="finishSeek" @pointercancel="finishSeek" @input="lab.seek(Number($event.target.value))">
        <span v-else-if="lab.displayDuration != null" role="progressbar" aria-label="Current day elapsed" :aria-valuenow="lab.frame?.time ?? 0" :aria-valuemax="lab.displayDuration"></span>
      </div>
      <div v-if="replayCanSeek" class="frame-controls" role="group" aria-label="Replay frame controls">
        <button type="button" class="icon" aria-label="Previous frame" title="Previous frame" :disabled="lab.playing || !lab.frame?.time" @click="lab.stepReplayFrame(-1)">
          <StepBack :size="18" aria-hidden="true"/>
        </button>
        <button type="button" class="icon" aria-label="Next frame" title="Next frame" :disabled="lab.playing || lab.dayEnded" @click="lab.stepReplayFrame(1)">
          <StepForward :size="18" aria-hidden="true"/>
        </button>
      </div>
    </div>
    <p v-if="foodSeason" class="world-food-season">Food season · {{ foodSeason.phase }} · {{ format(foodSeason.count, 0) }} plants at dawn</p>
    <Ribbon :active="props.active" @reroll="emit('reroll')" @table="lab.modal='table'"/>
    <TraitAdjustment v-if="props.active && lab.modal==='traits'"/>
  </main>
</template>
