import { applySpeciesAction, applyTraitAdjustment, dawnForRun, founders, step, snapshot } from './simulation.js'
import { speciesActionIssue, speciesWithEdits } from './species-actions.js'
import { rulesFor } from './config.js'
import { traitAdjustmentGroup, validTraitAdjustment } from './trait-adjustments.js'
import { simulateForecast } from '../forecast.js'
import { tracksForagingDecisions } from './foraging-decisions.js'
import { TRACK_FIELDS } from '../track.js'

const pause = () => new Promise(resolve => setTimeout(resolve, 0))
let config, checkpoint, partial, records, traitAdjustments, speciesActions, order = 0, committed = 0, stopped = false, busy = false
const emit = (type, data = {}) => postMessage({ type, ...data })

function current() {
  partial ??= dawnForRun(config, records, committed + 1, checkpoint, traitAdjustments, speciesActions)
  return partial
}

function settle(result) {
  const day = current().day
  checkpoint = result.checkpoint
  committed = day
  const final = snapshot(partial)
  partial = null
  emit('commit', { day, ...result, final: busy ? null : final })
}

function show() {
  if (canAdvance()) emit('frame', { frame: snapshot(current()) })
}

const canAdvance = () => committed < config.days && checkpoint.roster.length > 0

async function batch(target) {
  busy = true
  stopped = false
  while (committed < target && canAdvance()) {
    const state = current()
    const rules = rulesFor(config, records, state.day)
    let result
    do {
      const started = performance.now()
      do {
        result = step(state, rules, 1, true)
        if (!result && state.limit != null && !state.blobs.some(b => b.alive && !b.home)) {
          result = step(state, rules, state.limit, true)
        }
      } while (!result && performance.now() - started < 12)
      if (!result) await pause()
    } while (!result)
    settle(result)
    await pause()
    if (stopped) break
  }
  busy = false
  show()
  emit('done', { day: committed, stopped })
}

async function replay(message) {
  const { setup, start, day, records, id, traitAdjustments, speciesActions } = message
  let lastProgress = performance.now()
  function advanceReplay(state, rules, end) {
    while (!state.settled && state.tick < end) {
      step(state, rules, Math.min(20, end - state.tick), true)
      const now = performance.now()
      if (now - lastProgress >= 1000) {
        emit('replay-progress', { id })
        lastProgress = now
      }
    }
  }
  let at = message.checkpoint
  for (let i = start; i < day; i++) {
    const rules = rulesFor(setup, records, i)
    const ctx = dawnForRun(setup, records, i, at, traitAdjustments, speciesActions)
    advanceReplay(ctx, rules, Infinity)
    at = ctx.settled.checkpoint
    await pause()
  }
  const rules = rulesFor(setup, records, day), state = dawnForRun(setup, records, day, at, traitAdjustments, speciesActions)
  const startFrame = snapshot(state)
  const opening = structuredClone(startFrame.blobs)
  const plants = state.plants.map(p => ({ id: p.id, x: p.x, y: p.y }))
  const trackDecisions = tracksForagingDecisions(rules)
  const fields = TRACK_FIELDS + (trackDecisions ? 2 : 0)
  const arrivals = (speciesActions ?? []).filter(action => action.kind === 'introduce' && action.day === day && action.tick > 0)
  const width = (opening.length + arrivals.reduce((total, action) => total + action.count, 0)) * fields
  const maxSamples = Math.max(3, Math.floor(16 * 1024 * 1024 / (Math.max(1, width) * 4)))
  let stride = state.limit == null ? 1 : Math.max(1, Math.ceil(state.limit / (maxSamples - 1)))
  let capacity = Math.min(16, maxSamples)
  let frames = new Float32Array(capacity * width)
  let index = 0
  let samples = 0
  function sample() {
    for (let i = opening.length; i < state.blobs.length; i++) opening.push({ ...state.blobs[i] })
    for (const b of state.blobs) {
      frames[index++] = b.x
      frames[index++] = b.y
      frames[index++] = b.angle
      frames[index++] = b.energy
      frames[index++] = b.credits
      frames[index++] = b.state
      frames[index++] = b.preyCredits
      if (trackDecisions) {
        frames[index++] = b.foragingDecision
        frames[index++] = b.foragingSavings
      }
    }
    const end = (samples + 1) * width
    frames.fill(NaN, index, end)
    index = end
    samples++
  }
  sample()
  while (!state.settled) {
    if (samples === capacity) {
      if (capacity < maxSamples) {
        capacity = Math.min(capacity * 2, maxSamples)
        const expanded = new Float32Array(capacity * width)
        expanded.set(frames)
        frames = expanded
      } else {
        // Keep the replay evenly spaced when a generation outgrows the buffer.
        for (let i = 2; i < samples; i += 2) frames.copyWithin(i / 2 * width, i * width, (i + 1) * width)
        stride *= 2
        samples = Math.ceil(samples / 2)
        index = samples * width
      }
    }
    advanceReplay(state, rules, (Math.floor(state.tick / stride) + 1) * stride)
    sample()
  }
  const final = snapshot(state)
  const used = frames.slice(0, index)
  postMessage({ type: 'track', id, track: { day, duration: final.duration,
    stepSeconds: state.stepSeconds, ticks: state.tick, stride, fields,
    opening, plants, width, speciesEdits: startFrame.speciesEdits, frames: used, events: state.events, checkpoint: state.settled.checkpoint, final } }, [used.buffer])
}

function adjustTraits({ day, tick, changes, group = {} }) {
  if (busy || !canAdvance() || day !== committed + 1 || tick !== current().tick) {
    emit('trait-adjustment', { error: 'The live day has moved on. Check the preview and try again.' })
    return
  }
  const state = current()
  const adjustment = { day, tick, changes, order: ++order }
  if (group.speciesIds !== null || group.creatureIds !== null || group.activity !== 'any') {
    adjustment.creatureIds = traitAdjustmentGroup(state.blobs, group).map(blob => blob.id)
    if (adjustment.creatureIds.length === 0) {
      emit('trait-adjustment', { error: 'No living blobs match this group.' })
      return
    }
  }
  if (!validTraitAdjustment(changes) ||
      !applyTraitAdjustment(state, rulesFor(config, records, day), changes, adjustment.creatureIds)) {
    emit('trait-adjustment', { error: 'Enter an adjustment that changes at least one living blob.' })
    return
  }
  traitAdjustments.push(adjustment)
  emit('trait-adjustment', { adjustment, partial: state, frame: snapshot(state) })
}

function changeSpecies({ day, tick, action }) {
  if (busy || !canAdvance() || day !== committed + 1 || tick !== current().tick) {
    emit('species-action', { error: 'The live day has moved on. Check the preview and try again.' })
    return
  }
  const state = current()
  const base = rulesFor(config, records, day)
  const rules = { ...base, species: speciesWithEdits(base.species, state.speciesEdits) }
  const validation = speciesActionIssue(action, rules, state.blobs)
  if (validation) { emit('species-action', { error: validation }); return }
  const edit = { ...action, day, tick, order: ++order }
  if (edit.kind === 'introduce') edit.creatureIds = Array.from({ length: edit.count }, (_, i) => state.nextId + i)
  const error = applySpeciesAction(state, base, edit)
  if (error) { emit('species-action', { error }); return }
  speciesActions.push(edit)
  emit('species-action', { action: edit, partial: state, frame: snapshot(state) })
}

self.onmessage = async ({ data }) => {
  try {
    switch (data.type) {
      case 'forecast': {
        const result = simulateForecast(data, () => emit('forecast-progress'))
        emit('forecast-result', result)
        break
      }
      case 'replay': await replay(data); break
      case 'init':
        config = data.config
        records = data.records ?? []
        traitAdjustments = data.traitAdjustments ?? []
        speciesActions = data.speciesActions ?? []
        order = Math.max(traitAdjustments.at(-1)?.order ?? 0, speciesActions.at(-1)?.order ?? 0)
        checkpoint = data.checkpoint ?? founders(config)
        partial = data.partial ?? null
        committed = data.committed ?? 0
        show()
        emit('ready')
        break
      case 'advance': {
        if (busy || !canAdvance()) return
        const state = current()
        const result = step(state, rulesFor(config, records, state.day), data.ticks)
        if (result) settle(result)
        else {
          const frame = snapshot(state)
          emit('frame', data.savePartial ? { frame, partial: state } : { frame })
        }
        emit('advanced')
        break
      }
      case 'dawn':
        if (!busy) {
          if (data.restart && partial?.tick > 0) {
            partial = null
            emit('partial', { partial })
          }
          show()
        }
        break
      case 'species-action': changeSpecies(data); break
      case 'adjust-traits': adjustTraits(data); break
      case 'batch': if (!busy) await batch(data.target); break
      case 'stop': stopped = true; break
      case 'extend': config.days = data.days; break
      case 'checkpoint': if (!busy) emit('partial', { partial }); break
    }
  } catch (error) {
    busy = false
    emit('error', { id: data.id, message: error.message })
  }
}
