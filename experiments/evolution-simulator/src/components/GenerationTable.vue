<script setup>
import { computed } from 'vue'
import { format, METRICS, metricValue } from '../engine/stats.js'
import { useLab } from '../store.js'

const lab = useLab()
const emit = defineEmits(['watch'])
const generations = computed(() => lab.run.summaries)
const species = computed(() => lab.run.setup.species.filter(item => item.enabled))
const columns = [
  { key:'opening', label:'Opening population' },
  { key:'population', label:'Closing population' },
  { key:'births', label:'Births' },
  { key:'deaths', label:'Deaths' },
  { key:'net', label:'Net change' },
  ...METRICS.filter(metric => metric.key !== 'population')
    .map(({ key, label, unit }) => ({ key, label, unit, average:true })),
  { key:'food', label:'Plants spawned', unit:'field total' },
  { key:'plants', label:'Plants eaten' },
  { key:'plantsLeft', label:'Plants left', unit:'field total' },
  { key:'hunts', label:'Successful hunts' },
]

function valueOf(row, column) {
  return column.average ? metricValue(row, column.key) : row?.[column.key]
}
</script>

<template>
  <div class="generation-sheet-tools">
    <label>Species <select v-model="lab.scope">
      <option value="all">All species</option>
      <option v-for="item in species" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select></label>
    <span class="quiet">{{ format(generations.length, 0) }} completed</span>
  </div>
  <p class="generation-sheet-note quiet">One row per generation · End-of-day results · Select a generation to replay it</p>
  <div class="generation-sheet" role="region" aria-label="Generation spreadsheet" tabindex="0">
    <table aria-label="Completed generations">
      <thead>
        <tr>
          <th scope="col">Generation</th>
          <th v-for="column in columns" :key="column.key" scope="col">
            {{ column.label }}<small v-if="column.unit">{{ column.unit }}</small>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="record in generations" :key="record.day" v-memo="[record, lab.scope]">
          <th scope="row"><button class="link" :aria-label="'Replay generation '+record.day" @click="emit('watch',record.day)">{{ record.day }}</button></th>
          <td v-for="column in columns" :key="column.key" :title="valueOf(record.rows[lab.scope],column)?.toString()">
            {{ format(valueOf(record.rows[lab.scope],column), column.average ? 2 : 0) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-if="!generations.length" class="quiet">The first row appears when Generation 1 finishes.</p>
</template>
