<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { CircleX, Download, FastForward, Upload } from 'lucide-vue-next'
import { useLab } from '../store.js'
import { MAX_RUN_DAYS, starter, randomSeed, rulesFor, validate } from '../engine/config.js'
import { foodWebAt } from '../engine/food-web.js'
import { runSpecies } from '../engine/species-actions.js'
import { csv, download, setupLink } from '../export.js'
import AdvancedStats from './AdvancedStats.vue'
import GenerationTable from './GenerationTable.vue'

const lab=useLab()
const emit=defineEmits(['compare','watch','resume','results','batch-results','extend-and-play'])
const dialog=ref(), mode=ref('additional'), amount=ref(10), target=ref(1), extension=ref(10)
const message=ref(''), search=ref(''), file=ref(), removeId=ref(null), renameId=ref(null), newName=ref('')
const actionsId=ref(null)
const end=ref(lab.completed), start=ref(1), exportScope=ref(lab.scope), exportKind=ref('csv'), branchDay=ref(Math.max(1,Math.min(lab.viewing,lab.latestBranchDay)))
const branchFoodOverride = ref(null)
const branchFood = computed({
  get: () => branchFoodOverride.value ?? lab.run.summaries[branchDay.value - 1]?.rows.all.food ?? lab.run.setup.food,
  set: value => { branchFoodOverride.value = value },
})
const startProgress=ref(lab.completed), endProgress=ref(lab.completed), resumeLive=ref(false)
const remaining=computed(()=>MAX_RUN_DAYS-lab.run.setup.days)
const validExtension=computed(()=>Number.isInteger(extension.value)&&extension.value>=1&&extension.value<=remaining.value)
const extendedLimit=computed(()=>lab.run.setup.days+extension.value)
const nextDay = computed(() => lab.completed + 1)
const quickCapacity=computed(()=>Math.max(0,MAX_RUN_DAYS-lab.completed))
const finish=computed(()=>mode.value==='absolute'?target.value:lab.completed+amount.value)
const nextDayLabel = computed(() => {
  if (lab.extinctDay) return 'Population extinct'
  if (lab.completed >= MAX_RUN_DAYS) return 'Generation limit reached'
  if (nextDay.value > lab.run.setup.days) return 'Run complete'
  return `Day ${nextDay.value}`
})
const dayRange = (first, last) => first === last ? `Day ${first}` : `Days ${first}–${last}`
const batchSummary=computed(()=>{
  const days=lab.run.summaries.filter(day=>day.day>startProgress.value&&day.day<=lab.completed)
  if(!days.length)return null
  const total=key=>days.reduce((sum,day)=>sum+(day.rows.all[key]??0),0)
  return {opening:days[0].rows.all.opening,closing:days.at(-1).rows.all.population,
    births:total('births'),deaths:total('deaths'),meals:total('plants')+total('hunts')}
})
const quickPreview = computed(() => {
  const first = nextDay.value, last = finish.value
  const extension = last > lab.run.setup.days && last > lab.completed
    ? ` The run will extend through Day ${last}.`
    : ''
  if (last <= lab.completed) return `Day ${last} is ready to watch.`
  const current=lab.liveFrame
  const unfinished=current?.day===first&&current.time>0&&current.time<current.duration
  if (!unfinished) return `Complete ${dayRange(first, last)}.${extension}`
  if (first === last) return `Finish Day ${first}.${extension}`
  return `Finish Day ${first}, then complete ${dayRange(first + 1, last)}.${extension}`
})
const matches=computed(()=>{
  const query=search.value.trim().toLowerCase()
  const exactSeed=run=>String(run.setup.seed)===query
  return lab.library
    .filter(({setup})=>setup.name.toLowerCase().includes(query) || String(setup.seed).includes(query))
    .sort((a,b)=>Number(exactSeed(b))-Number(exactSeed(a)) || b.created-a.created)
})
const canSim=computed(()=>Number.isInteger(finish.value)&&finish.value>=1&&finish.value<=MAX_RUN_DAYS&&
  (mode.value==='absolute' ? finish.value<=lab.completed || lab.canQuickSim :
    Number.isInteger(amount.value)&&amount.value>=1&&amount.value<=quickCapacity.value&&lab.canQuickSim))
const canExportCsv = computed(() => Number.isInteger(start.value) && Number.isInteger(end.value) &&
  start.value >= 1 && start.value <= end.value && end.value <= lab.completed)
const exportRowCount = computed(() => {
  if (!canExportCsv.value) return 0
  return lab.run.summaries.filter(day => day.day >= start.value && day.day <= end.value)
    .reduce((total, { rows }) => total + (exportScope.value === '*' ? Object.keys(rows).length : Number(!!rows[exportScope.value])), 0)
})
const titles={quick:'Quick Sim','quick-progress':'Simulating generations','quick-done':'Simulation complete',
  'quick-stopped':'Simulation stopped',extend:'More Generations',
  library:'Run Library',download:'Download',table:'Generation statistics','advanced-stats':'Advanced stats',branch:'Branch here'}
watch(()=>lab.modal,key=>{
  message.value=''
  if(key!=='library') actionsId.value=null
  if(key==='quick') {
    resumeLive.value=!lab.replay && lab.playing
    if(!lab.replay) lab.stopPlayback()
    mode.value=lab.targetDay || quickCapacity.value===0 || lab.extinctDay?'absolute':'additional'
    amount.value=readQuickCount(quickCapacity.value)
    target.value=lab.targetDay ?? (quickCapacity.value ? lab.completed+amount.value : lab.completed)
    lab.targetDay=null
  }
  if(key==='quick-progress' && lab.batch) { startProgress.value=lab.batch.start; endProgress.value=lab.batch.target }
  if(key==='extend') extension.value=Math.min(10,remaining.value)
  if(key==='download') {
    start.value = lab.downloadRange?.start ?? 1
    end.value = lab.downloadRange?.end ?? lab.completed
    exportScope.value = lab.scope
    lab.downloadRange = null
  }
},{immediate:true})
function close() {
  if(lab.modal==='quick'&&resumeLive.value&&!lab.replay&&!lab.playing) lab.play()
  if(lab.modal==='branch') lab.cancelBranch()
  if(lab.modal==='advanced-stats') dialog.value.close()
  lab.modal=null
}
function simulate() {
  if(!canSim.value) return
  if(finish.value<=lab.completed) { const day=finish.value;lab.modal=null;emit('watch',day);return }
  if(lab.simulate(finish.value)) {
    lab.modal='quick-progress'
  }
}
function readQuickCount(capacity) {
  if(!capacity)return 0
  try {
    const value=Number(localStorage.getItem('evolution.quick-sim-count'))
    return Number.isInteger(value)&&value>=1?Math.min(value,capacity):Math.min(10,capacity)
  } catch { return Math.min(10,capacity) }
}
function saveQuickCount() {
  if(mode.value!=='additional')return
  try { localStorage.setItem('evolution.quick-sim-count',String(amount.value)) } catch {}
}
function rememberQuickCount() {
  if(Number.isInteger(amount.value)&&amount.value>=1&&amount.value<=quickCapacity.value) saveQuickCount()
}
function exportRun() {
  if (exportKind.value === 'setup') setupDownload(lab.run)
  else if (canExportCsv.value) download('evolution-results.csv', 'text/csv;charset=utf-8', csv(lab.run, exportScope.value, start.value, end.value))
  else return
  close()
}
function setupDownload(run) {
  download('evolution-setup.json','application/json',JSON.stringify({ setup:run.setup, revisions:run.revisions,
    ...(run.speciesActions?.length && { speciesActions: run.speciesActions }),
    ...(run.traitAdjustments?.length && { traitAdjustments: run.traitAdjustments }),
  },null,2))
}
async function exportSavedSetup(id) {
  message.value=''
  try {
    const run=await lab.loadRun(id)
    if (!run) throw new Error('The saved run is unavailable.')
    setupDownload(run)
  } catch { message.value='Could not open the saved setup.' }
}
async function share(run) {
  const link=!run.ruleVersions.length && setupLink(run.setup)
  if(!link) { message.value='Use Export setup for branch histories or longer configurations.'; return }
  try { await navigator.clipboard.writeText(link); message.value='Setup link copied. It opens a new experiment draft.' }
  catch { message.value='The clipboard is unavailable. Use Export setup.' }
}
async function importSetup(event) {
  const picked=event.target.files[0]
  if(!picked)return
  try {
    const data=JSON.parse(await picked.text())
    const setup=data.setup ?? data
    const errors=Object.values(validate(setup))
    if(errors.length) { message.value=errors[0]; return }
    if(data.revisions?.length || data.speciesActions != null || data.traitAdjustments != null) {
      if(!await lab.importBranch(setup,data.revisions,data.speciesActions,data.traitAdjustments)) message.value='This file contains incompatible run history.'
      return
    }
    lab.openSettings(setup)
  } catch { message.value='Choose a valid setup JSON file.' }
}
async function createBranch(edit=false) {
  if(lab.branchPreparing!=null) return
  if(!Number.isInteger(branchDay.value)||branchDay.value<1||branchDay.value>lab.latestBranchDay||
     !Number.isInteger(branchFood.value)||branchFood.value<10||branchFood.value>1000){
    message.value='Choose a completed day before the run limit and a food count from 10 to 1,000.'
    return
  }
  const { setup: current, revisions } = lab.run
  const setup = {
    ...JSON.parse(JSON.stringify(rulesFor(current, revisions, branchDay.value))),
    foodWeb: foodWebAt(lab.run, branchDay.value),
    name: (current.name + ' · branch').slice(0,60),
    days: current.days,
    mode: current.mode,
    food: branchFood.value,
    scheduleMode: 'constant',
    schedule: [],
  }
  if(edit) { lab.openSettings(setup,branchDay.value); return }
  message.value=''
  try { await lab.branch(branchDay.value,setup) }
  catch(error){message.value=error.message}
}
onMounted(()=>dialog.value.showModal())
</script>
<template>
  <dialog ref="dialog" class="task-dialog" :class="{'wide-dialog':lab.modal==='library','generation-dialog':lab.modal==='table','advanced-stats-dialog':lab.modal==='advanced-stats'}" @cancel.prevent="close" aria-labelledby="dialog-title">
    <header><h2 id="dialog-title">{{ lab.modal==='quick-done' && lab.extinctDay ? 'Population extinct' : titles[lab.modal] }}</h2><button class="icon" aria-label="Close dialog" @click="close"><CircleX :size="23"/></button></header>
    <template v-if="lab.modal==='quick'">
      <p>Complete a chosen number of generations without animation.</p>
      <div class="split-options"><button class="secondary" :aria-pressed="mode==='additional'" @click="mode='additional'">Additional generations</button>
        <button class="secondary" :aria-pressed="mode==='absolute'" @click="mode='absolute'">Complete through day</button></div>
      <dl class="pair-readout"><dt>Watching</dt><dd>Day {{ lab.viewing }}</dd><dt>Next day to simulate</dt><dd>{{ nextDayLabel }}</dd><dt>Saved through</dt><dd>Day {{ lab.saved }}</dd></dl>
      <label v-if="mode==='additional'" class="dialog-field">Generations to complete <input v-model.number="amount" type="number" min="1" :max="quickCapacity" :disabled="quickCapacity===0" :aria-invalid="!Number.isInteger(amount)||amount<1||amount>quickCapacity" aria-describedby="quick-count-feedback" @change="rememberQuickCount" @keydown.enter.prevent="simulate"></label>
      <label v-else class="dialog-field">Target day <input v-model.number="target" type="number" min="1" :max="MAX_RUN_DAYS"></label>
      <p v-if="quickCapacity===0 && mode==='additional'" id="quick-count-feedback" class="issue">The run has reached the 1,000-generation limit.</p>
      <p v-else-if="mode==='additional' && (!Number.isInteger(amount)||amount<1||amount>quickCapacity)" id="quick-count-feedback" class="quiet">Enter a whole number from 1 to {{ quickCapacity }}.</p>
      <p v-else-if="finish>MAX_RUN_DAYS" class="issue">The run can go up to Generation {{ MAX_RUN_DAYS }}.</p>
      <p v-else-if="canSim" id="quick-count-feedback" class="destination">{{ quickPreview }}</p>
      <footer><button class="secondary" @click="close">Cancel</button>
        <button class="primary" :disabled="!canSim || finish>lab.completed && !lab.workerReady" @click="simulate"><FastForward v-if="mode==='additional'||finish>lab.completed" :size="16"/>{{ mode==='absolute'&&finish<=lab.completed?'Watch Day '+finish:'Simulate' }}</button>
      </footer>
    </template>
    <template v-else-if="['quick-progress','quick-done','quick-stopped'].includes(lab.modal)">
      <progress :value="Math.max(0,lab.completed-startProgress)" :max="Math.max(1,endProgress-startProgress)" aria-label="Batch progress"></progress>
      <dl class="pair-readout"><dt>Completed in this batch</dt><dd>{{ Math.max(0,lab.completed-startProgress) }} of {{ Math.max(0,endProgress-startProgress) }}</dd>
        <dt v-if="lab.batch">Computing</dt><dd v-if="lab.batch">Day {{ lab.completed+1 }}</dd>
        <dt>Completed through</dt><dd>Day {{ lab.completed }}</dd><dt>Saved through</dt><dd>Day {{ lab.saved }}</dd></dl>
      <dl v-if="batchSummary" class="quick-summary" aria-label="Batch results">
        <dt>Population</dt><dd>{{ batchSummary.opening }} → {{ batchSummary.closing }}</dd>
        <dt>Births</dt><dd>{{ batchSummary.births }}</dd>
        <dt>Deaths</dt><dd>{{ batchSummary.deaths }}</dd>
        <dt>Meals</dt><dd>{{ batchSummary.meals }}</dd>
      </dl>
      <p v-if="lab.batch?.stopping" class="quiet">Stopping at the next day boundary.</p>
      <p v-if="!lab.batch && lab.extinctDay" class="quiet">The last blobs died on Day {{ lab.extinctDay }}.</p>
      <footer><button class="secondary" @click="close">{{ lab.batch?'Hide progress':'Close' }}</button>
        <button v-if="lab.batch" class="primary" :disabled="lab.batch.stopping" @click="lab.stopBatch">Stop after this day</button>
        <template v-else>
          <button v-if="lab.canQuickSim" class="secondary" @click="lab.modal='quick'">New Quick Sim</button>
          <button v-if="lab.completed>startProgress" class="secondary" @click="emit('batch-results',{from:startProgress+1,to:lab.completed})">View batch results</button>
          <button v-if="lab.completed" class="primary" @click="emit('watch',lab.completed, null, { atEnd:!!lab.extinctDay })">Watch last day</button>
        </template>
      </footer>
    </template>
    <template v-else-if="lab.modal==='extend'">
      <p>Keep this run and schedule more generations after Day {{ lab.run.setup.days }}.</p>
      <label class="dialog-field">Additional generations
        <input v-model.number="extension" type="number" min="1" :max="remaining">
      </label>
      <p v-if="validExtension" class="quiet">
        The run will go through Day {{ extendedLimit }}. Play continues from Day {{ nextDay }}.
      </p>
      <p v-else-if="remaining > 0" class="issue">Enter a whole number from 1 to {{ remaining }}.</p>
      <p v-if="lab.extinctDay" class="quiet">The population went extinct on Day {{ lab.extinctDay }}.</p>
      <p v-else-if="remaining === 0" class="quiet">The run has reached its limit of {{ MAX_RUN_DAYS }} generations.</p>
      <p v-else-if="lab.batch" class="quiet">Stop or finish the current batch before extending.</p>
      <footer>
        <button class="secondary" @click="close">Cancel</button>
        <button class="secondary" :disabled="!lab.canExtend || !validExtension" @click="lab.extend(extendedLimit)">
          {{ lab.run.setup.mode==='prepare' ? 'Add and prepare' : 'Add only' }}
        </button>
        <button class="primary" :disabled="!lab.canExtend || !validExtension" @click="emit('extend-and-play', extendedLimit)">Add and play</button>
      </footer>
    </template>
    <template v-else-if="lab.modal==='download'">
      <div class="split-options"><button class="secondary" :aria-pressed="exportKind==='csv'" @click="exportKind='csv'">CSV results</button>
        <button class="secondary" :aria-pressed="exportKind==='setup'" @click="exportKind='setup'">Setup JSON</button></div>
      <template v-if="exportKind==='csv'">
        <label class="dialog-field">Scope <select v-model="exportScope"><option value="all">All species</option><option value="*">All scopes</option>
          <option v-for="s in runSpecies(lab.run).filter(s=>s.enabled)" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
        <label class="dialog-field">From day <input type="number" v-model.number="start" min="1" :max="end"></label>
        <label class="dialog-field">Through day <input type="number" v-model.number="end" :min="start" :max="lab.completed"></label>
        <p class="quiet">{{ exportRowCount }} data rows · Trait stats at dusk</p>
        <p v-if="!lab.completed" class="quiet">Complete a day to download results.</p>
        <p v-else-if="!canExportCsv" class="issue">Choose whole days from 1 through {{ lab.completed }} in order.</p>
      </template>
      <p v-else class="quiet">Includes the seed, species, rules, and food schedule.</p>
      <footer><button class="secondary" @click="close">Cancel</button><button class="primary" :disabled="exportKind==='csv'&&!canExportCsv" @click="exportRun"><Download :size="17"/> Download</button></footer>
    </template>
    <template v-else-if="lab.modal==='table'">
      <GenerationTable @watch="lab.modal=null;emit('watch',$event)"/>
      <footer><button class="secondary" @click="lab.openDownload()">Download</button><button class="primary" @click="close">Done</button></footer>
    </template>
    <template v-else-if="lab.modal==='advanced-stats'">
      <AdvancedStats @watch="lab.modal=null;emit('watch',$event)"/>
      <footer><button class="primary" @click="close">Done</button></footer>
    </template>
    <template v-else-if="lab.modal==='library'">
      <div class="library-tools"><input v-model="search" type="search" placeholder="Search name or seed" aria-label="Search runs by name or seed">
        <input ref="file" type="file" accept=".json,application/json" hidden @change="importSetup">
        <button class="secondary" @click="file.click()"><Upload :size="16"/> Import setup</button>
        <button class="primary" @click="lab.openSettings({...starter(),name:'New experiment',seed:randomSeed()})">New experiment</button>
      </div>
      <p v-if="lab.libraryLoading" class="quiet" role="status">Loading saved runs…</p>
      <p v-else-if="lab.libraryError" class="issue" role="alert">{{ lab.libraryError }}</p>
      <p v-else-if="!matches.length" class="quiet">No matching saved runs.</p>
      <div class="library-rows">
        <article v-for="run in matches" :key="run.id">
          <div><strong>{{ run.setup.name }}</strong> <span v-if="run.id===lab.run.id" class="teal">● Active</span>
            <small>Seed {{ run.setup.seed }} · Saved through Day {{ run.savedThrough }}</small></div>
          <button class="secondary" @click="emit('resume',run.id)">Resume</button>
          <button v-if="run.id!==lab.run.id" class="secondary" @click="emit('compare',run.id)">Compare</button>
          <button type="button" class="secondary library-action-toggle" :aria-expanded="actionsId===run.id"
            :aria-controls="'run-actions-'+run.id" @click="actionsId=actionsId===run.id ? null : run.id">Actions</button>
          <div v-show="actionsId===run.id" :id="'run-actions-'+run.id" class="library-menu" role="group" :aria-label="'Actions for '+run.setup.name">
            <button @click="emit('results',run.id)">View results</button>
            <button @click="renameId=run.id;newName=run.setup.name">Rename</button>
            <button @click="lab.openSettings({...run.setup,name:(run.setup.name+' copy').slice(0,60)})">Duplicate</button>
            <button @click="exportSavedSetup(run.id)">Export setup</button>
            <button @click="share(run)">Copy setup link</button>
            <button v-if="run.id!==lab.run.id" @click="removeId=run.id">Delete</button>
          </div>
          <form v-if="renameId===run.id" class="library-confirm" @submit.prevent="lab.rename(run.id,newName.trim());renameId=null"><label>Name <input v-model="newName" required maxlength="60"></label><button class="primary" :disabled="!newName.trim()">Save</button></form>
          <div v-if="removeId===run.id" class="library-confirm">Delete {{ run.setup.name }}? <button class="secondary" @click="removeId=null">Cancel</button>
            <button class="secondary issue" @click="lab.remove(run.id);removeId=null">Delete run</button></div>
        </article>
      </div>
    </template>
    <template v-else-if="lab.modal==='branch'">
      <p>Keep the committed history of {{ lab.run.setup.name }} and change plant supply from the next day.</p>
      <label class="dialog-field">Branch after day <input type="number" v-model.number="branchDay" min="1" :max="lab.latestBranchDay" :disabled="lab.branchPreparing!=null"></label>
      <label class="dialog-field">Plants per day <input type="number" v-model.number="branchFood" min="10" max="1000" :disabled="lab.branchPreparing!=null"></label>
      <p class="destination">First changed day {{ Number(branchDay)+1 }} · Seed {{ lab.run.setup.seed }}</p>
      <p v-if="lab.branchPreparing!=null" class="quiet" role="status">Preparing branch from Day {{ lab.branchPreparing }}…</p>
      <footer><button class="secondary" @click="close">Cancel</button><button class="secondary" :disabled="lab.branchPreparing!=null" @click="createBranch(true)">Edit branch rules</button>
        <button class="primary" :disabled="lab.branchPreparing!=null" @click="createBranch()">Create branch</button></footer>
    </template>
    <p v-if="message" class="issue" role="alert">{{ message }}</p>
  </dialog>
</template>
