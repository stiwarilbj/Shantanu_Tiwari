import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_DIET, copyDiet, encounterResult, foodWebAt, setDiet } from '../src/engine/food-web.js'
import { FOOD_SEASONS_RULE_VERSION, starter, validate } from '../src/engine/config.js'
import { canHunt, huntBlock } from '../src/engine/geometry.js'
import { applySpeciesAction, dawnForRun, founders, snapshot, step } from '../src/engine/simulation.js'
import { newSpecies, runSpecies, validSpeciesHistory } from '../src/engine/species-actions.js'
import { preyMeals } from '../src/engine/stats.js'
import { setupFromLink, setupLink } from '../src/export.js'
import { simulateForecast } from '../src/forecast.js'
import { prepareTrack, trackFrame } from '../src/track.js'

const select = (...prey) => ({ plants: false, hunt: 'selected', prey })
const plantOnly = { plants: true, hunt: 'none', prey: [] }
const customWeb = { enabled: true, diets: { blue: plantOnly, orange: select('blue') } }

function experiment(foraging) {
  const setup = { ...starter(), foraging, endMode: 'timed', duration: 100, food: 150, foodWeb: customWeb }
  for (const species of setup.species.slice(0, 2)) Object.assign(species, { enabled: true, energy: 1000, count: 10 })
  return setup
}

function encounter(setup, x = 250) {
  const initial = founders(setup)
  const field = dawnForRun(setup, [], 1, { ...initial, roster: initial.roster.filter(blob => [1, 11].includes(blob.id)) })
  const [blue, orange] = field.blobs
  Object.assign(blue, { x: 250, y: 250, size: 12, speedWorld: 10, angle: 0, sense: 0 })
  Object.assign(orange, { x, y: 250, size: 15, speedWorld: 10, angle: 0, sense: 0 })
  return { field, blue, orange }
}

test('diet permissions are directional and still respect field restrictions and exact size thresholds', () => {
  const config = experiment()
  const hunter = { id: 1, enabled: true, species: 'orange', size: 15 }
  const prey = { id: 2, enabled: true, species: 'blue', size: 12 }
  assert.deepEqual([14.999, 15, 15.001].map(size => canHunt({ ...hunter, size }, prey, config)), [false, true, true])
  assert.equal(canHunt({ ...prey, size: 100 }, hunter, config), false)
  assert.equal(canHunt(hunter, { ...prey, species: 'newcomer' }, config), false)
  assert.equal(canHunt(hunter, { ...prey, species: 'newcomer' }, { ...config, foodWeb: { enabled: true, diets: {} } }), true)
  assert.match(encounterResult({ ...config, firstHuntingDay: 2 }, hunter, prey, 1, huntBlock), /begins on Day 2/)
  assert.match(encounterResult({ ...config, predation: false }, hunter, prey, 2, huntBlock), /Hunting is off/)
  assert.match(encounterResult(config, hunter, null, 1, huntBlock), /excludes plants/)
  const cannibal = { ...config, foodWeb: setDiet(customWeb, 'orange', select('orange')) }
  assert.equal(canHunt(hunter, { ...prey, species: 'orange' }, cannibal), true)
  assert.equal(canHunt(hunter, { ...prey, species: 'orange' }, { ...cannibal, sameSpecies: false }), false)
  assert.equal(canHunt(hunter, { ...prey, id: hunter.id }, cannibal), false)
})

test('both movement modes enforce plant and prey permissions on contact, including at a live edit', () => {
  for (const foraging of [undefined, 'walkthrough']) {
    const config = experiment(foraging)
    config.foragingDecisions.preyPursuit = 0
    const { field, orange } = encounter(config)
    field.plants = [{ id: 100, x: 250, y: 250 }, { id: 101, x: 400, y: 400 }]
    const change = { kind: 'food-web', foodWeb: setDiet(customWeb, 'orange', select()) }
    orange.steering = { kind: 'prey', id: 1, plant: { id: 100, x: 250, y: 250, time: 0 } }
    const before = [orange.energy, orange.credits, orange.x, orange.y]
    assert.equal(applySpeciesAction(field, config, change), '')
    assert.equal(orange.steering.kind, null)
    assert.equal(orange.steering.plant, null)
    assert.deepEqual([orange.energy, orange.credits, orange.x, orange.y], before)
    step(field, config)
    assert.ok(orange.alive)
    assert.deepEqual(field.events.filter(event => event.type === 'plant' || event.type === 'prey').map(event => event.species), ['blue'])

    const allowed = encounter(config)
    allowed.field.plants = []
    step(allowed.field, config)
    assert.deepEqual(preyMeals(allowed.field.events), { orange: { blue: 1 } })

    const refuge = encounter(config)
    refuge.blue.home = true
    refuge.field.plants = []
    step(refuge.field, config)
    assert.deepEqual(preyMeals(refuge.field.events), {})
  }
})

test('Video experiment keeps an empty field playable while legal prey remain', () => {
  const config = experiment('walkthrough')
  for (const enabled of [true, false]) {
    const rules = { ...config, foodWeb: { ...customWeb, enabled } }
    const { field, blue, orange } = encounter(rules, 350)
    field.plants = []
    step(field, rules)
    assert.equal(blue.alive, enabled)
    assert.equal(orange.alive, enabled)
  }
})

test('turning the food web off preserves version 14 outcomes with either movement mode', () => {
  for (const foraging of [undefined, 'walkthrough']) {
    const config = experiment(foraging)
    config.foodWeb = { ...customWeb, enabled: false }
    const legacy = { ...config, foodWeb: undefined, version: FOOD_SEASONS_RULE_VERSION }
    let checkpoint = founders(config), prior = founders(legacy)
    for (let day = 1; day <= 3; day++) {
      const current = dawnForRun(config, [], day, checkpoint)
      const previous = dawnForRun(legacy, [], day, prior)
      const v15 = step(current, config, Infinity, true)
      const v14 = step(previous, legacy, Infinity, true)
      assert.deepEqual(v15.summary.rows, v14.summary.rows)
      assert.deepEqual(current.events, previous.events)
      assert.deepEqual(v15.checkpoint.roster, v14.checkpoint.roster)
      checkpoint = v15.checkpoint
      prior = v14.checkpoint
    }
  }
})

test('timed diets, introductions, splits and renames agree across resumed play, batches, forecasts and forks', () => {
  const setup = experiment()
  const initial = founders(setup)
  const live = dawnForRun(setup, [], 1, initial)
  step(live, setup, 2)
  const mint = { ...newSpecies(setup.species, setup.version), name: 'Mint' }
  const teal = { ...newSpecies([...setup.species, mint], setup.version, setup.species[1]), name: 'Teal' }
  const orange = live.blobs.find(blob => blob.species === 'orange')
  const web = setDiet(customWeb, 'orange', select('blue', 'orange'))
  const actions = [
    { kind: 'food-web', foodWeb: web },
    { kind: 'introduce', id: mint.id, count: 1, creatureIds: [initial.nextId], definition: mint, diet: plantOnly },
    { kind: 'split', id: teal.id, sourceId: 'orange', definition: teal, creatureIds: [orange.id],
      diet: copyDiet(web.diets.orange, 'orange', teal.id) },
    { kind: 'edit', id: teal.id, identity: { name: 'Jade', color: teal.color }, creatureIds: [orange.id] },
  ].map((action, index) => ({ ...action, day: 1, tick: 2, order: index + 1 }))
  for (const action of actions) assert.equal(applySpeciesAction(live, setup, action), '')
  const savedActions = JSON.parse(JSON.stringify(actions))
  assert.ok(validSpeciesHistory(setup, [], savedActions))
  assert.equal(validSpeciesHistory(setup, [], [{ ...actions[0], foodWeb: setDiet(web, 'orange', select('ghost')) }]), false)
  const run = { setup, revisions: [], speciesActions: savedActions }
  assert.deepEqual(foodWebAt(run, 1, 1), customWeb)
  assert.deepEqual(foodWebAt(run, 1, 2), live.foodWeb)
  assert.deepEqual(live.foodWeb.diets[teal.id].prey, ['blue', teal.id])
  assert.equal(runSpecies(run, 1, 2).find(item => item.id === teal.id).name, 'Jade')
  const replay = dawnForRun(setup, [], 1, initial, [], savedActions)
  step(replay, setup, 2)
  assert.deepEqual(snapshot(replay), snapshot(live))
  const resumed = JSON.parse(JSON.stringify(live))
  let complete
  while (!(complete = step(live, setup))) {}
  assert.deepEqual(step(resumed, setup, Infinity, true), complete)
  assert.deepEqual(step(replay, setup, Infinity, true), complete)
  const forecast = simulateForecast({ setup, revisions: [], start: 0, end: 0, target: 1, checkpoint: initial, speciesActions: savedActions })
  assert.deepEqual(forecast.summaries, [complete.summary])
  assert.deepEqual(forecast.checkpoint, complete.checkpoint)
  assert.deepEqual(complete.summary.preyMeals, preyMeals(live.events))
  assert.equal(complete.summary.rows.all.hunts, live.events.filter(event => event.type === 'prey').length)

  const branched = { ...setup, foodWeb: setDiet(complete.checkpoint.foodWeb, teal.id, DEFAULT_DIET) }
  const revisions = [{ day: 1, setup }, { day: 2, setup: branched }]
  const next = dawnForRun(branched, revisions, 2, complete.checkpoint)
  assert.deepEqual(next.foodWeb, branched.foodWeb)
  assert.deepEqual(foodWebAt({ ...run, revisions }, 2), branched.foodWeb)
  assert.equal(next.speciesEdits[teal.id].name, 'Jade')

  const track = prepareTrack({ day: 1, duration: 1, stride: 1, frames: [], opening: [], plants: [], final: snapshot(live),
    foodWeb: setup.foodWeb, events: live.events })
  assert.deepEqual(trackFrame(track, .2).foodWeb, snapshot(replay).foodWeb)
  assert.deepEqual(trackFrame(track, .1).foodWeb, customWeb)
})

test('prey counts use the species at consumption time and ignore the paired death event', () => {
  assert.deepEqual(preyMeals([
    { type: 'prey', species: 'orange', targetSpecies: 'blue' },
    { type: 'transferred', species: 'teal', fromSpecies: 'orange' },
    { type: 'prey', species: 'teal', targetSpecies: 'blue' },
    { type: 'death', species: 'blue', cause: 'Predation', targetSpecies: 'teal' },
  ]), { orange: { blue: 1 }, teal: { blue: 1 } })
})

test('setup validation, JSON and compact links preserve active and parked diets', t => {
  Object.defineProperty(globalThis, 'location', {
    value: new URL('https://stiwarilbj.github.io/Shantanu_Tiwari/experiments/evolution-simulator/'), configurable: true,
  })
  t.after(() => { delete globalThis.location })
  for (const enabled of [true, false]) {
    const setup = experiment()
    delete setup.foraging
    setup.foodWeb = { ...customWeb, enabled }
    assert.deepEqual(validate(setup), {})
    assert.deepEqual(JSON.parse(JSON.stringify(setup)), setup)
    const link = setupLink(setup)
    assert.ok(link)
    assert.deepEqual(setupFromLink(new URL(link).hash), setup)
  }
  const invalid = { ...experiment(), foodWeb: setDiet(customWeb, 'orange', select('blue', 'blue')) }
  assert.match(validate(invalid).foodWeb, /Check the species diets/)
})
