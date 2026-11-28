import assert from 'node:assert/strict'
import test from 'node:test'
import { FOOD_WEB_RULE_VERSION, plantsForDay, starter, validate } from '../src/engine/config.js'
import { openingHabitat } from '../src/engine/habitat.js'
import { plantFoodCounts } from '../src/engine/plant-food.js'
import { dawnForRun, founders, snapshot, step } from '../src/engine/simulation.js'
import { setupFromLink, setupLink } from '../src/export.js'
import { simulateForecast } from '../src/forecast.js'

function setupFor(foraging) {
  const setup = {
    ...starter(), food: 31, foraging, predation: false, endMode: 'timed', duration: 120,
    plantFoods: { enabled: true, weights: [2, 1, 0], diets: { blue: ['seeds'], orange: ['berries', 'mushrooms'] } },
  }
  Object.assign(setup.species[0], { count: 10, energy: 1000 })
  Object.assign(setup.species[1], { enabled: true, energy: 1000 })
  return setup
}

test('food weights split the scheduled supply without changing its positions', () => {
  assert.deepEqual(plantFoodCounts([1, 1, 1], 50), [17, 17, 16])
  assert.deepEqual(plantFoodCounts([2, 1, 0], 31), [21, 10, 0])
  const rules = { ...setupFor(), foodPlacement: 'patches', scheduleMode: 'step', schedule: [{ day: 2, food: 32 }],
    foodSeasons: { ...starter().foodSeasons, enabled: true } }
  for (const day of [1, 2, 5, 8]) {
    const { plants } = openingHabitat(rules, day)
    const counts = ['seeds', 'berries', 'mushrooms'].map(type => plants.filter(plant => plant.type === type).length)
    assert.deepEqual(counts, plantFoodCounts([2, 1, 0], plantsForDay(rules, day)))
    assert.deepEqual(plants, openingHabitat(rules, day).plants)
    assert.deepEqual(plants.map(({ type, ...plant }) => plant),
      openingHabitat({ ...rules, version: FOOD_WEB_RULE_VERSION }, day).plants)
  }
})

test('both movement modes enforce each species’ list, even on contact with a closer food', () => {
  for (const mode of [undefined, 'walkthrough']) {
    const rules = setupFor(mode)
    const initial = founders(rules)
    const roster = initial.roster.filter(blob => [1, 11].includes(blob.id))
    const field = dawnForRun(rules, [], 1, { ...initial, roster })
    const [blue, orange] = field.blobs
    Object.assign(blue, { x: 200, y: 250, angle: 0, speedWorld: 1, sense: 12 })
    Object.assign(orange, { x: 300, y: 250, angle: 0, speedWorld: 1, sense: 12 })
    field.plants = [
      { id: 0, x: 200, y: 250, type: 'berries' },
      { id: 1, x: 201, y: 250, type: 'seeds' },
      { id: 2, x: 300, y: 250, type: 'seeds' },
      { id: 3, x: 301, y: 250, type: 'berries' },
    ]
    step(field, rules)
    assert.deepEqual(field.events.filter(event => event.type === 'plant')
      .map(({ species, foodType }) => [species, foodType]).sort(), [['blue', 'seeds'], ['orange', 'berries']])
    assert.equal(field.plants[0].eaten, undefined)
    assert.equal(field.plants[2].eaten, undefined)

    const restricted = { ...rules, foodWeb: { enabled: true, diets: { blue: { plants: false, hunt: 'none', prey: [] } } },
      plantFoods: { ...rules.plantFoods, diets: { orange: [] } } }
    const blocked = dawnForRun(restricted, [], 1, { ...initial, roster })
    blocked.plants = blocked.blobs.map((blob, id) => ({ id, x: blob.x, y: blob.y, type: 'seeds' }))
    step(blocked, restricted)
    assert.equal(blocked.events.filter(event => event.type === 'plant').length, 0)
  }
})

test('parked rules preserve old results and an enabled branch stays deterministic across playback paths', () => {
  for (const mode of [undefined, 'walkthrough']) {
    const enabled = setupFor(mode)
    const disabled = { ...enabled, plantFoods: { ...enabled.plantFoods, enabled: false } }
    const legacy = { ...disabled, version: FOOD_WEB_RULE_VERSION }
    delete legacy.plantFoods
    const initial = founders(disabled)
    const past = dawnForRun(disabled, [], 1, initial)
    const older = dawnForRun(legacy, [], 1, initial)
    const previous = step(past, disabled, Infinity, true)
    assert.deepEqual(previous, step(older, legacy, Infinity, true))
    assert.deepEqual(snapshot(past), snapshot(older))
    const revisions = [{ day: 1, setup: legacy }, { day: 2, setup: enabled }]
    const live = dawnForRun(enabled, revisions, 2, previous.checkpoint)
    const replay = dawnForRun(enabled, revisions, 2, previous.checkpoint)
    assert.ok(live.plants.every(plant => plant.type))
    assert.deepEqual(snapshot(live), snapshot(replay))
    step(live, enabled, 2)
    const resumed = structuredClone(live)
    const batch = step(replay, enabled, Infinity, true)
    while (!step(live, enabled)) {}
    assert.deepEqual(live.settled, batch)
    assert.deepEqual(step(resumed, enabled, Infinity, true), batch)
    assert.deepEqual(live.events, replay.events)
    const forecast = simulateForecast({ setup: enabled, revisions, start: 1, end: 1, target: 2, checkpoint: previous.checkpoint })
    assert.deepEqual(forecast.summaries, [batch.summary])
  }
})

test('setup links and JSON preserve active and parked food types and validate the mix', t => {
  Object.defineProperty(globalThis, 'location', {
    value: new URL('https://stiwarilbj.github.io/Shantanu_Tiwari/experiments/evolution-simulator/'), configurable: true,
  })
  t.after(() => { delete globalThis.location })
  for (const enabled of [true, false]) {
    const setup = setupFor()
    delete setup.foraging
    Object.assign(setup.plantFoods, { enabled })
    setup.plantFoods.diets.pink = []
    assert.deepEqual(validate(setup), {})
    assert.deepEqual(JSON.parse(JSON.stringify(setup)), setup)
    const link = setupLink(setup)
    assert.ok(link)
    assert.deepEqual(setupFromLink(new URL(link).hash), setup)
  }
  for (const weights of [[0, 0, 0], [101, 0, 0], [1.5, 1, 1], [1, 2]]) {
    const setup = setupFor()
    setup.plantFoods.weights = weights
    assert.ok(validate(setup).plantFoods)
  }
  const invalid = setupFor()
  invalid.plantFoods.diets.blue.push('unrecognized')
  assert.ok(validate(invalid).plantFoods)
})
