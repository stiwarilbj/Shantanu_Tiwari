<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Bookmark, ChartNoAxesCombined, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Dices, Layers, Ellipsis, Info } from 'lucide-vue-next'
import { rulesFor } from '../engine/config.js'
import { runSpecies, speciesWithEdits } from '../engine/species-actions.js'
import { useLab } from '../store.js'
import { METRICS, format, metricValue } from '../engine/stats.js'
import { useForecast } from '../use-forecast.js'
import ForecastStatus from './ForecastStatus.vue'
import Flower from './Flower.vue'
import ExtinctionIcon from './ExtinctionIcon.vue'

const props = defineProps({ active: Boolean })
const emit = defineEmits(['reroll', 'table'])
const lab = useLab()
const scopeSpecies = computed(() => {
  const frame = lab.frame
  if (!frame) return runSpecies(lab.run).filter(item => item.enabled)
  const rules = rulesFor(lab.run.setup, lab.run.revisions, frame.day)
  const current = speciesWithEdits(rules.species, frame.speciesEdits).filter(item => item.enabled)
  const historicalSelection = runSpecies(lab.run).find(item => item.id === lab.scope && !current.some(s => s.id === item.id))
  return historicalSelection ? [...current, historicalSelection] : current
})
const scroll = ref(null), fold = ref(false), legend = ref(false), panel = ref(null), inspection = ref(null)
const mode = ref('classic'), rotation = ref(0), dayInput = ref(1)
const focusDay = ref(lab.viewing), detail = ref(null), detailX = ref(null)
const menu = ref(null), optionsButton = ref(null)
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
let observer
legend.value = innerWidth >= 620
const order = computed(() => mode.value === 'classic' ? [1,3,4,5,0] : [1,2,3,4,5,0])
const rows = computed(() => lab.run.summaries.map(record => record.rows[lab.scope]))
const miniKey = computed(() => METRICS[order.value[rotation.value] ?? 1])
const forecast = useForecast(() => lab.run, () => lab.run.summaries,
  () => props.active && !fold.value && mode.value === 'line')
const forecasts = computed(() => forecast.rows.value.map(record => metricValue(record.rows[lab.scope], miniKey.value.key)))
const forecastEnd = computed(() => lab.completed + forecasts.value.length)
const forecastForDay = day => forecasts.value[day - lab.completed - 1]
function forecastText(value) {
  return format(value,miniKey.value.key === 'population' ? 0 : 2)
}
const forecastLabel = day => [
  'Predicted', ...(day > lab.run.setup.days ? ['If extended'] : []),
  'Day '+day, miniKey.value.short+' '+forecastText(forecastForDay(day)),
].join(' · ')
const bookmarks = computed(() => new Set(lab.run.bookmarks ?? []))
const bookmarkAction = day => bookmarks.value.has(day) ? 'Remove bookmark for Day '+day : 'Bookmark Day '+day
const bounds = computed(() => {
  const b = {}
  for (const metric of METRICS) {
    const row = rows.value.filter(r => r && metricValue(r,metric.key) != null)
    b[metric.key] = { min:metric.key === 'population' ? 0 : row.reduce((v,r) => Math.min(v,r[metric.key].min),Infinity),
      max:row.reduce((v,r) => Math.max(v,metric.key === 'population' ? r.population : r[metric.key].max),0) }
  }
  return b
})
const tiles = computed(() => {
  const limit = lab.run.setup.days
  const visible = lab.extinctDay ? lab.completed : Math.min(limit,Math.max(lab.completed+8, lab.viewing+2, forecastEnd.value))
  return Array.from({length:visible},(_,i) => {
    const row = rows.value[i]
    return { day:i+1,row,values: row ? Object.fromEntries(METRICS.map(m => [m.key,metricValue(row,m.key)])) : null }
  })
})
const visibleFrame = computed(() => {
  const frame = lab.frame
  if (!frame) return {}
  if (lab.dayEnded && lab.run.summaries[frame.day-1]) {
    const row = lab.run.summaries[frame.day-1].rows[lab.scope]
    return Object.fromEntries(METRICS.map(m => [m.key,metricValue(row,m.key)]))
  }
  const inScope = b => lab.scope === 'all' || b.species === lab.scope
  const living = frame.blobs.filter(b => b.alive && inScope(b))
  const deaths = frame.events.filter(e => e.type === 'death' && e.time <= frame.time && inScope(e))
  const average = (arr,key) => arr.length ? arr.reduce((sum,b) => sum+b[key],0)/arr.length : null
  return { population:living.length, age:average(living,'age'), deathAge:average(deaths,'age'),
    speed:average(living,'speed'),size:average(living,'size'),sense:average(living,'sense') }
})
const extraForecastDays = computed(() => Array.from({ length:Math.max(0, forecastEnd.value-tiles.value.length) },
  (_,index)=>tiles.value.length+index+1))
const miniSeries = computed(() => {
  const { key } = miniKey.value
  const scale = Math.max(bounds.value[key].max,...forecasts.value.filter(Number.isFinite)) || 1
  const point = (day,value) => ({ day, x:(day-.5)*100, y:58-value/scale*50 })
  const points = []
  let path = ''
  for (const tile of tiles.value) {
    const value = tile.values?.[key]
    if (value == null) continue
    const { x,y } = point(tile.day,value)
    const command = points.at(-1)?.day === tile.day - 1 ? 'L' : 'M'
    path += ` ${command}${x} ${y}`
    points.push({ day: tile.day, x, y })
  }
  const future = []
  let predictedPath = ''
  let previous = points.at(-1)
  for (const [index, value] of forecasts.value.entries()) {
    if (!Number.isFinite(value)) continue
    const next = point(lab.completed + index + 1, value)
    if (!future.length && previous?.day === next.day - 1) predictedPath = `M${previous.x} ${previous.y}`
    predictedPath += ` ${previous?.day === next.day - 1 ? 'L' : 'M'}${next.x} ${next.y}`
    future.push(next)
    previous = next
  }
  return { path, points, future, predictedPath }
})
const firstExtinct = computed(() => rows.value.find(row => row?.population === 0)?.day)
function center(smooth, day = lab.viewing) {
  const sc = scroll.value, selected = sc?.querySelector('[data-day="'+day+'"]')
  if (!selected) return
  const centerX = Math.max(selected.offsetWidth/2,innerWidth/2 - sc.getBoundingClientRect().left)
  sc.scrollTo({ left:selected.offsetLeft + selected.offsetWidth/2 - centerX, behavior:smooth && !reducedMotion.matches ? 'smooth' : 'instant' })
}
watch(() => [lab.viewing, fold.value], () => nextTick(() => center(true)))
watch(() => tiles.value.length, (size, previous) => { if (previous < lab.viewing && size >= lab.viewing) nextTick(() => center(false)) })
watch(scroll, element => {
  observer?.disconnect()
  if (element) {
    observer = new ResizeObserver(() => { center(false); anchorDetail() })
    observer.observe(element)
    nextTick(() => center(false))
  }
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => lab.viewing, day => { focusDay.value = day })
watch([() => lab.viewing, () => lab.scope, () => lab.run.id, fold, mode], () => { inspection.value = null })
watch([() => lab.run.id, fold], () => { panel.value = null })
function select(day) {
  if (day <= lab.completed) lab.openDay(day)
  else if (day === lab.liveDay && !lab.batch) lab.goLive()
  else lab.quickForDay(day)
}
function toggleOptions() {
  panel.value = panel.value ? null : 'options'
  inspection.value = null
}
function showBookmarks() {
  panel.value = 'bookmarks'
  nextTick(() => menu.value?.focus({ preventScroll:true }))
}
function closePanel(restoreFocus = false) {
  panel.value = null
  if (restoreFocus) optionsButton.value?.focus({ preventScroll:true })
}
function wheel(event) {
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
  event.preventDefault()
  scroll.value.scrollLeft += event.deltaY
}
function keys(event,day) {
  if (event.key.toLowerCase() === 'i' || event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
    if (!rows.value[day-1]) return
    event.preventDefault()
    inspect(day,true)
    return
  }
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 1 : event.key === 'End' ? Math.max(lab.completed,1) :
    Math.max(1,Math.min(tiles.value.length+extraForecastDays.value.length,day+(event.key === 'ArrowLeft' ? -1 : 1)))
  scroll.value.querySelector('[data-day="'+next+'"]')?.focus({ preventScroll:true })
  center(false,next)
}
function clickTile(event, tile) {
  const key = event.target.closest('[data-metric]')?.dataset.metric
  if (key && tile.row && tile.day === lab.viewing) {
    if (key === 'population') inspect(tile.day)
    else rotation.value = order.value.findIndex(idx => METRICS[idx].key === key)
    return
  }
  select(tile.day)
}
function chooseLegendMetric(metricIndex, position) {
  if (metricIndex === 0 && mode.value !== 'line') emit('table')
  else rotation.value = position
}
function anchorDetail() {
  if (!inspection.value || !scroll.value) return
  const tile = scroll.value.querySelector('[data-day="'+inspection.value+'"]')
  if (!tile) return
  const ribbon = scroll.value.parentElement.getBoundingClientRect(), target = tile.getBoundingClientRect()
  const x = (target.left+target.right)/2 - ribbon.left
  const safe = (detail.value?.offsetWidth ?? 214)/2 + 8
  detailX.value = Math.max(safe,Math.min(ribbon.width-safe,x))
}
function closeDetail(restore = false) {
  const trigger = scroll.value?.querySelector('[data-day="'+inspection.value+'"]')
  inspection.value = null
  if (restore) trigger?.focus({ preventScroll:true })
}
function inspect(day, keyboard = false) {
  if (!rows.value[day-1]) return
  if (inspection.value === day) { closeDetail(keyboard); return }
  closePanel()
  inspection.value = day
  anchorDetail()
  nextTick(() => {
    anchorDetail()
    if (keyboard) detail.value?.querySelector('button').focus({ preventScroll:true })
  })
}
function escapeRibbon(event) {
  if (!panel.value && !inspection.value) return
  event.stopPropagation()
  if (panel.value) closePanel(true)
  else closeDetail(detail.value?.contains(document.activeElement))
}
</script>
<template>
  <section class="dock" aria-label="Current generation and timeline">
    <ForecastStatus :forecasts="[forecast]"/>
    <div v-if="!fold" class="ribbon" @keydown.esc="escapeRibbon">
      <div ref="scroll" class="ribbon-scroll" @wheel="wheel" @scroll.passive="anchorDetail">
        <div class="tile-track">
          <button v-for="tile in tiles" :key="tile.day" type="button" class="day-tile"
            :class="{ current:lab.viewing===tile.day, pending:!tile.row, 'line-tile':mode==='line',
              'predicted-tile':forecastForDay(tile.day)!=null }" :data-day="tile.day"
            :aria-current="lab.viewing===tile.day ? 'true' : undefined"
            :aria-label="'Day '+tile.day+(tile.row ? ', population '+tile.row.population : ', '+(tile.day===lab.liveDay && !lab.batch ? 'live' : 'pending'))+(bookmarks.has(tile.day) ? ', bookmarked' : '')+
              (forecastForDay(tile.day)!=null ? ', '+forecastLabel(tile.day) : '')"
            :tabindex="tile.day===focusDay ? 0 : -1" :aria-keyshortcuts="tile.row ? 'I Shift+F10' : undefined"
            @focus="focusDay=tile.day" @click="clickTile($event,tile)" @keydown="keys($event,tile.day)"
            @contextmenu="tile.row && ($event.preventDefault(),inspect(tile.day))">
            <Flower v-if="mode!=='line'" :values="tile.values" :bounds="bounds" :rotation="rotation"
              :six="mode==='six'" :interactive="!!tile.row" compact/>
            <span class="day-number">{{ tile.day }}<Bookmark v-if="bookmarks.has(tile.day)" class="bookmark-mark" :size="11" aria-hidden="true"/></span>
            <small v-if="!tile.row">{{ tile.day===lab.liveDay && !lab.batch ? 'Live' : 'Pending' }}</small>
            <small v-else-if="!lab.extinctDay && tile.day===firstExtinct">Extinct</small>
            <small v-if="forecastForDay(tile.day)!=null" class="mini-prediction">≈ {{ forecastText(forecastForDay(tile.day)) }}</small>
          </button>
          <div v-for="day in extraForecastDays" :key="day" class="day-tile line-tile predicted-tile" :data-day="day"
            :tabindex="focusDay===day ? 0 : -1" role="img" :aria-label="forecastLabel(day)"
            @focus="focusDay=day" @keydown="keys($event,day)">
            <span class="day-number">{{ day }}</span><small class="mini-prediction">If extended</small>
            <small v-if="forecastForDay(day)!=null" class="mini-prediction">≈ {{ forecastText(forecastForDay(day)) }}</small>
          </div>
          <button v-if="lab.extinctDay" class="day-tile extinction-tile" :aria-label="'Extinct on Day '+lab.extinctDay+' · Watch final scene'" @click="lab.openDay(lab.extinctDay, Infinity)">
            <ExtinctionIcon/>
            <span>Extinct</span><small>Day {{ lab.extinctDay }}</small>
          </button>
          <button v-else class="day-tile more-tile" aria-label="More Generations" @click="lab.modal='extend'"><Layers :size="25"/><span>More</span></button>
          <svg v-if="mode==='line'" class="ribbon-line" :viewBox="'0 0 '+(tiles.length+extraForecastDays.length)*100+' 65'"
            :style="{width:'calc(var(--tile) * '+(tiles.length+extraForecastDays.length)+')'}" preserveAspectRatio="none" aria-hidden="true">
            <path :d="miniSeries.path" :stroke="miniKey.color" fill="none" stroke-width="2"/>
            <circle v-for="point in miniSeries.points" :key="point.day" :cx="point.x" :cy="point.y" r="3" :fill="miniKey.color"/>
            <g v-if="miniSeries.future.length">
              <path :d="miniSeries.predictedPath" :stroke="miniKey.color" fill="none" stroke-width="2" stroke-dasharray="6 5"/>
              <circle v-for="point in miniSeries.future" :key="point.day" :cx="point.x" :cy="point.y" r="3" fill="#1B2A33" :stroke="miniKey.color"/>
            </g>
          </svg>
        </div>
      </div>
      <div v-if="legend" class="flower-legend" :class="{ 'mini-line-legend':mode==='line' }">
        <button v-for="(idx,i) in order" :key="idx" class="legend-key" :aria-pressed="idx===0 && mode!=='line' ? undefined : i===rotation"
          @click="chooseLegendMetric(idx,i)" :style="{ '--metric':METRICS[idx].petal }">
          <i></i>{{ METRICS[idx].short }}<b v-if="i===rotation" aria-hidden="true">•</b>
        </button>
        <button class="legend-help" @click="emit('table')"><Info :size="13"/> Exact values</button>
        <button class="legend-toggle" aria-label="Hide generation legend" @click="legend=false"><ChevronLeft :size="16"/></button>
      </div>
      <button v-else class="icon legend-open" aria-label="Show generation legend" @click="legend=true"><ChevronRight :size="16"/></button>
      <div class="ribbon-actions">
        <button class="icon compact" aria-label="Reroll seed" @click="emit('reroll')"><Dices :size="16"/></button>
        <button v-if="!lab.extinctDay" class="icon compact" aria-label="More Generations" @click="lab.modal='extend'"><Layers :size="16"/></button>
        <button ref="optionsButton" class="icon compact" aria-label="Generation options"
          :aria-expanded="!!panel" aria-controls="generation-panel" @click="toggleOptions"><Ellipsis :size="16"/></button>
        <button class="icon compact" aria-label="Collapse generations" @click="fold=true"><ChevronDown :size="16"/></button>
      </div>
      <div v-if="panel" id="generation-panel" ref="menu" class="pop ribbon-menu" :class="{'bookmark-menu':panel==='bookmarks'}"
        role="region" :aria-label="panel==='bookmarks' ? 'Bookmarked generations' : 'Generation options'" tabindex="-1">
        <template v-if="panel==='options'">
          <button v-if="lab.viewing<=lab.completed" type="button" @click="lab.toggleBookmark(lab.viewing)">{{ bookmarkAction(lab.viewing) }}</button>
          <button type="button" @click="showBookmarks">Bookmarks</button>
          <button v-for="[id,label] in [['classic','Walkthrough flower'],['six','All six metrics'],['line','Mini line']]" :key="id" @click="mode=id; rotation=0; closePanel()">{{ label }} <span v-if="mode===id">✓</span></button>
          <button @click="emit('table'); closePanel()">Numeric table</button>
          <form @submit.prevent="select(dayInput); closePanel()"><label>Go to day <input v-model.number="dayInput" type="number" min="1" :max="lab.extinctDay ? lab.completed : lab.run.setup.days" required></label><button class="secondary">Go</button></form>
        </template>
        <template v-else>
          <h3>Bookmarks</h3>
          <p v-if="!bookmarks.size" class="quiet">Select a completed day to bookmark it from Generation options.</p>
          <ul v-else class="bookmark-list">
            <li v-for="day in bookmarks" :key="day">
              <button type="button" :aria-label="'Jump to Day '+day" :aria-current="lab.viewing===day ? 'true' : undefined"
                @click="closePanel(true); select(day)">Day {{ day }}</button>
            </li>
          </ul>
        </template>
      </div>
      <div v-if="inspection && rows[inspection-1]" ref="detail" class="pop ribbon-detail" role="region"
        :aria-label="'Day '+inspection+' readings'" :style="{ left: detailX == null ? undefined : detailX+'px' }">
        <div class="ribbon-detail-heading">
          <strong>Day {{ inspection }} <small>· Final</small></strong>
          <button type="button" class="icon compact" :class="{'bookmark-mark':bookmarks.has(inspection)}"
            :aria-label="bookmarkAction(inspection)" @click="lab.toggleBookmark(inspection)">
            <Bookmark :size="15" aria-hidden="true"/>
          </button>
        </div>
        <dl><template v-for="m in METRICS" :key="m.key"><dt :style="{ color:m.heading ?? m.petal }">{{ m.short }}</dt><dd>{{ format(metricValue(rows[inspection-1],m.key),m.key==='population'?0:2) }}</dd></template></dl>
        <button @click="closeDetail(true)">Close</button>
      </div>
      <div class="ribbon-label">GENERATIONS</div>
    </div>
    <div class="stats">
      <div class="stats-heading">
        <h2>Current Generation Stats</h2>
        <button class="icon compact stat-info" aria-label="View generation table" @click="emit('table')"><Info :size="15"/></button>
        <button class="icon compact" type="button" aria-label="Advanced stats" aria-haspopup="dialog" @click="lab.modal='advanced-stats'">
          <ChartNoAxesCombined :size="15" aria-hidden="true"/>
        </button>
        <select v-model="lab.scope" aria-label="Generation statistics species">
          <option value="all">All species</option>
          <option v-for="s in scopeSpecies" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <button v-if="fold" class="icon compact" aria-label="Expand generations" @click="fold=false"><ChevronUp :size="18"/></button>
      </div>
      <div class="stat-grid">
        <div v-for="m in METRICS" :key="m.key" class="stat" :style="{ '--metric': m.heading ?? m.color }" :title="m.label+' · '+m.unit">
          <span><i></i>{{ m.short }}</span>
          <strong>{{ format(visibleFrame[m.key],m.key === 'population' ? 0 : 2) }}</strong>
        </div>
      </div>
    </div>
  </section>
</template>
