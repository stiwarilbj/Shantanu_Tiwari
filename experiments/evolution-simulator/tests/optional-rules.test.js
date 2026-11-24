import assert from 'node:assert/strict'
import test from 'node:test'
import { oldAgeRisk } from '../src/engine/aging.js'
import { FOOD_SEASONS_RULE_VERSION, FORAGING_DEFAULTS, starter, TERRITORY_RULE_VERSION, validate } from '../src/engine/config.js'
import { dawn, dusk, founders, step } from '../src/engine/simulation.js'

test('default optional rules preserve version 11 outcomes in both foraging modes', () => {
  const run = rules => {
    const days = []
    let checkpoint = founders(rules)
    for (let day = 1; day <= 5 && checkpoint.roster.length; day++) {
      const board = dawn(rules, day, checkpoint)
      while (!board.settled) step(board, rules, 20, true)
      days.push(board.settled)
      checkpoint = board.settled.checkpoint
    }
    return days
  }
  for (const foraging of [undefined, 'walkthrough']) {
    const config = { ...starter(FOOD_SEASONS_RULE_VERSION), seed: 118, food: 250, plantReward: 25, foraging }
    const legacy = { ...config, version: TERRITORY_RULE_VERSION }
    const expected = run(legacy)
    assert.equal(expected.length, 5)
    assert.deepEqual(run(config), expected)
  }
})

test('turning off meal refills and breeding lets blobs eat and survive without energy bonuses or births', () => {
  const rules = starter()
  rules.plantReward = 30
  rules.reproduction.parentMode = 'pair'
  const foundersAtDawn = founders(rules)
  foundersAtDawn.roster = foundersAtDawn.roster.slice(0, 2)

  for (const [enabled, version] of [[false, rules.version], [true, rules.version], [true, TERRITORY_RULE_VERSION]]) {
    const config = { ...rules, version, advanced: { ...rules.advanced,
      mealRefills: version === rules.version && enabled, breeding: version === rules.version && enabled,
    } }
    const board = dawn(config, 1, foundersAtDawn)
    board.plants = [{ id: 0, x: 100, y: 100, eaten: false }]
    Object.assign(board.blobs[0], { x: 100, y: 100 })
    Object.assign(board.blobs[1], { x: 300, y: 300 })
    step(board, config)
    const meal = board.events.find(event => event.type === 'plant')
    assert.ok(meal)
    assert.equal(board.blobs[0].credits, 1)
    assert.equal(meal.energy, Math.min(board.blobs[0].capacity, meal.beforeEnergy + (enabled ? 30 : 0)))
    for (const blob of board.blobs) Object.assign(blob, { home: true, credits: 2 })
    const day = dusk(board, config)
    assert.equal(day.summary.rows.all.births, enabled ? 1 : 0)
    assert.equal(day.checkpoint.roster.length, enabled ? 3 : 2)
  }
})

test('inactive settings stay stored and become subject to validation when enabled', () => {
  const rules = starter()
  rules.advanced.customForaging = false
  rules.advanced.mealRefills = false
  rules.advanced.breeding = false
  rules.plantReward = 1200
  rules.reproduction.birthChance = 105
  rules.foragingDecisions.plantMemory = 2
  rules.species[0].foragingDecisions = { ...FORAGING_DEFAULTS, switchSavings: 101 }
  rules.species[0].standardDeviation.speed = 11
  rules.territories.edges = []
  Object.assign(rules.aging, { enabled: true, riskIncrease: 0, maxAge: 5, maxAgeEnabled: false })
  assert.deepEqual(validate(rules), {})
  assert.equal(oldAgeRisk(rules.aging, 6), 0)
  assert.equal(rules.aging.maxAge, 5)
  assert.deepEqual(dawn(rules, 1, founders(rules)).blobs[0].foragingSettings, FORAGING_DEFAULTS)

  rules.advanced.customForaging = true
  rules.advanced.mealRefills = true
  rules.advanced.breeding = true
  rules.territories.enabled = true
  delete rules.aging.maxAgeEnabled
  assert.equal(oldAgeRisk(rules.aging, 6), 100)
  assert.deepEqual(Object.keys(validate(rules)), [
    'plantReward', 'birthChance', 'territories.edges', 'blue.foragingDecisions.switchSavings', 'blue.standardDeviation.speed',
  ])
  rules.species[0].mutation.speed = false
  assert.equal(validate(rules)['blue.standardDeviation.speed'], undefined)
  assert.equal(rules.species[0].standardDeviation.speed, 11)
})

test('a zero mutation chance keeps its unused pattern and spread without blocking a run', () => {
  const config = starter()
  const blue = config.species[0]
  Object.assign(blue.mutation, { size: false, sense: false })
  blue.inheritance.mutationChance.speed = 0
  blue.inheritance.mutationPattern = 'future-pattern'
  blue.standardDeviation.speed = 11
  assert.deepEqual(validate(config), {})
  const checkpoint = founders(config)
  checkpoint.roster = checkpoint.roster.slice(0, 1)
  const board = dawn(config, 1, checkpoint)
  Object.assign(board.blobs[0], { home: true, credits: 2 })
  const result = dusk(board, config)
  assert.equal(result.summary.rows.all.births, 1)
  assert.equal(result.checkpoint.roster[1].speed, blue.speed)

  blue.inheritance.mutationChance.speed = 1
  assert.deepEqual(Object.keys(validate(config)), ['blue.mutationPattern', 'blue.standardDeviation.speed'])
  blue.inheritance.mutationChance.speed = -1
  assert.ok(validate(config)['blue.mutationChance.speed'])
})

test('a zero birth chance ignores unused reproduction and mutation values', () => {
  const config = starter()
  Object.assign(config.reproduction, { birthChance: 0, twinChance: 101, birthWait: 32 })
  config.species[0].inheritance.mutationChance.speed = 101
  assert.deepEqual(validate(config), {})
  const checkpoint = founders(config)
  checkpoint.roster = checkpoint.roster.slice(0, 1)
  const board = dawn(config, 1, checkpoint)
  Object.assign(board.blobs[0], { home: true, credits: 2 })
  assert.equal(dusk(board, config).summary.rows.all.births, 0)

  config.reproduction.birthChance = 1
  assert.deepEqual(Object.keys(validate(config)), ['birthWait', 'twinChance', 'blue.mutationChance.speed'])
})
