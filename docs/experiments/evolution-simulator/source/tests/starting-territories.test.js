import assert from 'node:assert/strict'
import test from 'node:test'
import { FORAGING_DECISION_RULE_VERSION, rulesFor, starter, TERRITORY_EDGES, TERRITORY_RULE_VERSION, validate } from '../src/engine/config.js'
import { FIELD } from '../src/engine/geometry.js'
import { dawn, dawnForRun, founders, step } from '../src/engine/simulation.js'
import { startingEdge } from '../src/engine/starting-territories.js'
import { simulateForecast } from '../src/forecast.js'

function field() {
  const setup = { ...starter(), seed: 118, predation: false, food: 500 }
  Object.assign(setup.territories, { enabled: true, edges: ['top', 'left'], center: 0, width: 30 })
  Object.assign(setup.species[0], { count: 11, energy: 1000 })
  Object.assign(setup.species[1], { enabled: true, energy: 1000, territory: { edges: ['right'], center: 100, width: 20 } })
  return setup
}

function finish(board, rules) {
  while (!board.settled) step(board, rules, 20, true)
  return board.settled
}

test('species get balanced seeded edge slots and corner bands keep their full width', () => {
  const setup = field()
  for (const foraging of ['standard', 'walkthrough']) {
    setup.foraging = foraging
    const opening = founders(setup)
    const board = dawn(setup, 1, opening)
    assert.deepEqual(board, dawn(setup, 1, opening))
    assert.notDeepEqual(board.blobs, dawn({ ...setup, seed: 312 }, 1, opening).blobs)
    const sides = { top: 0, left: 0 }
    const margin = board.refugeWidth + 6
    const usable = FIELD - 2 * margin
    for (const blob of board.blobs) {
      const edge = startingEdge(blob)
      const along = edge === 'top' ? blob.x : blob.y
      const inward = { top: Math.PI / 2, right: Math.PI, left: 0 }[edge]
      assert.ok(Math.abs(blob.angle - inward) <= Math.PI / 12)
      if (blob.species === 'blue') {
        assert.ok(Object.hasOwn(sides, edge))
        sides[edge]++
        assert.ok(along > margin && along < margin + usable * .3)
      } else {
        assert.equal(edge, 'right')
        assert.ok(along > FIELD - margin - usable * .2 && along < FIELD - margin)
      }
    }
    assert.deepEqual(Object.values(sides).sort(), [5, 6])
    assert.deepEqual(board.plants, dawn({ ...setup, territories: { ...setup.territories, enabled: false } }, 1, opening).plants)
  }
})

test('the v11 default and enabled all-edge full-width settings preserve v10 outcomes', () => {
  for (const foraging of [undefined, 'walkthrough']) {
    const older = { ...field(), version: FORAGING_DECISION_RULE_VERSION, foraging }
    const defaults = { ...older, version: TERRITORY_RULE_VERSION, territories: starter().territories }
    const full = { ...defaults, territories: { ...defaults.territories, enabled: true, timing: 'daily', center: 10 },
      species: defaults.species.map(species => ({ ...species, territory: {
        edges: [...TERRITORY_EDGES].reverse(), center: 95, width: 100,
      } })) }
    delete defaults.species[1].territory
    let opening = founders(older)
    for (let day = 1; day <= 5; day++) {
      assert.ok(opening.roster.length)
      const board = dawn(older, day, opening)
      const defaultBoard = dawn(defaults, day, opening)
      const fullBoard = dawn(full, day, opening)
      assert.deepEqual(defaultBoard, board)
      assert.deepEqual(fullBoard, board)
      const expected = finish(board, older)
      assert.deepEqual(finish(defaultBoard, defaults), expected)
      assert.deepEqual(finish(fullBoard, full), expected)
      opening = expected.checkpoint
    }
  }
})

test('opening-only branch placement follows effective revisions and includes newborns', () => {
  const initial = field()
  initial.territories.edges = ['left']
  const originalDay = dawn(initial, 1, founders(initial))
  const fork = finish(originalDay, initial).checkpoint
  assert.ok(fork.roster.some(blob => blob.parent !== null))
  assert.ok(fork.roster.some(blob => blob.parent === null))
  const edited = structuredClone(initial)
  edited.territories.edges = ['bottom']
  const revisions = [{ day: 1, setup: initial }, { day: 2, setup: edited }]
  const changed = dawnForRun(edited, revisions, 2, fork)
  assert.equal(changed.blobs.length, fork.roster.length)
  assert.ok(changed.blobs.some(blob => blob.species === 'blue'))
  for (const blob of changed.blobs) assert.equal(startingEdge(blob), blob.species === 'blue' ? 'bottom' : 'right')
  assert.deepEqual(dawnForRun(edited, revisions, 1, founders(initial)), dawn(initial, 1, founders(initial)))
  assert.deepEqual(dawnForRun(edited, revisions, 3, fork), dawn(edited, 3, fork))

  const unrelated = structuredClone(initial)
  unrelated.food = 600
  // Centers 0 and 10 both slide this 30% band to the same place.
  unrelated.species[0].territory = { edges: ['left'], center: 10, width: 30 }
  const sameRules = [{ day: 1, setup: initial }, { day: 2, setup: unrelated }]
  assert.deepEqual(dawnForRun(unrelated, sameRules, 2, fork), dawn(unrelated, 2, fork))
  assert.notDeepEqual(dawn(unrelated, 2, fork).blobs, changed.blobs)

  const daily = structuredClone(edited)
  daily.territories.timing = 'daily'
  for (const day of [2, 3]) {
    assert.deepEqual(new Set(dawn(daily, day, fork).blobs.filter(blob => blob.species === 'blue').map(startingEdge)), new Set(['bottom']))
  }
})

test('forecasts and direct simulation agree across a change in territories', () => {
  const setup = field()
  const changed = structuredClone(setup)
  changed.territories = { ...changed.territories, timing: 'daily', edges: ['bottom'] }
  const revisions = [{ day: 1, setup }, { day: 3, setup: changed }]
  let checkpoint = founders(setup)
  const prediction = simulateForecast({ setup: changed, revisions, checkpoint, start: 0, end: 2, target: 6 })
  const summaries = []
  for (let day = 1; day <= 6; day++) {
    assert.ok(checkpoint.roster.length)
    const board = dawnForRun(changed, revisions, day, checkpoint)
    const result = finish(board, rulesFor(changed, revisions, day))
    if (day > 2) summaries.push(result.summary)
    checkpoint = result.checkpoint
  }
  assert.deepEqual(prediction, { summaries, through: 6, checkpoint })
})

test('territory settings reject empty, repeated, and unknown edges and non-integer bands', () => {
  const setup = field()
  assert.deepEqual(validate(setup), {})
  for (const edges of [[], ['top', 'top'], ['north']]) {
    setup.territories.edges = edges
    assert.ok(validate(setup)['territories.edges'])
  }
  setup.territories.edges = ['left']
  setup.territories.center = 100.5
  setup.species[1].territory.width = 4
  assert.deepEqual(Object.keys(validate(setup)), ['territories.center', 'orange.territory.width'])
})
