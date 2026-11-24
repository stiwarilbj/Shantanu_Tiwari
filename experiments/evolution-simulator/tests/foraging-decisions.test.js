import assert from 'node:assert/strict'
import test from 'node:test'
import { AGING_RULE_VERSION, FORAGING_DEFAULTS, OPTIONAL_RULES_VERSION, setupForNewRun, starter, validate } from '../src/engine/config.js'
import { canPursuePrey, DECISION, keepsMeal, mealFitsBudget, remembersPlant, returnReserve,
  shouldReturn } from '../src/engine/foraging-decisions.js'
import { Grid } from '../src/engine/geometry.js'
import { dawn, founders, snapshot, step } from '../src/engine/simulation.js'
import { improvedIntent } from '../src/engine/steering.js'
import { prepareTrack, trackFrame } from '../src/track.js'

test('foraging thresholds include exact memory, pursuit and budget ties and retain a tied target', () => {
  assert.deepEqual([.59, .6, .61].map(elapsed => remembersPlant(elapsed, .6)), [true, true, false])
  assert.equal(remembersPlant(0, 0), false)
  assert.deepEqual([7.99, 8, 8.01].map(time => keepsMeal(10, time, 20)), [false, true, true])
  assert.deepEqual([.092999, .093, .093001].map(time => keepsMeal(.1, time, 7)), [false, true, true])
  assert.equal(keepsMeal(.1, .093, 7, OPTIONAL_RULES_VERSION), false)
  assert.equal(keepsMeal(10, 9.99, 0), false)
  assert.equal(keepsMeal(.1, .09999999999999999, 0), false)
  assert.equal(keepsMeal(10, 10, 0), true)
  assert.equal(keepsMeal(10, 0, 100), true)
  assert.deepEqual([.99, 1, 1.01].map(time => canPursuePrey(time, 1)), [true, true, false])
  assert.equal(canPursuePrey(0, 0), false)
  const reserve = returnReserve({ returnMargin:5 }, .05)
  assert.equal(reserve, .25)
  assert.deepEqual([.99, 1, 1.01].map(left => shouldReturn(left, .75, reserve)), [true, true, false])
  assert.deepEqual([.99, 1, 1.01].map(trip => mealFitsBudget(trip, .5, 1.75 - reserve)), [true, true, false])
})

test('species choose differently when the same plant disappears and a closer meal appears', () => {
  const config = { ...starter(), predation:false }
  const [, orange] = config.species
  orange.enabled = true
  orange.foragingDecisions = { ...FORAGING_DEFAULTS, plantMemory:0, switchSavings:0 }
  const initial = founders(config)
  const field = dawn(config, 1, {
    ...initial, roster:initial.roster.filter(blob => [1, 51].includes(blob.id)),
  })
  const newGrid = (...items) => {
    const grid = new Grid()
    for (const item of items) grid.insert(item)
    return grid
  }
  const current = { id:1, x:190, y:250 }
  const nearby = { id:2, x:185, y:250 }
  const creatures = new Grid()
  function decide(plants) {
    for (const blob of field.blobs) improvedIntent(blob, field, config, plants, creatures, 5)
    field.tick++
    return field.blobs.map(blob => blob.foragingDecision)
  }
  for (const blob of field.blobs) Object.assign(blob, { x:150, y:250, angle:0, sense:50 })
  assert.deepEqual(decide(newGrid(current)), [DECISION.plant, DECISION.plant])
  assert.deepEqual(decide(newGrid(current, nearby)), [DECISION.keepMeal, DECISION.switchPlant])
  assert.ok(field.blobs.every(blob => blob.foragingSavings > 13 && blob.foragingSavings < 15))
  for (const blob of field.blobs) blob.x = 130
  assert.deepEqual(decide(new Grid()), [DECISION.rememberedPlant, DECISION.forgotPlant])
  field.blobs[0].x = 150
  assert.equal(decide(new Grid())[0], DECISION.missingPlant)
  assert.equal(field.blobs[0].steering.plant, null)

  config.foragingDecisions.returnMargin = 21
  orange.foragingDecisions.preyPursuit = .25
  assert.deepEqual(Object.keys(validate(config)), ['foragingDecisions.returnMargin', 'orange.foragingDecisions.preyPursuit'])
})

test('the pursuit limit changes deliberate chasing but allows an incidental hunt', () => {
  const config = starter()
  config.foragingDecisions.preyPursuit = 0
  const initial = founders(config)
  const field = dawn(config, 1, { ...initial, roster:initial.roster.slice(0, 2) })
  const [hunter, prey] = field.blobs
  Object.assign(hunter, { x:150, y:250, angle:0, size:20, sense:100 })
  Object.assign(prey, { x:170, y:250, angle:0, sense:0 })
  const nearby = new Grid()
  nearby.insert(prey)
  improvedIntent(hunter, field, config, new Grid(), nearby, 5)
  assert.equal(hunter.foragingDecision, DECISION.searching)
  config.foragingDecisions.preyPursuit = 1
  improvedIntent(hunter, field, config, new Grid(), nearby, 5)
  assert.equal(hunter.foragingDecision, DECISION.prey)
  config.foragingDecisions.preyPursuit = 0
  prey.x = hunter.x + 2
  field.plants = []
  step(field, config)
  assert.equal(hunter.foragingDecision, DECISION.pursuitLimit)
  assert.ok(field.events.some(event => event.type === 'prey' && event.id === hunter.id))
})

test('a close predator overrides targeting food and a safety margin can send a fed creature home', () => {
  const config = starter()
  config.foragingDecisions.returnMargin = 8
  const initial = founders(config)
  const field = dawn(config, 1, { ...initial, roster:initial.roster.slice(0, 2) })
  const [blob, hunter] = field.blobs
  Object.assign(blob, { x:100, y:250, angle:Math.PI, sense:100, speedWorld:100 })
  Object.assign(hunter, { x:140, y:250, angle:Math.PI, size:20, velocityX:-200 })
  const plants = new Grid()
  plants.insert({ id:1, x:80, y:250 })
  const creatures = new Grid()
  improvedIntent(blob, field, config, plants, creatures, 5)
  assert.equal(blob.foragingDecision, DECISION.plant)
  creatures.insert(hunter)
  improvedIntent(blob, field, config, plants, creatures, 5)
  assert.equal(blob.foragingDecision, DECISION.escape)
  blob.credits = 1
  improvedIntent(blob, field, config, plants, new Grid(), 1.3)
  assert.equal(blob.foragingDecision, DECISION.returnForTime)
  assert.equal(blob.state, 4)
})

test('foraging defaults preserve version 9 and custom runs survive a pause with the same results', () => {
  const previous = { ...starter(AGING_RULE_VERSION), food:140, seed:118 }
  const updated = setupForNewRun(previous)
  assert.deepEqual(updated.foragingDecisions, FORAGING_DEFAULTS)
  const custom = structuredClone(updated)
  Object.assign(custom.foragingDecisions, { plantMemory:2, switchSavings:0, returnMargin:6, preyPursuit:2 })
  let checkpoint = founders(previous)
  let customCheckpoint = checkpoint
  let changed = false
  for (let day = 1; day <= 5; day++) {
    const old = dawn(previous, day, checkpoint)
    const upgraded = dawn(updated, day, checkpoint)
    const expected = step(old, previous, Infinity, true)
    assert.deepEqual(step(upgraded, updated, Infinity, true), expected)
    assert.deepEqual(upgraded.events, old.events)
    checkpoint = expected.checkpoint

    const live = dawn(custom, day, customCheckpoint)
    const batch = structuredClone(live)
    for (let tick = 0; tick < 5; tick++) step(live, custom)
    const resumed = structuredClone(live)
    let result
    while (!(result = step(live, custom))) {}
    assert.deepEqual(step(resumed, custom, Infinity, true), result)
    assert.deepEqual(step(batch, custom, Infinity, true), result)
    assert.deepEqual(snapshot(batch), snapshot(live))
    if (!changed && JSON.stringify(result.summary) !== JSON.stringify(expected.summary)) changed = true
    customCheckpoint = result.checkpoint
  }
  assert.ok(changed)
})

test('replay uses the reason from the sampled tick when seeking forward or back', () => {
  const reasons = [DECISION.searching, DECISION.plant, DECISION.switchPlant, DECISION.escape, DECISION.escape]
  const track = prepareTrack({
    day:1, duration:.4, stride:1, stepSeconds:.1, fields:9, opening:[{ id:1 }], plants:[],
    final:{ refugeWidth:50 },
    frames:new Float32Array(reasons.flatMap((reason, tick) => [tick, 0, 0, 10, 0, 1, 0, reason, tick === 2 ? 25 : 0])),
    events:[{ id:1, type:'death', time:.35, x:3.5, y:0, energy:0 }],
  })
  const blobAt = time => trackFrame(track, time).blobs[0]
  assert.equal(blobAt(.3).foragingDecision, DECISION.escape)
  assert.equal(blobAt(.35).alive, false)
  assert.equal(blobAt(.2).foragingDecision, DECISION.switchPlant)
  assert.equal(blobAt(.2).foragingSavings, 25)
  assert.equal(blobAt(.1).foragingDecision, DECISION.plant)
  assert.equal(blobAt(.1).foragingSavings, 0)
})
