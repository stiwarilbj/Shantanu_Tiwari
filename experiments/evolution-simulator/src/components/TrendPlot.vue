<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Chart, LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale,
  Tooltip, Filler } from 'chart.js'
import { Maximize2, Minimize2, Minus } from 'lucide-vue-next'
import { format } from '../engine/stats.js'

Chart.register(LineController,LineElement,PointElement,BarController,BarElement,LinearScale,CategoryScale,Tooltip,Filler)
const props = defineProps({ id:String, title:String, rows:Array, futureRows:{ type:Array, default:() => [] }, series:Array, unit:String, color:String, min:Number, max:Number,
  pin:Number, peakDay:Number, focus:Boolean, spotlight:Boolean, right:Boolean, hideable:Boolean, legend:Boolean, guide:Number, scope:String, annotations:Array, compact:Boolean, embedded:Boolean })
const emit = defineEmits(['hide','focus','pin','peak','watch','range'])
const canvas = ref(), hovered = ref(null)
const predictedIndex = ref(null), showPredictionReading = ref(false)
let chart, brush, ignoreClick = false
const hidden = ref([])
const keys = computed(() => props.series.filter(s=>s.key!==false))
const active = computed(() =>
  [hovered.value, props.pin].find(day => day != null && props.rows.some(row => row.day === day)) ?? null)
const hasSamples = computed(() => projections.value.length > 0 ||
  props.series.some(series => props.rows.some(row => series.value(row) != null)))
const projections = computed(() => props.series.flatMap((series, index) => {
  if (hidden.value.includes(series.label)) return []
  const values = props.futureRows.map(row => series.value(row) ?? null)
  return values.some(Number.isFinite) ? [{ series, index, values }] : []
}))
const predictionDays = computed(() => projections.value.length ? props.futureRows.map(row => row.day) : [])
const isExtended = (series, row) => row && (series.extended ? series.extended(row) : row.ifExtended)
const firstExtended = computed(() => props.futureRows.findIndex((row, index) =>
  projections.value.some(({ series, values }) => Number.isFinite(values[index]) && isExtended(series, row))))
const predictionReading = computed(() => {
  const index = predictedIndex.value
  if (predictionDays.value[index] == null) return ''
  const row = props.futureRows[index]
  const readings = projections.value.filter(p => p.series.tooltip !== false && Number.isFinite(p.values[index]))
  const extended = readings.length ? readings.every(p => isExtended(p.series, row)) : row.ifExtended
  return [
    (extended ? 'Predicted · If extended' : 'Predicted')+' · '+(props.embedded ? 'Generation ' : 'Day ')+row.day,
    ...readings.map(({ series, values }) => seriesReading(series, values[index], series.spread?.(row))+
      (!extended && isExtended(series, row) ? ' (If extended)' : '')),
  ].join(' · ')
})

function seriesReading(series, value, spread) {
  if (series.bar && value < 0) value = -value
  return series.label+'  '+format(value, series.digits ?? (series.integer ? 0 : 2))+
    (series.suffix ?? '')+(spread == null ? '' : ' ± '+format(spread))
}
function inspectPrediction(index, showReading = false) {
  predictedIndex.value = index
  showPredictionReading.value = showReading && index != null
  if (index != null) hovered.value = null
  chart?.draw()
}
function findPeak() {
  hovered.value = null
  inspectPrediction(null)
  emit('peak',props.peakDay)
}
function toggle(label) {
  hidden.value=hidden.value.includes(label) ? hidden.value.filter(x=>x!==label) : [...hidden.value,label]
}
function move(event) {
  if(!props.rows.length) return
  if (predictedIndex.value != null && ['Enter',' '].includes(event.key)) {
    event.preventDefault()
    return
  }
  if(event.key==='Enter' && active.value) { event.preventDefault(); emit('watch',active.value); return }
  if(event.key===' ' && active.value) { event.preventDefault(); emit('pin',active.value); return }
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
  event.preventDefault()
  const index = predictedIndex.value == null ? props.rows.findIndex(row => row.day === active.value) :
    props.rows.length + predictedIndex.value
  const last = props.rows.length - 1
  let next = 0
  if (event.key === 'End') next = last
  else if (event.key !== 'Home' && index >= 0) {
    const step = event.key === 'ArrowRight' ? 1 : -1
    next = Math.max(0, Math.min(last + predictionDays.value.length, index + step))
  }
  if (next > last) { inspectPrediction(next - last - 1, true); return }
  inspectPrediction(null)
  const day=props.rows[next].day
  hovered.value=day
  emit('pin',day)
  chart?.draw()
}
function indexAt(event) {
  const x=event.clientX-canvas.value.getBoundingClientRect().left
  return Math.max(0,chart.scales.x.getValueForPixel(x))
}
function startBrush(event) {
  if (!chart || props.embedded || !event.shiftKey || !props.rows.length || event.button!==0) return
  const index=indexAt(event)
  if (index >= props.rows.length) return
  brush={ start:index, end:index }
  canvas.value.setPointerCapture(event.pointerId)
}
function moveBrush(event) {
  if (!brush) return
  brush.end=Math.min(props.rows.length-1,indexAt(event))
  chart.draw()
}
function endBrush() {
  if (!brush) return
  const { start,end }=brush
  brush=null
  chart.draw()
  if (start===end) return
  ignoreClick=true
  setTimeout(()=>{ignoreClick=false},80)
  emit('range',props.rows[Math.min(start,end)].day,props.rows[Math.max(start,end)].day)
}
function forecastBoundary(instance) {
  if (!predictionDays.value.length) return null
  const x = instance.scales.x
  return (x.getPixelForValue(props.rows.length-1) + x.getPixelForValue(props.rows.length)) / 2
}
const marker = {
  id:'day-marker',
  beforeDatasetsDraw(instance) {
    const index=props.rows.findIndex(r=>r.day===active.value)
    const area=instance.chartArea
    if (!area) return
    const dayX=i=>instance.scales.x.getPixelForValue(i)
    const ctx=instance.ctx
    ctx.save()
    if (brush) {
      ctx.fillStyle='#71D2C044'
      ctx.fillRect(dayX(Math.min(brush.start,brush.end)),area.top,
        Math.abs(dayX(brush.end)-dayX(brush.start)),area.bottom-area.top)
    }
    function mark(x, ink, dash=[]) {
      ctx.strokeStyle=ink
      ctx.lineWidth=1
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.moveTo(x,area.top)
      ctx.lineTo(x,area.bottom)
      ctx.stroke()
    }
    const boundary = forecastBoundary(instance)
    if (boundary != null) {
      ctx.fillStyle='#83B3CE17'
      ctx.fillRect(boundary,area.top,area.right-boundary,area.bottom-area.top)
      mark(boundary,'#83B3CE99',[3,4])
      if (firstExtended.value > 0) {
        const end = dayX(props.rows.length + firstExtended.value - 1)
        const next = dayX(props.rows.length + firstExtended.value)
        mark((end + next)/2,'#A9D2E799',[2,3])
      }
    }
    for (const annotation of props.annotations ?? []) {
      const i=props.rows.findIndex(row=>row.day===annotation.day)
      if(i>=0) mark(dayX(i),annotation.color,[3,4])
    }
    if(index>=0) mark(dayX(index),props.pin===active.value?'#BDBAB0':'#777268')
    if(predictedIndex.value!=null) mark(dayX(props.rows.length+predictedIndex.value),'#A9D2E7',[2,3])
    ctx.restore()
  },
  afterDatasetsDraw(instance) {
    const area=instance.chartArea
    if (!area) return
    const ctx=instance.ctx
    if (props.guide != null) {
      const y = instance.scales.y.getPixelForValue(props.guide)
      if (y>=area.top && y<=area.bottom) {
        ctx.save()
        ctx.strokeStyle='#99958a'
        ctx.fillStyle='#BDBAB0'
        ctx.setLineDash([4,4])
        ctx.beginPath()
        ctx.moveTo(area.left,y)
        ctx.lineTo(area.right,y)
        ctx.stroke()
        ctx.fillText('Size 100',area.left+5,y-5)
        ctx.restore()
      }
    }
    if (predictionDays.value.length) {
      ctx.save()
      ctx.font='11px "Lab Mono", monospace'
      const label=firstExtended.value === 0 ? 'Prediction · If extended' :
        firstExtended.value > 0 ? 'Prediction · Includes extension' : 'Prediction'
      const width=ctx.measureText(label).width+10
      const x=area.right-width
      ctx.fillStyle='#202F37'
      ctx.fillRect(x,area.top+2,width,17)
      ctx.fillStyle='#C4E5F4'
      ctx.fillText(label,x+5,area.top+14)
      ctx.restore()
    }
  }
}
const axis = { color:'#BDBAB0',font:{family:'Source Sans',size:12},maxTicksLimit:6 }
function isPrediction(index) {
  return index >= props.rows.length && index < props.rows.length + predictionDays.value.length
}
function isTouch(event) {
  return event?.pointerType === 'touch' || event?.sourceCapabilities?.firesTouchEvents ||
    event?.type.startsWith('touch') || matchMedia('(pointer:coarse)').matches
}
function update() {
  if(!chart) return
  const history = props.rows.length
  chart.data.labels=[...props.rows.map(r=>r.day), ...predictionDays.value]
  chart.data.datasets=props.series.map(s=>({
    type:s.bar?'bar':'line', label:s.label, data:props.rows.map(s.value), borderColor:s.color,
    backgroundColor:s.fill ?? s.color, borderDash:s.dash ?? [], borderWidth:s.width ?? (s.bar ? 0 : 2.2),
    pointRadius:!s.bar && (s.primary || (s.width ?? 2)>=2) && props.rows.length<=25 ? 1.8 : 0,
    pointHoverRadius:s.bar || s.tooltip===false?0:3.8, spanGaps:false, hidden:hidden.value.includes(s.label), tension:0,
    yAxisID:s.axis ?? 'y', fill:s.area ?? false, categoryPercentage:.8, barPercentage:.84,
    grouped:!s.bar, order:s.bar?2:!s.primary && s.width && s.width<2?1:0
  }))
  const forecastFills = new Map(projections.value.map((p, i) => [p.index, props.series.length+i]))
  for (const projection of projections.value) {
    const { series:s, index, values } = projection
    const actual = chart.data.datasets[index]
    const data = Array(history).fill(null)
    if (!s.bar) data[history-1] = actual.data[history-1]
    chart.data.datasets.push({
      ...actual, projection, data:[...data,...values], borderDash:[5,4], borderWidth:s.bar ? 1.5 : Math.max(1,s.width ?? 2),
      borderColor:s.color.length === 9 ? s.color.slice(0,7)+'80' : s.color,
      backgroundColor:s.bar ? s.color.slice(0,7)+'29' : s.fill ? s.fill.slice(0,7)+'10' : s.color,
      borderSkipped:false,
      pointRadius: context => {
        const { dataIndex: i, dataset } = context
        return !s.bar && i >= history && dataset.data[i] != null &&
          dataset.data[i - 1] == null && dataset.data[i + 1] == null ? 2.5 : 0
      },
      pointHoverRadius:s.bar ? 0 : 3,
      fill:typeof s.area==='number' ? forecastFills.get(s.area) ?? false : actual.fill,
    })
  }
  chart.options.scales.y.beginAtZero=props.series.some(s=>s.bar || s.zero)
  if (props.embedded) chart.options.scales.y.ticks.precision=props.series[0]?.integer ? 0 : undefined
  chart.options.scales.y1.display=!!props.right
  chart.update('none')
}
function create() {
  const ticks=props.compact ? { ...axis,color:'#8E8A80',font:{...axis.font,size:11} } : axis
  chart=new Chart(canvas.value,{
    type:'line', plugins:[marker],data:{labels:[],datasets:[]},
    options:{
      responsive:true,maintainAspectRatio:false,animation:false, interaction:{ mode:'index', intersect:false },
      onHover(event,elements) {
        if (isTouch(event.native)) return
        const index = chart.scales.x.getValueForPixel(event.x)
        if (isPrediction(index)) {
          inspectPrediction(index-props.rows.length)
          return
        }
        hovered.value=elements.length ? props.rows[elements[0].index]?.day : null
        inspectPrediction(null)
      },
      onClick(event,elements) {
        if(ignoreClick) return
        const xIndex=chart.scales.x.getValueForPixel(event.x)
        const touch=isTouch(event.native)
        if (isPrediction(xIndex)) {
          inspectPrediction(xIndex-props.rows.length,touch)
          return
        }
        inspectPrediction(null)
        const index=props.embedded ? xIndex : elements[0]?.index
        const day=props.rows[index]?.day
        if(day==null) return
        if(props.embedded || touch || event.native?.shiftKey) emit('pin',day)
        else emit('watch',day)
      },
      layout:{padding:{left:8,right:12,top:6}},
      plugins:{filler:{propagate:false},tooltip:{
        enabled:true, backgroundColor:'#111110',titleColor:'#FFFDFC',bodyColor:'#BDBAB0',
        padding:11, borderColor:'#56534A', borderWidth:1, cornerRadius:4,
        titleFont:{family:'Lab Mono',size:15},bodyFont:{family:'Lab Mono',size:12},
        displayColors:true,
        filter:item=>item.dataset.projection
          ? item.dataIndex >= props.rows.length && !showPredictionReading.value : props.series[item.datasetIndex]?.tooltip!==false,
        callbacks:{
          title(items) {
            const item = items[0]
            const projected = item?.dataset.projection
            const row = projected && props.futureRows[item.dataIndex - props.rows.length]
            const extended = row && items.every(i => i.dataset.projection && isExtended(i.dataset.projection.series, row))
            return (projected ? extended ? 'Predicted · If extended · ' : 'Predicted · ' : '') +
              (props.embedded ? 'Generation ' : 'Day ')+item?.label
          },
          afterTitle:()=>props.scope ?? '',
          label(item) {
            const p=item.dataset.projection
            const series=p?.series ?? props.series[item.datasetIndex]
            const row = p ? props.futureRows[item.dataIndex - props.rows.length] : props.rows[item.dataIndex]
            return seriesReading(series,item.raw,row && series.spread?.(row))+
              (p && isExtended(series, row) ? ' (If extended)' : '')
          }
        }
      }},
      scales:{
        x:{ ticks:{...ticks,minRotation:0,maxRotation:0},grid:{display:false},border:{color:props.compact?'#3D3A35':'#56534A'},
          title:{display:props.embedded,text:'Generation',color:ticks.color,font:ticks.font} },
        y:{ min:props.min,max:props.max,ticks,grid:{display:!props.compact,color:ctx=>ctx.tick.value===0?'#545147':'#33332F'},
          border:{color:props.compact?'#3D3A35':'#45433F'},grace:'7%' },
        y1:{ position:'right', display:false, beginAtZero:true, ticks:{...axis,color:'#EEEDD6'},grid:{drawOnChartArea:false},border:{color:'#45433F'} }
      }
    }
  })
  update()
}
onMounted(create)
onBeforeUnmount(()=>chart?.destroy())
watch(()=>[props.rows,props.series,props.right,props.guide,hidden.value,projections.value],()=>{
  predictedIndex.value=null
  showPredictionReading.value=false
  brush=null
  update()
})
watch(()=>[props.pin,props.annotations],([pin],[previous])=>{
  if (props.embedded && pin == null && previous != null) hovered.value=null
  chart?.draw()
})
function downloadChart() {
  const source = canvas.value
  const image = document.createElement('canvas')
  image.width = source.width
  image.height = source.height
  const context = image.getContext('2d')
  if (!context) return
  context.fillStyle = getComputedStyle(source).getPropertyValue('--stage').trim()
  context.fillRect(0, 0, image.width, image.height)
  context.drawImage(source, 0, 0)

  const link = document.createElement('a')
  link.download = props.title.toLowerCase().replaceAll(' ', '-') + '.png'
  link.href = image.toDataURL('image/png')
  link.click()
}
</script>
<template>
  <article class="trend-plot" :class="{ 'focused-plot':focus || spotlight, 'spotlight-plot':spotlight, 'compact-plot':compact }" :style="{'--plot':color || '#EEEDD6'}"
    :aria-label="title+' chart'" :id="focus ? undefined : 'chart-'+title.toLowerCase().replaceAll(' ','-')">
    <header class="plot-heading">
      <button v-if="hideable && !focus && !spotlight" class="chart-hide" :aria-label="'Hide '+title" @click="emit('hide')"><Minus :size="13"/></button>
      <h2>{{ title }}</h2>
      <button v-if="peakDay!==undefined" type="button" class="secondary plot-peak" :disabled="peakDay===null" @click="findPeak">Find peak</button>
      <button v-if="!embedded" class="icon plot-focus" :aria-label="focus || spotlight ? 'Close focus chart' : 'Focus '+title" @click="emit('focus')">
        <Minimize2 v-if="focus || spotlight" :size="16"/><Maximize2 v-else :size="16"/>
      </button>
    </header>
    <div v-if="unit || !embedded" class="chart-unit">{{ unit }}</div>
    <div class="chart-canvas" @mouseleave="!showPredictionReading && (hovered=null, inspectPrediction(null))">
      <canvas ref="canvas" tabindex="0" role="img"
        :aria-label="title+' by generation. Arrow keys select a day or inspect a prediction. Enter watches a recorded day and Space pins it.'"
        @keydown="move" @blur="showPredictionReading && inspectPrediction(null)"
        @pointerdown="startBrush" @pointermove="moveBrush" @pointerup="endBrush" @pointercancel="brush=null;chart?.draw()"></canvas>
      <span v-if="!hasSamples" class="chart-empty">{{ rows.length ? 'No samples in this range' : 'No completed days in this range' }}</span>
      <span class="prediction-reading" :class="{ 'is-visible': showPredictionReading && predictionReading }" role="status">{{ predictionReading }}</span>
    </div>
    <div v-if="legend" class="chart-keys">
      <button v-for="s in keys" :key="s.label" :aria-pressed="!hidden.includes(s.label)" @click="toggle(s.label)">
        <i :style="{borderColor:s.color,borderTopStyle:s.dash?'dashed':'solid'}"></i>{{ s.label }}
      </button>
    </div>
    <div v-if="focus || spotlight" class="focused-actions">
      <button class="secondary" :disabled="!active || predictedIndex!=null" @click="emit('pin',active)">Pin day</button>
      <button class="secondary" @click="downloadChart">Download chart PNG</button>
    </div>
  </article>
</template>
