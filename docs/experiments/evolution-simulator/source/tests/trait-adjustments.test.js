import assert from 'node:assert/strict'
import test from 'node:test'
import { starter } from '../src/engine/config.js'
import { radius, travel, walkthroughStepCost } from '../src/engine/geometry.js'
import { applyTraitAdjustment, dawnForRun, dusk, founders, snapshot, step } from '../src/engine/simulation.js'
import { traitAdjustmentGroup, validTraitAdjustment, validTraitChange } from '../src/engine/trait-adjustments.js'
import { simulateForecast } from '../src/forecast.js'
import { prepareTrack, trackFrame } from '../src/track.js'

test('allows signed point changes and rejects empty, nonfinite, over-limit, or fractional-cent input', () => {
  for (const value of [-100, -1.02, 0, 0.01, 100]) assert.equal(validTraitChange(value), true)
  for (const value of ['', null, Infinity, NaN, -100.01, 100.01, 0.001]) assert.equal(validTraitChange(value), false)
  assert.equal(validTraitAdjustment({ speed: 0, size: 0, sense: 0 }), false)
  assert.equal(validTraitAdjustment({ speed: 1, size: 0, sense: -0.25 }), true)
})

test('changes living blobs across species and refuge without touching deaths, energy, or starting traits', () => {
  const setup = starter()
  setup.species[1].enabled = true
  for (const species of setup.species) {
    species.count = 2
    species.mutation = { speed: false, size: false, sense: false }
  }
  Object.assign(setup.aging, { enabled: true, onsetAge: 0, speedLoss: 10, riskIncrease: 0, maxAge: 0 })
  const opening = founders(setup)
  opening.roster[0].age = 2
  const state = dawnForRun(setup, [], 1, opening)
  state.tick = 12
  const [home, dead, orange, other] = state.blobs
  Object.assign(home, { home: true, state: 5, credits: 2, energy: 120 })
  Object.assign(dead, { alive: false, state: 6 })
  const deadBefore = structuredClone(dead), openingBefore = structuredClone(opening)
  assert.equal(applyTraitAdjustment(state, setup, { speed: 0.5, size: -70, sense: -23 }), 3)
  assert.deepEqual(dead, deadBefore)
  assert.deepEqual(opening, openingBefore)
  assert.deepEqual([home.speed, home.size, home.sense, home.energy, home.credits, home.home], [10.5, 1, 0, 120, 2, true])
  assert.deepEqual([orange.speed, orange.size, orange.sense], [10.5, 1, 27])
  assert.deepEqual([home.r, home.speedWorld, home.moveCost, home.rate], [
    radius(1), travel(home, setup) * 0.8, walkthroughStepCost(home, setup), walkthroughStepCost(home, setup) / state.stepSeconds,
  ])
  assert.deepEqual(state.events.map(event => event.id), [home.id, orange.id, other.id])
  const { checkpoint, summary } = dusk(state, setup)
  assert.equal(checkpoint.roster.length, 2)
  assert.ok(checkpoint.roster.every(blob => blob.speed === 10.5 && blob.size === 1 && blob.sense === 0))
  assert.equal(summary.rows.all.speed.mean, 10.5)
  assert.equal(applyTraitAdjustment(state, setup, { speed: 1, size: 1, sense: 1 }), 0)
})

test('live, resumed, batched, and forecast runs apply each intervention at the same tick', () => {
  const setup = { ...starter(), food: 500, predation: false, days: 10, endMode: 'timed', duration: 100 }
  setup.species[1].enabled = true
  const initial = founders(setup)
  const live = dawnForRun(setup, [], 1, initial)
  const orangeIds = traitAdjustmentGroup(live.blobs, { speciesIds: ['orange'], creatureIds: null, activity: 'active' }).map(blob => blob.id)
  const traitAdjustments = [
    { day: 1, tick: 0, changes: { speed: 0.25, size: 0, sense: 0 } },
    { day: 1, tick: 3, changes: { speed: 2.5, size: -1, sense: 10 }, creatureIds: orangeIds },
    { day: 1, tick: 3, changes: { speed: -0.75, size: 0, sense: 0 }, creatureIds: [live.blobs[0].id, orangeIds[0]] },
    { day: 1, tick: 9, changes: { speed: 0, size: 0, sense: -2 } },
  ]
  for (const { tick, changes, creatureIds } of traitAdjustments) {
    if (live.tick < tick) assert.equal(step(live, setup, tick - live.tick), null)
    assert.ok(applyTraitAdjustment(live, setup, changes, creatureIds) > 0)
  }
  const resumed = structuredClone(live)
  const scheduled = dawnForRun(setup, [], 1, initial, traitAdjustments)
  const result = step(live, setup, Infinity)
  assert.ok(result.checkpoint.roster.length > 0)
  assert.deepEqual(step(resumed, setup, Infinity, true), result)
  assert.deepEqual(step(scheduled, setup, Infinity, true), result)
  assert.deepEqual(snapshot(scheduled), snapshot(live))
  const next = step(dawnForRun(setup, [], 2, result.checkpoint), setup, Infinity, true)
  const forecast = simulateForecast({ setup, revisions: [], checkpoint: initial, start: 0, end: 0, target: 2, traitAdjustments })
  assert.deepEqual(forecast.summaries, [result.summary, next.summary])
})

test('group filters intersect species and activity and only edit the selected living IDs', () => {
  const setup = starter()
  setup.species[0].count = 2
  Object.assign(setup.species[1], { enabled: true, count: 3 })
  const state = dawnForRun(setup, [], 1, founders(setup))
  const [blueHome, blueActive, orangeHome, orangeActive, orangeDead] = state.blobs
  blueHome.home = orangeHome.home = orangeDead.home = true
  orangeDead.alive = false
  const group = (speciesIds, activity, creatureIds = null) => traitAdjustmentGroup(state.blobs, { speciesIds, activity, creatureIds })
  assert.deepEqual(group(null, 'home'), [blueHome, orangeHome])
  assert.deepEqual(group(['orange'], 'any'), [orangeHome, orangeActive])
  assert.deepEqual(group(['orange'], 'active'), [orangeActive])
  assert.deepEqual(group(['blue', 'orange'], 'active'), [blueActive, orangeActive])
  const picked = [blueHome.id, orangeHome.id, orangeActive.id, orangeDead.id, 999]
  assert.deepEqual(group(null, 'any', picked), [blueHome, orangeHome, orangeActive])
  assert.deepEqual(group(null, 'home', picked), [blueHome, orangeHome])
  assert.deepEqual(group([], 'any'), [])
  assert.deepEqual(group(null, 'any', []), [])
  const targets = group(['orange'], 'home', picked).map(blob => blob.id)
  assert.deepEqual(targets, [orangeHome.id])
  const before = state.blobs.map(blob => blob.speed)
  const changes = { speed: 2, size: 0, sense: 0 }
  assert.equal(applyTraitAdjustment(state, setup, changes, []), 0)
  assert.equal(applyTraitAdjustment(state, setup, changes, targets), 1)
  before[2] += 2
  assert.deepEqual(state.blobs.map(blob => blob.speed), before)
  assert.deepEqual(state.events.map(event => event.id), targets)
})

test('replay changes traits on the recorded tick even between saved samples and restores them when rewinding', () => {
  const setup = starter()
  const state = dawnForRun(setup, [], 1, founders(setup))
  const blob = state.blobs[0]
  state.blobs = [blob]
  const opening = structuredClone(state.blobs)
  state.tick = 3
  applyTraitAdjustment(state, setup, { speed: 10, size: 2, sense: -5 })
  applyTraitAdjustment(state, setup, { speed: -1, size: 0, sense: 0 })
  const sample = [blob.x, blob.y, blob.angle, blob.energy, 0, 0, 0]
  const track = prepareTrack({ day: 1, duration: 0.5, stepSeconds: 0.1, stride: 5,
    opening, plants: [], events: state.events, frames: new Float32Array([...sample, ...sample]), final: snapshot(state) })
  assert.equal(trackFrame(track, 0.29).blobs[0].speed, 10)
  assert.deepEqual([
    trackFrame(track, 0.3).blobs[0].speed, trackFrame(track, 0.3).blobs[0].r, trackFrame(track, 0.3).blobs[0].sense,
  ], [19, radius(12), 15])
  assert.equal(trackFrame(track, 0.2).blobs[0].speed, 10)
})
