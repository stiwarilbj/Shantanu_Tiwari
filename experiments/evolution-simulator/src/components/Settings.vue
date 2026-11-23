<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { ChevronRight, CircleX, Copy, Dices, Plus, Check } from 'lucide-vue-next'
import { useLab } from '../store.js'
import { endsWhenSettled, LEGACY_RULE_VERSION, MAX_SEED, PALETTE, SETTLED_RULE_VERSION, TRAITS,
  randomSeed, speciesTemplate, usesHabitatRules, usesRefugeBorder, usesReproductionRules,
  usesStandardDeviation, usesWalkthroughForaging, validate } from '../engine/config.js'
import { travel, cost, walkthroughStepCost } from '../engine/geometry.js'
import HabitatSettings from './HabitatSettings.vue'
import NumberField from './NumberField.vue'

const lab = useLab()
const draft = lab.draft
const fork = lab.branchFrom
const standardDeviation = usesStandardDeviation(draft)
const customReproduction = usesReproductionRules(draft)
const spreadKey = standardDeviation ? 'standardDeviation' : 'variance'
const dialog = ref(), tab = ref(draft.species[0].id), issue = ref({}), savedSpecies = ref(null)
const copied = ref(false), discarding = ref(false), applying = ref(false)
const fields = ref(null), currentPage = ref('basic'), group = ref('habitat')
const groups = {
  habitat: 'Habitat and food', hunting: 'Hunting', movement: 'Movement and energy', inheritance: 'Inheritance and reproduction',
}
const advancedFields = {
  schedule: 'habitat', foodPlacement: 'habitat', patchCount: 'habitat', patchRadius: 'habitat',
  patchRelocation: 'habitat', patchInterval: 'habitat', refugePercent: 'habitat',
  huntingAdvantage: 'hunting', firstHuntingDay: 'hunting',
  plantReward: 'movement', preyReward: 'movement', endMode: 'movement', duration: 'movement', rules: 'movement',
  parentMode: 'inheritance', minimumBreedingAge: 'inheritance', birthWait: 'inheritance',
  birthChance: 'inheritance', twinChance: 'inheritance',
  mutation: 'inheritance', mutationChance: 'inheritance', mutationPattern: 'inheritance',
}
const customHabitat = computed(() => usesHabitatRules(draft))
const previewDay = ref((fork ?? 0) + 1)
const huntingAdvantage = computed(() => customHabitat.value ? draft.huntingAdvantage : draft.version === LEGACY_RULE_VERSION ? 20 : 25)
const maxPrey = computed(() => (1000 / (100 + huntingAdvantage.value)).toLocaleString('en-US', { maximumFractionDigits: 2 }))
const rulesSummary = computed(() => {
  const food = customHabitat.value && draft.foodPlacement === 'patches'
    ? `${draft.patchCount} food ${draft.patchCount === 1 ? 'patch' : 'patches'}` : 'Scattered food'
  const hunting = !draft.predation ? 'Hunting off' : draft.firstHuntingDay > 1 ? `Hunting starts Day ${draft.firstHuntingDay}` : 'Hunting from Day 1'
  return [food, hunting].join(' · ')
})
const selected = computed(() => draft.species.find(s => s.id===tab.value) ?? draft.species[0])
const paired = computed(() => draft.reproduction?.parentMode === 'pair')
const speedPreview = computed(() => {
  const baseline = paired.value ? 'Parents with speeds 8 and 12 give their child a starting speed of 10.' :
    'A parent with speed 10 gives its child a starting speed of 10.'
  const chance = customReproduction ? selected.value.inheritance.mutationChance.speed : 100
  const spread = selected.value[spreadKey].speed
  const deviation = standardDeviation ? spread : Math.sqrt(spread)
  if (!selected.value.mutation.speed || chance === 0 || spread === 0) return baseline + ' The child keeps that speed.'
  if (!Number.isFinite(chance) || !Number.isFinite(spread) || deviation < 0) return baseline
  const change = customReproduction && selected.value.inheritance.mutationPattern === 'bounded'
    ? `a change of up to ${Number((Math.sqrt(3) * deviation).toFixed(3))} in either direction`
    : `a bell-curve change with a standard deviation of ${Number(deviation.toFixed(3))}`
  return baseline + ` With these settings, it gets ${change} in ${chance}% of births.`
})
const mutationProfile = computed({
  get() {
    const { speed, size, sense } = selected.value.mutation
    if (speed && size && sense) return 'all'
    if (!size && !sense) return speed ? 'speed' : 'locked'
    return ''
  },
  set(profile) {
    for (const trait of TRAITS) {
      selected.value.mutation[trait] = profile === 'all' || (profile === 'speed' && trait === 'speed')
    }
  },
})
const seconds = computed({
  get: () => draft.duration == null || draft.duration === '' ? '' : draft.duration / 10,
  set: value => { draft.duration = value === '' ? '' : value * 10 },
})
const total = computed(() => draft.species.filter(s=>s.enabled).reduce((sum,s)=>sum+(Number(s.count)||0),0))
const endurance = computed(() => selected.value.energy/cost(selected.value,draft))
const swatches = { speed:'#9A5A57',size:'#44877C',sense:'#468298' }
const labels = { speed:'Speed',size:'Size',sense:'Sense Range' }
const titleErrors = computed(() => Object.entries(issue.value).map(([key,message])=>({key,message})))
const foraging = computed({
  get: () => usesWalkthroughForaging(draft) ? 'walkthrough' : 'standard',
  set: value => {
    if (value === 'walkthrough') draft.foraging = value
    else delete draft.foraging
  },
})
function add(copy=false) {
  const id = crypto.randomUUID()
  const original = selected.value
  const color = PALETTE.find(c=>!draft.species.some(s=>s.color.toLowerCase()===c.toLowerCase())) ??
    '#'+((draft.species.length*2654435761)>>>8).toString(16).padStart(6,'0')
  const stem = copy ? original.name.slice(0,23)+' copy' : 'Species'
  let name = copy ? stem : 'Species '+(draft.species.length+1)
  let i = 2
  while (draft.species.some(s=>s.name.toLowerCase()===name.toLowerCase())) name=stem+' '+i++
  draft.species.push(copy ? { ...JSON.parse(JSON.stringify(original)),id,name,color } : speciesTemplate(id,name,color,10,true,draft.version))
  tab.value=id
}
function remove() {
  if (draft.species.length<2) return
  const index=draft.species.findIndex(s=>s.id===tab.value)
  const [value]=draft.species.splice(index,1)
  savedSpecies.value={value,index}
  tab.value=draft.species[Math.max(0,index-1)].id
}
function undo() {
  const { value,index } = savedSpecies.value
  draft.species.splice(index,0,value)
  tab.value=value.id
  savedSpecies.value=null
}
function reorder(delta) {
  const index=draft.species.findIndex(s=>s.id===tab.value)
  const to=index+delta
  if(to<0 || to>=draft.species.length) return
  const [species]=draft.species.splice(index,1)
  draft.species.splice(to,0,species)
}
function showPage(page, nextGroup = 'habitat', focusHeading = false) {
  currentPage.value = page
  group.value = nextGroup
  fields.value.scrollTop = 0
  if (focusHeading) nextTick(() => document.getElementById('advanced-settings-title')?.focus())
}
async function copySeed() {
  try { await navigator.clipboard.writeText(String(draft.seed)); copied.value=true; setTimeout(()=>{ copied.value=false },1200) }
  catch { issue.value={ ...issue.value, clipboard:'Clipboard unavailable. Select the seed to copy it.' } }
}
function discard() {
  lab.resetDraft()
  tab.value=draft.species[0].id
  savedSpecies.value=null
  issue.value={}
  discarding.value=false
}
async function apply() {
  if(applying.value) return
  const errors=validate(draft)
  let setup=draft
  if(draft.scheduleMode==='constant' && errors.schedule) {
    setup={ ...draft, schedule:[] }
    delete errors.schedule
  }
  issue.value=errors
  if(fork != null && draft.days<=fork) issue.value.days='The run must continue beyond Day '+fork+'.'
  const first=Object.keys(issue.value)[0]
  if (first) {
    const forSpecies = draft.species.find(s => first.startsWith(s.id + '.'))
    if (forSpecies) tab.value = forSpecies.id
    const key = forSpecies ? first.slice(forSpecies.id.length + 1).split('.')[0] : first
    const target = key === spreadKey ? 'inheritance' : advancedFields[key]
    showPage(target ? 'advanced' : 'basic', target)
    await nextTick()
    const field = document.getElementById(first)
    const fallback = dialog.value.querySelector('.settings-errors')
    if (field && !field.disabled) field.focus()
    else fallback?.focus()
    return
  }
  applying.value=true
  try { issue.value=await lab.evolve(setup) }
  finally { applying.value=false }
}
onMounted(()=>dialog.value.showModal())
</script>
<template>
  <dialog ref="dialog" class="settings-sheet" aria-labelledby="settings-title" @cancel.prevent="lab.closeSettings()">
    <form class="settings-form" novalidate @submit.prevent="apply">
      <header class="settings-intro">
        <button type="button" class="icon settings-close" aria-label="Close settings" @click="lab.closeSettings()"><CircleX :size="26"/></button>
        <h1 id="settings-title">{{ fork==null ? 'Simulation Settings' : 'Branch Settings' }}</h1>
        <p v-if="fork==null">Choose the starting traits, then watch what survives.</p>
        <p v-else>Keep Days 1–{{ fork }}. Apply these rules from Day {{ fork+1 }}.</p>
      </header>
      <nav class="settings-pages" aria-label="Settings pages">
        <button type="button" :aria-pressed="currentPage === 'basic'" aria-controls="settings-panel"
          @click="showPage('basic')">Basic</button>
        <button type="button" :aria-pressed="currentPage === 'advanced'" aria-controls="settings-panel"
          @click="showPage('advanced', currentPage === 'advanced' ? group : 'habitat')">Advanced</button>
      </nav>
      <div v-if="currentPage === 'advanced'" class="advanced-settings">
        <h2 id="advanced-settings-title" tabindex="-1">Advanced Settings</h2>
        <nav class="advanced-groups" aria-label="Advanced settings groups">
          <button v-for="(label, key) in groups" :key="key" type="button" :aria-pressed="group === key"
            aria-controls="advanced-group" @click="showPage('advanced', key)">{{ label }}</button>
        </nav>
      </div>
      <div id="settings-panel" ref="fields" class="settings-fields">
        <template v-if="currentPage === 'basic'">
          <section class="setting-section">
            <h2>Blob Creatures</h2>
            <div class="species-tabs" aria-label="Edit species">
              <button v-for="s in draft.species" :key="s.id" type="button" class="secondary species-tab"
                :aria-pressed="selected.id===s.id" :style="{'--species':s.color}" @click="tab=s.id">
                <i></i>{{ s.name }}<small v-if="!s.enabled">Off</small>
              </button>
              <button v-if="fork==null" class="secondary" type="button" @click="add()"><Plus :size="15"/> Add species</button>
            </div>
            <div v-if="fork==null" class="species-editor">
              <label>Name <input :id="selected.id+'.name'" v-model="selected.name" maxlength="30"></label>
              <label>Color <input :id="selected.id+'.color'" v-model="selected.color" type="color"></label>
              <label><input v-model="selected.enabled" type="checkbox"> Enabled</label>
              <details class="species-actions"><summary>Species actions</summary>
                <button type="button" @click="add(true)">Duplicate</button><button type="button" @click="reorder(-1)">Move left</button>
                <button type="button" @click="reorder(1)">Move right</button><button type="button" :disabled="draft.species.length<2" @click="remove">Remove</button>
              </details>
            </div>
            <div v-if="savedSpecies" class="center quiet">Species removed from draft. <button type="button" class="link" @click="undo">Undo</button></div>
            <div v-if="fork==null" class="species-traits">
              <div class="species-trait-fields">
                <NumberField :id="selected.id+'.count'" v-model="selected.count" label="Founders" :min="10" :max="1000" compact :error="issue[selected.id+'.count']"/>
                <NumberField v-for="key in TRAITS" :id="selected.id+'.'+key" :key="key" v-model="selected[key]" :label="labels[key]"
                  :min="1" :max="100" :tint="swatches[key]" compact :error="issue[selected.id+'.'+key]"/>
              </div>
              <small class="quiet traits-readout">{{ travel(selected,draft).toFixed(0) }} units/s · {{ Number.isFinite(endurance) ? endurance.toFixed(1) : '—' }} s of movement on starting energy</small>
            </div>
          </section>
          <section class="setting-section">
            <button type="button" class="advanced-summary" @click="showPage('advanced', 'inheritance', true)">
              <span><strong>Inheritance and reproduction</strong><small>{{ paired ? 'Two parents' : 'Single parent' }} ·
                {{ TRAITS.filter(trait => selected.mutation[trait]).length }} traits allowed to mutate for {{ selected.name }}</small></span>
              <ChevronRight :size="17" aria-hidden="true"/>
            </button>
          </section>
          <section class="setting-section">
            <h2>Each generation</h2>
            <div class="daily-cards">
              <div class="daily-card energy-card">
                <NumberField :id="selected.id+'.energy'" v-model="selected.energy" label="Energy" :min="10" :max="1000" :pace="100" tint="#8F8048" compact :disabled="fork!=null" :error="issue[selected.id+'.energy']"/>
              </div>
              <div class="daily-card food-card">
                <NumberField id="food" v-model="draft.food" label="Food" :min="10" :max="1000" tint="#6C7C3A" compact :error="issue.food"/>
              </div>
            </div>
            <p class="quiet center reset-note">Food and energy reset at dawn.</p>
          </section>
          <section class="setting-section">
            <h2>Finally</h2>
            <div class="setting-inset final-fields">
              <label class="run-name">Run name <input id="name" v-model="draft.name" maxlength="60"></label>
              <NumberField id="days" v-model="draft.days" label="Days to run" :min="10" :max="1000" :error="issue.days"/>
              <NumberField id="seed" v-model="draft.seed" label="Random seed" :min="1" :max="MAX_SEED" :disabled="fork!=null" :error="issue.seed"/>
              <div class="seed-actions">
                <button v-if="fork==null" type="button" class="secondary" @click="draft.seed=randomSeed(draft.seed)"><Dices :size="16"/> Roll seed</button>
                <button type="button" class="secondary" @click="copySeed"><component :is="copied ? Check : Copy" :size="16"/>{{ copied ? 'Copied' : 'Copy seed' }}</button>
              </div>
            </div>
            <small v-if="endsWhenSettled(draft)" class="quiet run-days-note">Days end when creatures settle.</small>
            <div class="start-modes" aria-label="Playback mode">
              <button v-for="[mode,name,body] in [['prepare','Prepare and watch','Build the archive in the background.'],['live','Watch live','Run each tick as you watch.']]" :key="mode" type="button"
                class="secondary" :aria-pressed="draft.mode===mode" @click="draft.mode=mode"><strong>{{ name }}</strong><small>{{ body }}</small></button>
            </div>
          </section>
          <section class="setting-section">
            <button type="button" class="advanced-summary" @click="showPage('advanced', 'habitat', true)">
              <span><strong>Advanced Settings</strong><small>{{ rulesSummary }}</small></span>
              <ChevronRight :size="17" aria-hidden="true"/>
            </button>
          </section>
        </template>

        <section v-else id="advanced-group" class="advanced-group" :aria-label="groups[group]">
          <template v-if="group === 'habitat'">
            <HabitatSettings v-model:day="previewDay" :draft="draft" :fork="fork" :run="lab.run" :issue="issue"/>
            <p v-if="!customHabitat" class="quiet">This setup uses its original habitat and hunting rules.</p>
          </template>
          <div v-else-if="group === 'hunting'" class="advanced-block">
            <h3>Hunting rules</h3>
            <label class="advanced-toggle"><input v-model="draft.predation" type="checkbox"> Predation</label>
            <template v-if="draft.predation">
              <label class="advanced-toggle"><input v-model="draft.sameSpecies" type="checkbox"> Same-species hunting</label>
              <template v-if="customHabitat">
                <NumberField id="huntingAdvantage" v-model="draft.huntingAdvantage" label="Minimum hunting size advantage"
                  :min="5" :max="100" :error="issue.huntingAdvantage"/>
                <p v-if="!issue.huntingAdvantage && draft.huntingAdvantage >= 5 && draft.huntingAdvantage <= 100" class="quiet">
                  With a {{ huntingAdvantage }}% size advantage, a size-10 blob can hunt prey up to size {{ maxPrey }}.
                </p>
                <NumberField id="firstHuntingDay" v-model="draft.firstHuntingDay" label="First hunting day"
                  :min="1" :max="draft.days" :error="issue.firstHuntingDay"/>
                <p class="quiet">Blobs eat plants until this day. From this day on, the hunting rules apply to the whole field.</p>
              </template>
              <p v-else class="quiet">A hunter must be at least {{ huntingAdvantage }}% larger than its prey.</p>
            </template>
          </div>
          <template v-else-if="group === 'movement'">
            <div class="advanced-block">
              <h3>How blobs move</h3>
              <label v-if="standardDeviation" class="advanced-select">Foraging rules
                <select v-model="foraging"><option value="standard">Standard</option><option value="walkthrough">Video experiment</option></select>
              </label>
              <p v-if="foraging === 'walkthrough'" class="quiet">
                {{ usesRefugeBorder(draft) ? 'Blobs turn in steps and start each day along all four gray sides.' :
                  'Blobs turn in steps and start the next day where their parents reached the edge.' }}
              </p>
              <label class="advanced-select">Stride
                <select v-model="draft.stride"><option value="linked">Size-linked</option><option value="speed">Speed only</option></select>
              </label>
              <label class="advanced-select">Energy model
                <select v-model="draft.metabolism">
                  <option value="walkthrough">Video walkthrough</option><option value="product">Product</option><option value="additive">Earlier additive</option>
                </select>
              </label>
              <output class="energy-calculation" v-if="draft.metabolism==='walkthrough'">
                (size³ × (distance per step)² + sight range) ÷ 10,000
                <small>{{ walkthroughStepCost(selected,draft).toFixed(3) }} energy per 0.1 s step for {{ selected.name }}</small>
              </output>
              <output class="energy-calculation" v-else>
                {{ draft.metabolism==='product' ? 'size³ × speed² × sense ÷ 20,000' : '0.001 × (size³ × effective speed² + sense)' }}
                <small>{{ cost(selected,draft).toFixed(1) }} energy/s for {{ selected.name }}</small>
              </output>
            </div>
            <div class="advanced-block">
              <h3>Energy from meals</h3>
              <NumberField id="plantReward" v-model="draft.plantReward" label="Plant reward" :min="0" :max="1000" :pace="100" tint="#6C7C3A" :error="issue.plantReward"/>
              <NumberField id="preyReward" v-model="draft.preyReward" label="Prey reward" :min="0" :max="1000" :pace="100" tint="#8F8048" :error="issue.preyReward"/>
              <p class="quiet">Each meal gives one food credit. Energy refills up to the blob’s starting amount. A reward of 0 leaves energy unchanged.</p>
              <div class="advanced-actions">
                <button type="button" class="secondary" @click="draft.preyReward = draft.plantReward">Equal rewards</button>
              </div>
            </div>
            <div class="advanced-block">
              <h3>Day length</h3>
              <label v-if="draft.version >= SETTLED_RULE_VERSION" class="advanced-select">End each day
                <select id="endMode" v-model="draft.endMode">
                  <option value="settled">When all blobs settle or die</option>
                  <option value="timed">After a fixed time</option>
                </select>
              </label>
              <template v-if="!endsWhenSettled(draft)">
                <NumberField id="duration" v-model="seconds" label="Seconds per day" :min="1" :max="60" :step=".1" :error="issue.duration"/>
                <div class="quick-picks">
                  <button v-for="n in [1,5,10,20,30,60]" :key="n" type="button" class="secondary"
                    :aria-pressed="seconds === n" @click="seconds = n">{{ n }} s</button>
                </div>
                <small class="quiet">Up to {{ ((draft.days*seconds)/60).toFixed(1) }} min of playback at 1×</small>
              </template>
            </div>
          </template>
          <template v-else>
            <div class="advanced-block">
              <h3>Reproduction</h3>
              <p class="quiet">These rules apply to every species. To breed, a blob needs at least two food credits and a safe return to the refuge.</p>
              <template v-if="customReproduction">
                <label class="advanced-select">Parent mode
                  <select id="parentMode" v-model="draft.reproduction.parentMode">
                    <option value="single">Single parent</option><option value="pair">Two parents</option>
                  </select>
                </label>
                <p v-if="paired" class="quiet">At dusk, eligible blobs pair up with their own species anywhere in the refuge. A child starts with the average of its parents’ traits.</p>
                <NumberField id="minimumBreedingAge" v-model="draft.reproduction.minimumBreedingAge" label="Minimum breeding age"
                  :min="0" :max="30" :error="issue.minimumBreedingAge"/>
                <p class="quiet">Full generations a blob must finish before its breeding day. At 0, it can breed on its first day.</p>
                <NumberField id="birthWait" v-model="draft.reproduction.birthWait" label="Wait after a birth"
                  :min="0" :max="30" :error="issue.birthWait"/>
                <p class="quiet">Full generations to skip after having offspring. With a wait of 1, a Day 4 parent can breed again on Day 6.</p>
                <NumberField id="birthChance" v-model="draft.reproduction.birthChance" label="Chance of a birth (%)"
                  :min="0" :max="100" :error="issue.birthChance"/>
                <NumberField id="twinChance" v-model="draft.reproduction.twinChance" label="Chance of twins (%)"
                  :min="0" :max="100" :error="issue.twinChance"/>
                <p class="quiet">Each eligible {{ paired ? 'pair' : 'parent' }} gets one birth roll. Twins can happen after a successful roll.</p>
              </template>
              <p v-else class="quiet">In this setup, each eligible parent has one child.</p>
            </div>
            <div class="advanced-block">
              <h3>Inheritance</h3>
              <div class="species-tabs" aria-label="Edit species">
                <button v-for="s in draft.species" :key="s.id" type="button" class="secondary species-tab"
                  :aria-pressed="selected.id === s.id" :style="{'--species':s.color}" @click="tab = s.id">
                  <i></i>{{ s.name }}<small v-if="!s.enabled">Off</small>
                </button>
              </div>
              <p class="quiet">Each species has its own mutation settings.</p>
              <label class="advanced-select">Mutation profile
                <select v-model="mutationProfile">
                  <option value="" disabled>Custom</option><option value="all">All unlocked</option>
                  <option value="speed">Speed only</option><option value="locked">All locked</option>
                </select>
              </label>
              <label v-if="customReproduction" class="advanced-select">Mutation pattern
                <select :id="selected.id+'.mutationPattern'" v-model="selected.inheritance.mutationPattern">
                  <option value="normal">Bell curve</option><option value="bounded">Bounded random</option>
                </select>
              </label>
              <p class="quiet">{{ standardDeviation ? 'Standard deviation (σ)' : 'Variance (σ²)' }} sets the spread of a mutation.
                {{ customReproduction ? 'Bell curve favors small changes. Bounded random gives every change within its limit equal odds.' : 'Inherited traits stay at least 1.' }}</p>
              <div v-for="key in TRAITS" :key="key" class="inheritance-trait">
                <label class="advanced-toggle">
                  <input :id="selected.id+'.mutation.'+key" type="checkbox" v-model="selected.mutation[key]"
                    :aria-label="'Allow '+key+' mutation'"> Allow {{ labels[key].toLowerCase() }} mutation
                </label>
                <NumberField v-if="customReproduction" :id="selected.id+'.mutationChance.'+key"
                  v-model="selected.inheritance.mutationChance[key]" :label="labels[key]+' mutation chance (%)'"
                  :min="0" :max="100" :tint="swatches[key]" :error="issue[selected.id+'.mutationChance.'+key]"
                  :disabled="!selected.mutation[key] && !issue[selected.id+'.mutationChance.'+key]"/>
                <NumberField :id="selected.id+'.'+spreadKey+'.'+key" v-model="selected[spreadKey][key]"
                  :label="(standardDeviation ? 'σ ' : 'σ² ') + labels[key]"
                  :min="standardDeviation ? 0 : .01" :max="10" :step=".01" :pace="1" :tint="swatches[key]"
                  :error="issue[selected.id+'.'+spreadKey+'.'+key]"
                  :disabled="!selected.mutation[key] && !issue[selected.id+'.'+spreadKey+'.'+key]"/>
                <small v-if="standardDeviation && Number.isFinite(selected[spreadKey][key])" class="quiet">
                  Variance (σ²) = {{ Number((selected[spreadKey][key] ** 2).toFixed(3)) }}
                </small>
              </div>
              <div class="inheritance-preview">
                <h4>Example offspring</h4>
                <p class="quiet">{{ speedPreview }}</p>
              </div>
            </div>
          </template>
        </section>
      </div>
      <footer class="settings-footer">
        <div v-if="titleErrors.length" class="settings-errors issue" tabindex="-1" role="alert"><p>Review the setup</p><ul><li v-for="error in titleErrors" :key="error.key">{{ error.message }}</li></ul></div>
        <p>{{ draft.species.filter(s=>s.enabled).length }} enabled species · {{ total }} founders · {{ total ? (draft.food/total).toFixed(2) : '—' }} plants per founder</p>
        <p v-if="lab.draftChanged && fork==null" class="quiet">Draft has changes <button type="button" class="link" @click="discarding=true">Discard changes</button></p>
        <p v-if="discarding">Restore the setup you opened? <button type="button" class="secondary" @click="discard">Discard draft</button> <button type="button" class="link" @click="discarding=false">Keep editing</button></p>
        <p v-if="lab.branchPreparing!=null" class="quiet" role="status">Preparing branch from Day {{ lab.branchPreparing }}…</p>
        <button type="submit" class="primary evolve" :disabled="applying">{{ fork==null ? 'Evolve!' : 'Create branch' }}</button>
        <small class="quiet">by natural selection</small>
      </footer>
    </form>
  </dialog>
</template>
