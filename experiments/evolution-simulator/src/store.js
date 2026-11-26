import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { setupForNewRun, starter, STEERING_RULE_VERSION, validate, validateRevisions } from './engine/config.js'
import { dawnForRun, founders, snapshot } from './engine/simulation.js'
import { validSpeciesHistory } from './engine/species-actions.js'
import { validTraitAdjustment } from './engine/trait-adjustments.js'
import { DT, clamp } from './engine/geometry.js'
import { deleteRun, indexLegacyRuns, readLibrary, readRun, saveRun, saveRunPair, summarizeRun } from './archive.js'
import { adjacentFrameTime, prepareTrack, trackFrame } from './track.js'

const createWorker = () => new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' })
const WORKER_STARTUP_TIMEOUT = 10_000
const copy = value => JSON.parse(JSON.stringify(value))
const makeRun = setup => {
  const initial = founders(setup)
  return { id: crypto.randomUUID(), setup: copy(setup), revisions: [], created: Date.now(),
    summaries: [], checkpoints: [{ day: 0, ...initial }], latest: initial, partial: null }
}
const last = run => run?.summaries.at(-1)?.day ?? 0
const extinctionDay = run => run?.latest.roster.length === 0
  ? run.summaries.find(row => row.rows.all.population === 0)?.day ?? null
  : null
function historyAhead(run, frame) {
  const tick = Math.round(frame.time / frame.stepSeconds)
  return [run.speciesActions?.at(-1), run.traitAdjustments?.at(-1)].some(
    edit => edit && (edit.day > frame.day || (edit.day === frame.day && edit.tick > tick)),
  )
}
const hasEnded = frame => frame?.duration != null && frame.time >= frame.duration
function recordDay(run, { day, checkpoint, summary }) {
  const checkpoints = day % 10 === 0 ? [...run.checkpoints, { day, ...checkpoint }] : run.checkpoints
  return { ...run, summaries: [...run.summaries, summary], latest: checkpoint, partial: null, checkpoints }
}

export function prepareExperiment(setup, signal, progress) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = createWorker()
    let experiment = makeRun(setup)
    const startupTimer = setTimeout(() => {
      fail(new Error('The experiment took too long to start. Try again.'))
    }, WORKER_STARTUP_TIMEOUT)
    function cleanup() {
      clearTimeout(startupTimer)
      signal.removeEventListener('abort', abort)
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      worker.terminate()
    }
    function fail(error) {
      cleanup()
      reject(error)
    }
    function abort() { fail(signal.reason) }
    signal.addEventListener('abort', abort, { once:true })
    function workerFailed() { fail(new Error('The experiment worker stopped. Try again.')) }
    function send(message) {
      try { worker.postMessage(message) }
      catch { workerFailed() }
    }
    worker.onerror = worker.onmessageerror = workerFailed
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        clearTimeout(startupTimer)
        send({ type:'batch', target:setup.days })
      }
      if (data.type === 'error') fail(new Error(data.message))
      if (data.type === 'commit') {
        experiment = recordDay(experiment, data)
        progress(data.day)
      }
      if (data.type === 'done') {
        cleanup()
        if (last(experiment) !== setup.days && !extinctionDay(experiment)) reject(new Error('The experiment ended before the requested day.'))
        else resolve(experiment)
      }
    }
    send({ type:'init', config:setup, checkpoint:experiment.latest })
  })
}

export const useLab = defineStore('lab', () => {
  const run = shallowRef(null), library = shallowRef([])
  const libraryLoading = ref(true), libraryError = ref('')
  const frame = shallowRef(null), liveFrame = shallowRef(null)
  const viewing = ref(1), replay = ref(false), playing = ref(false)
  const rate = ref(6), through = ref(false), scope = ref('all')
  const replayDay = ref(null), replayFailure = shallowRef(null)
  const loading = computed(() => replayDay.value != null)
  const batch = shallowRef(null), saved = ref(0), error = ref('')
  const workerReady = ref(false), connecting = ref(false), workerError = ref('')
  const pending = ref(false), adjustingTraits = ref(false), traitAdjustmentError = ref('')
  const speciesResult = shallowRef(null)
  const selected = ref(null), following = ref(false)
  const settings = ref(false), draft = ref(null), modal = ref(null), targetDay = ref(null), branchFrom = ref(null)
  const branchRequest = shallowRef(null)
  const branchPreparing = computed(() => branchRequest.value?.day ?? null)
  let openingDraft
  const draftChanged = computed(() => draft.value != null && JSON.stringify(draft.value) !== openingDraft)
  const downloadRange = shallowRef(null)
  const completed = computed(() => run.value ? last(run.value) : 0)
  const extinctDay = computed(() => extinctionDay(run.value))
  const latestBranchDay = computed(() => Math.min(completed.value, (run.value?.setup.days ?? 1) - 1,
    (extinctDay.value ?? Infinity) - 1))
  const dayEnded = computed(() => hasEnded(frame.value))
  const displayDuration = computed(() => frame.value ? frame.value.duration : null)
  const liveDay = computed(() => liveFrame.value?.day ?? completed.value + 1)
  const canEnterLive = computed(() => workerReady.value && !batch.value && !extinctDay.value &&
    completed.value < (run.value?.setup.days ?? 0))
  const canChangeSpecies = computed(() => canEnterLive.value && !replay.value && !loading.value &&
    frame.value?.day > completed.value && !dayEnded.value)
  const recordedChangesAhead = computed(() => canChangeSpecies.value && historyAhead(run.value, frame.value))
  const canAdjustSpecies = computed(() => canChangeSpecies.value && !playing.value && !pending.value &&
    !adjustingTraits.value && !recordedChangesAhead.value && frame.value === liveFrame.value)
  const canOpenTraitAdjustment = computed(() => canChangeSpecies.value && !recordedChangesAhead.value &&
    frame.value.blobs.some(blob => blob.alive))
  const canAdjustTraits = computed(() => canOpenTraitAdjustment.value && canAdjustSpecies.value)
  const canMoveNext = computed(() => viewing.value < completed.value ||
    (viewing.value === completed.value && canEnterLive.value))
  const status = computed(() => {
    if (loading.value) return 'Building replay'
    if (batch.value?.stopping) return 'Stopping batch'
    if (!replay.value && batch.value) return 'Simulating'
    if (!replay.value && extinctDay.value) return 'Extinct'
    if (!replay.value && completed.value >= (run.value?.setup.days ?? Infinity)) return 'Finished'
    if (replay.value) return 'Replay'
    if (workerError.value) return 'Simulation unavailable'
    if (playing.value) return 'Live'
    if (dayEnded.value) return 'Final'
    return frame.value?.time ? 'Paused' : 'Ready'
  })
  let writer, ticket = 0, cache = new Map(), track, epoch = 0, finishConnection
  let runRequest = 0, request = 0, batchViewRequest = 0
  let playThroughRequest = null
  let requestedDawn = false, autoPrepare = false, restorePlay = false, adjustmentTimer
  let cursor = 0, previous = 0, remainder = 0, renderAt = 0
  let raf, initialised = false, waiting = null
  let persistQueue = Promise.resolve()
  const unsavedRuns = new Map()
  const deletingRuns = new Set()
  let libraryChanges = new Set()

  const savedRun = id => library.value.find(value => value.id === id)
  function updateLibrary(id, entry) {
    libraryChanges?.add(id)
    const entries = library.value.filter(value => value.id !== id)
    if (entry) entries.push(entry)
    library.value = entries
  }

  function mergeLibrary(entries) {
    const merged = new Map(library.value.map(entry => [entry.id, entry]))
    for (const entry of entries) {
      if (!libraryChanges.has(entry.id)) merged.set(entry.id, entry)
    }
    library.value = [...merged.values()]
  }

  async function loadLibrary(restoring) {
    try {
      const { summaries, missing } = await readLibrary()
      mergeLibrary(summaries)
      if (missing.length) {
        await restoring
        mergeLibrary(await indexLegacyRuns(missing))
      }
    } catch (error) {
      libraryError.value = error?.message || 'Could not open the saved run library.'
    } finally {
      libraryChanges = null
      libraryLoading.value = false
    }
  }

  function runAvailable(id, listed) {
    return !deletingRuns.has(id) && (!listed || !!savedRun(id))
  }

  async function loadRun(id) {
    if (deletingRuns.has(id)) return
    const inMemory = () => run.value?.id === id ? run.value : unsavedRuns.get(id)
    const existing = inMemory()
    if (existing) return existing
    const listed = savedRun(id)
    const archived = await readRun(id)
    if (runAvailable(id, listed)) return inMemory() ?? archived
  }

  function persist(value = run.value) {
    if (!value) return
    unsavedRuns.set(value.id, value)
    persistQueue = persistQueue.then(() => saveRun(value)).then(entry => {
      updateLibrary(entry.id, entry)
      if (run.value?.id === value.id) saved.value = entry.savedThrough
      if (unsavedRuns.get(value.id) === value) unsavedRuns.delete(value.id)
    }).catch(() => { error.value = 'Local saving is unavailable. You can still export this run.' })
    return persistQueue
  }

  function disconnect() {
    ++epoch
    writer?.terminate()
    writer = undefined
    finishConnection?.(false)
    workerReady.value = false
    if (adjustingTraits.value) {
      clearTimeout(adjustmentTimer)
      adjustingTraits.value = false
      traitAdjustmentError.value = 'The live worker stopped before the adjustment was confirmed.'
    }
  }

  function reportFailure(message) {
    const unfinished = batch.value || (liveFrame.value?.day > completed.value && liveFrame.value?.time > 0)
    const recovery = !unfinished ? '' : run.value.partial
      ? ' Retry to resume the unfinished day from its last checkpoint.'
      : ' The unfinished day will restart when you retry.'
    workerError.value = message + recovery
    disconnect()
    pending.value = false
    requestedDawn = false
    autoPrepare = false
    waiting = null
    batch.value = null
    playing.value = false
    if (modal.value === 'quick-progress') modal.value = null
  }

  function connect(value) {
    disconnect()
    const token = epoch
    connecting.value = true
    return new Promise(resolve => {
      const timeout = setTimeout(() => fail('The simulation took too long to start.'), WORKER_STARTUP_TIMEOUT)
      finishConnection = success => {
        clearTimeout(timeout)
        finishConnection = null
        connecting.value = false
        resolve(success)
      }
      function fail(message) {
        if (token === epoch) reportFailure(message)
      }
      function workerFailed() {
        fail(workerReady.value ? 'The simulation stopped unexpectedly.' : 'The simulation could not start.')
      }
      try {
        writer = createWorker()
        writer.onerror = writer.onmessageerror = workerFailed
        writer.onmessage = ({ data }) => {
          if (token !== epoch) return
          if (data.type === 'error') return workerFailed()
          if (data.type === 'ready') {
            workerReady.value = true
            workerError.value = ''
            finishConnection?.(true)
          } else {
            receive(data)
          }
        }
        writer.postMessage({ type: 'init', config: value.setup, checkpoint: value.latest,
          committed: last(value), partial: value.partial, records: value.revisions,
          traitAdjustments: value.traitAdjustments, speciesActions: value.speciesActions })
      } catch {
        fail('The simulation could not start.')
      }
    })
  }

  function showLiveFrame(nextFrame) {
    if (!replay.value && !batch.value && !loading.value) {
      frame.value = nextFrame
      viewing.value = nextFrame.day
    }
  }

  function receive(data) {
    if (data.type === 'advanced') pending.value = false
    if (data.type === 'trait-adjustment' || data.type === 'species-action') {
      clearTimeout(adjustmentTimer)
      if (data.error) {
        adjustingTraits.value = false
        traitAdjustmentError.value = data.error
      } else {
        const token = epoch
        const key = data.action ? 'speciesActions' : 'traitAdjustments'
        run.value = { ...run.value, partial: data.partial,
          [key]: [...(run.value[key] ?? []), data.action ?? data.adjustment] }
        liveFrame.value = data.frame
        void persist().then(() => {
          if (token !== epoch) return
          showLiveFrame(data.frame)
          adjustingTraits.value = false
          if (data.action) speciesResult.value = data.action
          if (modal.value === 'traits') modal.value = null
        })
      }
    }
    if (data.type === 'frame') {
      liveFrame.value = data.frame
      if (data.partial) {
        const token = epoch
        run.value = { ...run.value, partial: data.partial }
        void persist().then(() => {
          if (token === epoch && liveFrame.value === data.frame) showLiveFrame(data.frame)
        })
      } else showLiveFrame(data.frame)
    }
    if (data.type === 'partial') {
      run.value = { ...run.value, partial: data.partial }
      persist()
    }
    if (data.type === 'commit') {
      const { day, final } = data
      run.value = recordDay(run.value, data)
      persist()
      if (final) {
        liveFrame.value = final
        if (!replay.value && !loading.value) {
          frame.value = final
          if (playing.value && through.value && !extinctDay.value && day < run.value.setup.days) {
            requestedDawn = true
            writer.postMessage({ type: 'dawn' })
          } else playing.value = false
        }
      }
      if (waiting?.day === day) {
        const { resume } = waiting
        waiting = null
        void openDay(day, 0, resume)
      }
    }
    if (data.type === 'done') {
      const finished = batch.value
      const stopped = data.stopped && data.day < finished?.target
      const prepare = autoPrepare && data.day === 1 && !extinctDay.value && !data.stopped && !finished?.stopping
      const mayShowReplay = batchViewRequest === request && !loading.value && !replay.value
      batch.value = null
      autoPrepare = false
      if (prepare) {
        if (mayShowReplay) void openDay(1)
        if (run.value.setup.days > 1) simulate(run.value.setup.days, 'Preparing')
      } else if (!replay.value && !loading.value) {
        if (mayShowReplay && (extinctDay.value || finished?.label === 'Finish Day' || data.day >= run.value.setup.days)) {
          void openDay(data.day, Infinity)
        } else if (liveFrame.value && !extinctDay.value) {
          frame.value = liveFrame.value
          viewing.value = liveFrame.value.day
        }
      }
      if (modal.value === 'quick-progress' && finished) {
        modal.value = stopped && !extinctDay.value ? 'quick-stopped' : 'quick-done'
      }
    }
  }

  async function useRun(value, { newRun = false, restoreDay = null, isCurrent = () => true, onActivate, remember = true } = {}) {
    const switchId = ++runRequest
    cancelReplay()
    const viewRequest = request
    stopPlayback()
    if (batch.value) {
      await new Promise(resolve => {
        const unwatch = watch(batch, active => {
          if (active) return
          unwatch()
          resolve()
        }, { flush: 'sync' })
        stopBatch()
      })
    } else if (run.value && writer) {
      const oldWriter = writer
      if (adjustingTraits.value || !replay.value && liveFrame.value?.time > 0 && !hasEnded(liveFrame.value)) {
        await new Promise(resolve => {
          const timeout = setTimeout(finish, 150)
          function finish() { clearTimeout(timeout); oldWriter.removeEventListener('message', onPartial); resolve() }
          function onPartial(event) { if (event.data.type === 'partial') finish() }
          oldWriter.addEventListener('message', onPartial)
          oldWriter.postMessage({ type: 'checkpoint' })
        })
      }
    }
    const canSwitch = () => switchId === runRequest && viewRequest === request && isCurrent()
    if (!canSwitch()) return false
    const sameRun = run.value?.id === value.id
    if (sameRun) value = run.value
    else if (!newRun) value = unsavedRuns.get(value.id) ?? value
    let restoredTrack
    if (run.value && !sameRun && restoreDay >= 1 && restoreDay <= last(value)) {
      replayDay.value = restoreDay
      try {
        restoredTrack = await getTrack(value, restoreDay)
      } catch {
        if (canSwitch()) replayFailure.value = { day: restoreDay, time: 0, resume: false }
        return false
      } finally {
        if (canSwitch()) replayDay.value = null
      }
      if (!canSwitch()) return false
    }
    cache = new Map()
    track = null
    replay.value = false
    pending.value = false
    requestedDawn = false
    waiting = null
    batch.value = null
    autoPrepare = false
    if (!sameRun) saved.value = savedRun(value.id)?.savedThrough ?? (newRun || unsavedRuns.has(value.id) ? 0 : last(value))
    selected.value = null
    following.value = false
    scope.value = 'all'
    through.value = value.setup.mode === 'live'
    if (modal.value === 'traits') modal.value = null
    run.value = value
    error.value = ''
    workerError.value = ''
    if (remember) {
      try { localStorage.setItem('evolution.active', value.id) } catch {}
    }
    const day = extinctDay.value ? last(value) : Math.min(last(value) + 1, value.setup.days)
    viewing.value = day
    frame.value = null
    if (day > last(value)) {
      frame.value = snapshot(value.partial ?? dawnForRun(value.setup, value.revisions, day, value.latest, value.traitAdjustments, value.speciesActions))
    }
    liveFrame.value = frame.value
    if (restoredTrack) {
      cache.set(value.id + ':' + restoreDay, restoredTrack)
      showReplay(restoredTrack, restoreDay === extinctDay.value ? Infinity : 0, false)
    }
    if (newRun) persist()
    onActivate?.()
    const connected = await connect(value)
    if (switchId !== runRequest || !isCurrent()) return false
    if (connected && value.setup.mode === 'prepare' && !last(value)) {
      autoPrepare = true
      simulate(1, 'Preparing')
    } else if (viewRequest === request && !restoredTrack) {
      if (restoreDay >= 1 && restoreDay <= last(value)) await openDay(restoreDay, restoreDay === extinctDay.value ? Infinity : 0)
      else if (restoreDay == null && (extinctDay.value || value.setup.mode === 'prepare' || last(value) >= value.setup.days)) {
        await openDay(last(value), extinctDay.value ? Infinity : 0)
      }
    }
    return switchId === runRequest && isCurrent()
  }

  async function retrySimulation() {
    if (!run.value || !workerError.value || connecting.value) return
    const value = run.value
    const viewRequest = request
    if (!await connect(value) || run.value?.id !== value.id) return
    if (value.setup.mode === 'prepare' && !last(value)) {
      autoPrepare = true
      simulate(1, 'Preparing')
    } else if (viewRequest === request && !frame.value && completed.value) {
      await openDay(replayFailure.value?.day ?? completed.value)
    }
  }

  async function restoreActiveRun() {
    const address = location.hash.match(/^#\/r\/([^/]+)\/s\/(\d+)\//)
    let activeId
    try { activeId = localStorage.getItem('evolution.active') } catch {}
    const addressedId = address?.[1]
    let found, remember = true
    try {
      if (addressedId) found = await readRun(addressedId)
      if (!found && activeId && activeId !== addressedId) found = await readRun(activeId)
    } catch { remember = false }
    if (found && libraryLoading.value && !savedRun(found.id)) mergeLibrary([summarizeRun(found)])
    const restoreDay = found && found.id === addressedId ? +address[2] : null
    await useRun(found ?? makeRun(starter()), { newRun: !found, restoreDay, remember })
  }

  async function init() {
    if (initialised) return
    initialised = true
    const restoring = restoreActiveRun()
    void loadLibrary(restoring)
    await restoring
    raf = requestAnimationFrame(animate)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopPlayback()
    })
    setInterval(() => {
      if (playing.value && !replay.value && !batch.value) writer?.postMessage({ type: 'checkpoint' })
    }, 5000)
  }

  async function preparePair(setups, signal, progress, onSaving) {
    for (const setup of setups) {
      const issue = Object.values(validate(setup))[0]
      if (issue) throw new Error(issue)
    }
    const left = await prepareExperiment(setups[0], signal, day => progress(0, day))
    const right = await prepareExperiment(setups[1], signal, day => progress(1, day))
    signal.throwIfAborted()
    onSaving()
    try {
      for (const entry of await saveRunPair(left, right)) updateLibrary(entry.id, entry)
    }
    catch { throw new Error('Could not save the experiment pair in this browser. Try again when local storage is available.') }
    return { left:left.id, right:right.id, day:Math.min(last(left), last(right)) }
  }

  function getTrack(value, day) {
    const key = value.id + ':' + day
    if (cache.has(key)) {
      const result = cache.get(key)
      cache.delete(key)
      cache.set(key, result)
      return Promise.resolve(result)
    }
    const runCache = cache
    return new Promise((resolve, reject) => {
      const start = [...value.checkpoints].reverse().find(c => c.day < day)
      if (!start) throw new Error('This day has no opening checkpoint.')
      const job = createWorker()
      const id = ++ticket
      let timeout
      function watchForProgress() {
        clearTimeout(timeout)
        timeout = setTimeout(() => fail('Replay reconstruction timed out.'), 30_000)
      }
      function cleanup() {
        clearTimeout(timeout)
        job.onmessage = job.onerror = job.onmessageerror = null
        job.terminate()
      }
      function fail(message) {
        cleanup()
        reject(new Error(message))
      }
      const stopped = () => fail('Replay reconstruction stopped.')
      job.onerror = job.onmessageerror = stopped
      job.onmessage = ({ data }) => {
        if (data.id !== id) return
        if (data.type === 'replay-progress') { watchForProgress(); return }
        if (data.type === 'error') { fail(data.message); return }
        cleanup()
        try {
          const result = prepareTrack(data.track)
          runCache.set(key, result)
          while (runCache.size > 3) runCache.delete(runCache.keys().next().value)
          resolve(result)
        } catch (error) { reject(error) }
      }
      watchForProgress()
      try {
        job.postMessage({ type: 'replay', id, setup: value.setup, records: value.revisions, traitAdjustments: value.traitAdjustments,
          speciesActions: value.speciesActions, start: start.day + 1, checkpoint: start, day })
      } catch { stopped() }
    })
  }

  async function checkpointAt(value, day) {
    if (day === last(value)) return value.latest
    return value.checkpoints.find(point => point.day === day) ?? (await getTrack(value, day)).checkpoint
  }

  function cancelReplay() {
    ++request
    waiting = null
    playThroughRequest = null
    replayDay.value = null
    replayFailure.value = null
  }

  function showReplay(result, time, resume) {
    const nextCursor = clamp(time, 0, result.duration)
    const nextFrame = trackFrame(result, nextCursor)
    if (!replay.value) through.value = false
    track = result
    cursor = nextCursor
    replay.value = true
    viewing.value = result.day
    frame.value = nextFrame
    if (following.value && !nextFrame.blobs.some(b => b.alive && b.id === selected.value)) following.value = false
    playing.value = resume
  }

  async function openDay(day, time = 0, resume = false) {
    if (!run.value || !Number.isInteger(day) || day < 1 || day > completed.value) return false
    const value = run.value
    const token = ++request
    playThroughRequest = resume && replay.value ? token : null
    stopPlayback()
    replayFailure.value = null
    replayDay.value = day
    try {
      const result = await getTrack(value, day)
      if (run.value?.id !== value.id || token !== request) return false
      showReplay(result, time, resume)
      return true
    } catch {
      if (token === request) replayFailure.value = { day, time, resume }
      return false
    } finally {
      if (token === request) {
        replayDay.value = null
        playThroughRequest = null
      }
    }
  }

  function retryReplay() {
    const failure = replayFailure.value
    if (failure) return openDay(failure.day, failure.time, failure.resume)
  }

  function stopPlayback() {
    waiting = null
    if (playing.value && !replay.value && writer && !batch.value) writer.postMessage({ type: 'checkpoint' })
    playing.value = false
    remainder = 0
  }

  function toggleThrough() {
    through.value = !through.value
    if (through.value) return
    waiting = null
    if (playThroughRequest === request) cancelReplay()
  }

  function goLive(restart = false) {
    if (!canEnterLive.value) return
    cancelReplay()
    stopPlayback()
    replay.value = false
    through.value = true
    if ([run.value.traitAdjustments, run.value.speciesActions].some(edits => edits?.some(edit => edit.day === completed.value + 1))) restart = false
    if (restart && liveFrame.value?.day > completed.value && liveFrame.value.time > 0) {
      const day = completed.value + 1
      const { setup, revisions, latest } = run.value
      liveFrame.value = snapshot(dawnForRun(setup, revisions, day, latest))
    }
    if (liveFrame.value?.day > completed.value) {
      frame.value = liveFrame.value
      viewing.value = liveFrame.value.day
    }
    writer.postMessage({ type: 'dawn', restart })
  }

  function prepareOrLive() {
    if (batch.value?.label === 'Preparing') {
      const activeWriter = writer
      const viewRequest = request
      const stopThenGo = ({data}) => {
        if (data.type !== 'done') return
        activeWriter.removeEventListener('message', stopThenGo)
        if (writer === activeWriter && viewRequest === request) goLive()
      }
      writer.addEventListener('message', stopThenGo)
      stopBatch()
    } else goLive()
  }

  function seek(time) {
    if (!replay.value || loading.value || !track) return
    cursor = clamp(time, 0, track.duration)
    frame.value = trackFrame(track, cursor)
  }

  function stepReplayFrame(direction) {
    if (!replay.value || loading.value || playing.value || !track) return
    stopPlayback()
    seek(adjacentFrameTime(track, frame.value.time, direction))
  }

  function play() {
    if (playing.value || waiting) { stopPlayback(); return }
    if (loading.value || !frame.value || (!replay.value && (!workerReady.value || batch.value || adjustingTraits.value))) return
    if (replay.value && cursor >= displayDuration.value) seek(0)
    else if (!replay.value && dayEnded.value) {
      if (extinctDay.value || completed.value >= run.value.setup.days) { void openDay(completed.value, 0, true); return }
      requestedDawn = true
      writer.postMessage({ type: 'dawn' })
    }
    playing.value = true
  }

  function stepOnce() {
    stopPlayback()
    if (replay.value) seek(cursor + (track?.stepSeconds ?? DT))
    else if (canEnterLive.value && !loading.value && !pending.value && !adjustingTraits.value && frame.value && !dayEnded.value) {
      pending.value = true
      writer.postMessage({ type: 'advance', ticks: 1, savePartial: true })
    }
  }

  function openTraitAdjustment() {
    if (!canOpenTraitAdjustment.value) return
    stopPlayback()
    traitAdjustmentError.value = ''
    modal.value = 'traits'
  }

  function adjustTraits(changes, group) {
    if (!canAdjustTraits.value || !validTraitAdjustment(changes)) return
    const { day, time, stepSeconds } = frame.value
    adjustingTraits.value = true
    traitAdjustmentError.value = ''
    adjustmentTimer = setTimeout(() => reportFailure('The trait adjustment timed out.'), WORKER_STARTUP_TIMEOUT)
    try { writer.postMessage({ type: 'adjust-traits', day, tick: Math.round(time / stepSeconds), changes, group }) }
    catch { reportFailure('The trait adjustment could not reach the simulation.') }
  }

  function openSpecies() {
    if (!canChangeSpecies.value && !replay.value) return
    stopPlayback()
    traitAdjustmentError.value = ''
    speciesResult.value = null
    modal.value = 'species'
  }

  function changeSpecies(action) {
    if (!canAdjustSpecies.value) return
    const { day, time, stepSeconds } = frame.value
    adjustingTraits.value = true
    traitAdjustmentError.value = ''
    adjustmentTimer = setTimeout(() => reportFailure('The species change timed out.'), WORKER_STARTUP_TIMEOUT)
    try { writer.postMessage({ type: 'species-action', day, tick: Math.round(time / stepSeconds), action: copy(action) }) }
    catch { reportFailure('The species change could not reach the simulation.') }
  }

  function moveDay(delta) {
    const day = viewing.value + delta
    if (day >= 1 && day <= completed.value) void openDay(day)
    else if (delta === 1 && viewing.value === completed.value) goLive(true)
  }

  function animate(now) {
    const elapsed = Math.min((now - previous) / 1000, 0.12)
    previous = now
    if (requestedDawn && liveFrame.value?.time === 0) requestedDawn = false
    if (playing.value && !loading.value && !requestedDawn) {
      const delta = elapsed * 2 ** ((rate.value - 6) / 2)
      if (replay.value && track) {
        cursor = Math.min(track.duration, cursor + delta)
        if (now - renderAt >= 16 || cursor === track.duration) {
          frame.value = trackFrame(track, cursor)
          renderAt = now
        }
        if (cursor >= track.duration) {
          playing.value = false
          if (through.value && track.day < completed.value) void openDay(track.day + 1, 0, true)
          else if (through.value && batch.value && !extinctDay.value && track.day < run.value.setup.days) waiting = { day: track.day + 1, resume: true }
        }
      } else if (!batch.value) {
        remainder = Math.min(0.4, remainder + delta)
        const seconds = liveFrame.value?.stepSeconds ?? DT
        if (remainder >= seconds && !pending.value) {
          const ticks = Math.floor(remainder / seconds)
          remainder -= ticks * seconds
          pending.value = true
          writer.postMessage({ type: 'advance', ticks })
        }
      }
    }
    raf = requestAnimationFrame(animate)
  }

  function simulate(target, label = 'Quick Sim') {
    if (!canEnterLive.value || adjustingTraits.value || !Number.isInteger(target) || target <= completed.value || target > run.value.setup.days) return false
    if (!replay.value) stopPlayback()
    batchViewRequest = request
    batch.value = { target, start: completed.value, label, stopping: false }
    writer.postMessage({ type: 'batch', target })
    return true
  }

  function stopBatch() {
    if (!batch.value || batch.value.stopping) return
    batch.value = { ...batch.value, stopping: true }
    writer.postMessage({ type: 'stop' })
  }

  function quickForDay(day) {
    targetDay.value = batch.value ? null : day
    modal.value = batch.value ? 'quick-progress' : 'quick'
  }

  function openDownload(range = null) {
    downloadRange.value = range
    modal.value = 'download'
  }

  function extend(days) {
    if (!workerReady.value || batch.value || extinctDay.value || days <= run.value.setup.days || days > 1000) return
    run.value = { ...run.value, setup: { ...run.value.setup, days } }
    writer.postMessage({ type: 'extend', days })
    persist()
    modal.value = null
    if (run.value.setup.mode === 'prepare') simulate(days, 'Preparing')
  }

  function openSettings(setup, from = null) {
    cancelBranch()
    if (!settings.value) restorePlay = playing.value
    stopPlayback()
    if (setup || !draft.value || branchFrom.value != null) {
      // Guided and imported legacy setups keep their original rules.
      const initial = setup?.version >= STEERING_RULE_VERSION
        ? setupForNewRun(setup)
        : setup ?? setupForNewRun(run.value?.setup ?? starter())
      openingDraft = JSON.stringify(initial)
      draft.value = JSON.parse(openingDraft)
    }
    branchFrom.value = from
    settings.value = true
    modal.value = null
  }

  function resetDraft() {
    if (!draft.value) return
    const original = JSON.parse(openingDraft)
    for (const key of Object.keys(draft.value)) {
      if (!Object.hasOwn(original, key)) delete draft.value[key]
    }
    Object.assign(draft.value, original)
  }

  function closeSettings(resume = true) {
    cancelBranch()
    settings.value = false
    if (resume && restorePlay && !playing.value) play()
    restorePlay = false
  }

  function clearSettings() {
    settings.value = false
    draft.value = null
    branchFrom.value = null
    restorePlay = false
  }

  async function evolve(setup) {
    const issues = validate(setup)
    const fork = branchFrom.value
    if (fork != null && setup.days <= fork) issues.days = 'The run must continue beyond Day '+fork+'.'
    if (Object.keys(issues).length) return issues
    if (fork != null) {
      try { await branch(fork, copy(setup)) }
      catch (e) { return { branch:e.message } }
      return {}
    }
    clearSettings()
    await useRun(makeRun(setup), { newRun: true })
    return {}
  }

  async function switchRun(id, isCurrent, restoreDay) {
    const listed = savedRun(id)
    let value
    try { value = await loadRun(id) }
    catch {
      if (isCurrent()) error.value = 'Could not open the saved run.'
      return false
    }
    if (!isCurrent()) return false
    if (!value || !runAvailable(id, listed)) return null
    cancelBranch()
    modal.value = null
    draft.value = null
    return useRun(value, { restoreDay, isCurrent: () => isCurrent() && runAvailable(id, listed) })
  }

  async function importBranch(setup, revisions = [], speciesActions = [], traitAdjustments = []) {
    if (Object.keys(validate(setup)).length || !validateRevisions(setup, revisions) ||
        !validSpeciesHistory(setup, revisions, speciesActions) || !Array.isArray(traitAdjustments) ||
        !traitAdjustments.every(edit => edit && Number.isInteger(edit.day) && edit.day >= 1 && edit.day <= setup.days &&
          Number.isInteger(edit.tick) && edit.tick >= 0 && validTraitAdjustment(edit.changes) &&
          (edit.order == null || Number.isSafeInteger(edit.order) && edit.order > 0) &&
          (edit.creatureIds == null || Array.isArray(edit.creatureIds) && edit.creatureIds.every(Number.isSafeInteger)))) return false
    const value=makeRun(setup)
    value.revisions=copy(revisions)
    if (revisions.length) value.forkDay = revisions.at(-1).day - 1
    value.speciesActions = copy(speciesActions)
    value.traitAdjustments = copy(traitAdjustments)
    if (speciesActions[0]?.day === 1 && speciesActions[0].tick === 0) {
      try { dawnForRun(value.setup, value.revisions, 1, value.latest, value.traitAdjustments, value.speciesActions) }
      catch { return false }
    }
    cancelBranch()
    modal.value=null
    draft.value=null
    await useRun(value, { newRun: true })
    return true
  }

  async function rename(id, name) {
    try {
      const value = run.value?.id === id ? run.value : await loadRun(id)
      if (!value) throw new Error('The saved run is unavailable.')
      const active = run.value?.id === id
      const source = active ? run.value : unsavedRuns.get(id) ?? value
      const updated = { ...source, setup: { ...source.setup, name } }
      if (active) run.value = updated
      persist(updated)
    } catch { error.value = 'Could not rename that saved run.' }
  }

  function toggleBookmark(day) {
    if (!Number.isInteger(day) || day < 1 || day > completed.value) return
    const days = run.value.bookmarks ?? []
    const bookmarks = days.includes(day) ? days.filter(value => value !== day) : [...days, day].sort((a, b) => a - b)
    run.value = { ...run.value, bookmarks }
    persist()
  }

  async function remove(id) {
    if (run.value?.id === id || deletingRuns.has(id)) return
    deletingRuns.add(id)
    try {
      await persistQueue
      if (run.value?.id === id) return
      await deleteRun(id)
      updateLibrary(id)
      unsavedRuns.delete(id)
    } catch { error.value = 'Could not remove that saved run.' }
    finally { deletingRuns.delete(id) }
  }

  function cancelBranch() {
    branchRequest.value = null
  }

  async function branch(day, setup) {
    if (branchRequest.value || !run.value || day < 1 || day > latestBranchDay.value || Object.keys(validate(setup)).length) return
    const base = run.value
    const fromSettings = settings.value
    const operation = { day }
    branchRequest.value = operation
    let activated = false
    const current = () => branchRequest.value === operation && (fromSettings ? settings.value : modal.value === 'branch')
    try {
      const after = await checkpointAt(base, day)
      if (!current() || run.value?.id !== base.id) return
      const value = { ...makeRun(setup), source: base.id, forkDay: day, latest: after,
        speciesActions: base.speciesActions?.filter(edit => edit.day <= day) ?? [],
        traitAdjustments: base.traitAdjustments?.filter(edit => edit.day <= day) ?? [],
        summaries: base.summaries.filter(r => r.day <= day),
        checkpoints: [...base.checkpoints.filter(c => c.day < day), { day, ...after }],
        revisions: [...(base.revisions.length ? base.revisions.filter(r => r.day <= day) : [{ day: 1, setup: base.setup }]),
          { day: day + 1, setup }],
      }
      const switched = await useRun(value, {
        newRun: true,
        isCurrent: () => activated || current(),
        onActivate: () => {
          activated = true
          cancelBranch()
          modal.value = null
          if (fromSettings) clearSettings()
        },
      })
      if (switched && setup.mode === 'prepare' && day < setup.days) simulate(setup.days, 'Preparing')
    } catch (error) {
      if (current()) throw error
    } finally {
      if (branchRequest.value === operation) cancelBranch()
    }
  }

  return { run, library, libraryLoading, libraryError, loadRun, frame, viewing, liveFrame, liveDay, replay, playing, rate, through, scope, loading, batch, saved,
    canChangeSpecies, canAdjustSpecies, recordedChangesAhead, openSpecies, changeSpecies, speciesResult,
    canOpenTraitAdjustment, canAdjustTraits, openTraitAdjustment, adjustTraits, adjustingTraits, traitAdjustmentError,
    error, workerReady, connecting, workerError, retrySimulation, replayDay, replayFailure, cancelReplay, retryReplay,
    canEnterLive, canMoveNext, selected, following, settings, draft, modal, completed, extinctDay, latestBranchDay, dayEnded, displayDuration, status, init, openDay, goLive, seek, play,
    stopPlayback, toggleThrough, stepOnce, stepReplayFrame, moveDay, simulate, stopBatch, extend, openSettings, closeSettings, draftChanged, resetDraft, evolve, switchRun, rename,
    remove, toggleBookmark, getTrack, checkpointAt, branch, cancelBranch, branchPreparing, prepareOrLive, targetDay, quickForDay, branchFrom, importBranch, preparePair, openDownload, downloadRange }
})
