import { computed, onScopeDispose, ref, shallowRef, toRaw, watch } from 'vue'
import { forecastCheckpoint, forecastEndpoint } from './forecast.js'
import { forecastPreferences } from './forecast-preferences.js'

const entries = new Map()
const cacheLimit = 8
const timeout = 30_000

function rulesKey({ days, name, ...rules }) {
  return rules
}

function releaseJob(entry) {
  clearTimeout(entry.timer)
  entry.timer = null
  entry.worker?.terminate()
  entry.worker = null
  entry.pending.value = false
}

function trimCache() {
  for (const [key, entry] of entries) {
    if (entries.size <= cacheLimit) break
    if (!entry.users) entries.delete(key)
  }
}

function reuseResults(entry, run) {
  for (const candidate of Array.from(entries.values()).reverse()) {
    if (candidate.model !== entry.model || candidate.end >= entry.end || candidate.through < entry.end) continue
    const completed = candidate.rows.value.filter(row => row.day <= entry.end)
    // Only reuse simulated state after its newly recorded days match the real run.
    if (completed.length !== entry.end - candidate.end ||
        !completed.every(row => JSON.stringify(row) === JSON.stringify(run.summaries[row.day - 1]))) continue
    entry.through = candidate.through
    entry.checkpoint = candidate.checkpoint
    entry.rows.value = candidate.rows.value.filter(row => row.day > entry.end)
    return
  }
}

function acquire({ key, model, end, run }) {
  let entry = entries.get(key)
  if (!entry) {
    const checkpoint = forecastCheckpoint(run, end)
    entry = {
      key, model, end, through: checkpoint?.day ?? 0, checkpoint,
      rows: shallowRef([]), error: ref(false), pending: ref(false),
      users: 0, timer: null, worker: null, target: 0,
    }
    reuseResults(entry, run)
  }
  entries.delete(key)
  entries.set(key, entry)
  entry.users++
  return entry
}

function requestForecast(entry, request) {
  const { run, end, target } = request
  if (entry.through >= target || entry.checkpoint?.roster.length === 0 ||
      entry.error.value || (entry.pending.value && entry.target >= target)) return

  releaseJob(entry)
  entry.pending.value = true
  entry.target = target
  const fail = () => {
    releaseJob(entry)
    entry.error.value = true
  }
  // Let consecutive Quick Sim commits settle before starting another worker.
  entry.timer = setTimeout(() => {
    try {
      if (!entry.checkpoint) return fail()
      const worker = new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' })
      entry.worker = worker
      const heartbeat = () => {
        clearTimeout(entry.timer)
        entry.timer = setTimeout(fail, timeout)
      }
      worker.onerror = worker.onmessageerror = () => {
        if (entry.worker === worker) fail()
      }
      worker.onmessage = ({ data }) => {
        if (entry.worker !== worker) return
        if (data.type === 'forecast-progress') heartbeat()
        if (data.type === 'error') fail()
        if (data.type === 'forecast-result') {
          entry.through = data.through
          entry.checkpoint = data.checkpoint
          entry.rows.value = [...entry.rows.value, ...data.summaries]
          releaseJob(entry)
        }
      }
      heartbeat()
      worker.postMessage({
        type: 'forecast', setup: toRaw(run.setup), revisions: toRaw(run.revisions),
        start: entry.through, end, target, checkpoint: toRaw(entry.checkpoint),
      })
    } catch {
      fail()
    }
  }, 120)
}

export function useForecast(getRun, getVisibleRows, isActive = () => true) {
  const request = computed(() => {
    if (!forecastPreferences.enabled || !isActive()) return null
    const run = getRun()
    if (!run) return null
    const end = forecastEndpoint(getVisibleRows())
    if (end == null || !run.summaries[end - 1]?.rows.all.population) return null
    const model = JSON.stringify([run.id, rulesKey(run.setup), run.revisions.map(({ day, setup }) => [day, rulesKey(setup)])])
    return { key: `${model}:${end}`, model, run, end, target: end + forecastPreferences.cycles }
  })
  const entry = shallowRef(null)
  function release() {
    if (entry.value && --entry.value.users === 0) releaseJob(entry.value)
    trimCache()
  }
  watch([() => request.value?.key, () => request.value?.target], ([key], [previous] = []) => {
    if (key !== previous) {
      const next = key ? acquire(request.value) : null
      release()
      entry.value = next
    }
    if (entry.value) requestForecast(entry.value, request.value)
  }, { immediate: true })
  onScopeDispose(release)

  return {
    rows: computed(() => {
      const current = request.value
      if (!entry.value || entry.value.key !== current?.key) return []
      return entry.value.rows.value.slice(0, forecastPreferences.cycles)
        .map(row => ({ ...row, ifExtended: row.day > current.run.setup.days }))
    }),
    pending: computed(() => entry.value?.pending.value ?? false),
    error: computed(() => entry.value?.error.value ?? false),
    retry() {
      if (!entry.value || !request.value) return
      entry.value.error.value = false
      requestForecast(entry.value, request.value)
    },
  }
}
