import assert from 'node:assert/strict'
import test from 'node:test'
import { agingRules, oldAgeRisk, travelSpeedPercent } from '../src/engine/aging.js'
import { AGING_DEFAULTS, AGING_RULE_VERSION, REPRODUCTION_RULE_VERSION, setupForNewRun, starter, validate } from '../src/engine/config.js'
import { random } from '../src/engine/random.js'
import { dawn, dusk, founders, snapshot, step } from '../src/engine/simulation.js'
import { csv } from '../src/export.js'

test('aging starts after the onset and respects both the speed floor and the lifespan cap', () => {
  const setup = starter()
  Object.assign(setup.aging, { enabled:true, maxAge:30 })
  const [blue, orange] = setup.species
  orange.aging = { ...AGING_DEFAULTS }
  const rules = agingRules(setup, blue)
  assert.equal(oldAgeRisk(rules, 4), 0)
  assert.equal(oldAgeRisk(rules, 5), 5)
  assert.equal(oldAgeRisk(rules, 30), 100)
  assert.equal(travelSpeedPercent(rules, 8), 80)
  assert.equal(travelSpeedPercent(rules, 23), 50)
  assert.equal(oldAgeRisk(agingRules(setup, orange), 30), 0)
  assert.equal(travelSpeedPercent(agingRules(setup, orange), 30), 100)
  assert.deepEqual(validate(setup), {})
  setup.aging.riskIncrease = 2.15
  orange.aging.speedFloor = 9
  orange.aging.maxAge = 0
  assert.deepEqual(Object.keys(validate(setup)), ['aging.riskIncrease'])
  orange.aging.enabled = true
  assert.deepEqual(Object.keys(validate(setup)), ['aging.riskIncrease', 'orange.aging.speedFloor', 'orange.aging.maxAge'])
})

test('natural deaths take priority and lifespan is checked before breeding', () => {
  const setup = starter()
  Object.assign(setup.aging, { enabled:true, riskIncrease:0, maxAge:5 })
  const [, orange] = setup.species
  orange.enabled = true
  orange.aging = { ...AGING_DEFAULTS }
  const initial = founders(setup)
  const roster = [...initial.roster.slice(0, 3), initial.roster[50]]
  const [capped, parent, unfed, exempt] = roster
  for (const blob of roster) blob.age = blob === parent ? 3 : 4
  const state = dawn(setup, 5, { roster, nextId:initial.nextId })
  for (const blob of state.blobs) Object.assign(blob, { home:true, credits:blob.id === unfed.id ? 0 : 2 })
  const result = dusk(state, setup)
  assert.deepEqual(state.events.filter(event => event.type === 'death').map(({ id, age, cause }) => [id, age, cause]), [
    [capped.id, 5, 'Old age'], [unfed.id, 4, 'Starvation'],
  ])
  const [birth, exemptBirth] = state.events.filter(event => event.type === 'birth')
  assert.deepEqual([birth.parent, birth.age, exemptBirth.parent, exemptBirth.age], [parent.id, 0, exempt.id, 0])
  assert.equal(result.summary.rows.blue.causes['Old age'], 1)
  assert.equal(result.summary.rows.orange.causes['Old age'], 0)
  assert.equal(result.summary.rows.all.causes['Old age'], 1)
  assert.equal(result.checkpoint.roster.find(blob => blob.id === parent.id).age, 4)
  const newborn = result.checkpoint.roster.find(blob => blob.id === birth.id)
  setup.aging.maxAge = 1
  const next = dawn(setup, 6, { ...result.checkpoint, roster:[newborn] })
  Object.assign(next.blobs[0], { home:true, credits:1 })
  assert.equal(dusk(next, setup).summary.rows.blue.causes['Old age'], 1)
})

test('the dusk roll is seeded by generation and creature rather than roster order', () => {
  const setup = starter()
  Object.assign(setup.aging, { enabled:true, onsetAge:0, riskIncrease:12.5 })
  const initial = founders(setup)
  const roster = initial.roster.map(blob => ({ ...blob, age:3 }))
  const day = 7
  function deaths(opening) {
    const state = dawn(setup, day, { ...initial, roster:opening })
    for (const blob of state.blobs) Object.assign(blob, { home:true, credits:1 })
    dusk(state, setup)
    return state.events.filter(event => event.cause === 'Old age').map(event => event.id).sort((a, b) => a - b)
  }
  const expected = roster.filter(blob => random(setup.seed, 49, day, blob.id) < 0.5).map(blob => blob.id)
  assert.ok(expected.length > 0 && expected.length < roster.length)
  assert.deepEqual(deaths(roster), expected)
  assert.deepEqual(deaths(roster.slice().reverse()), expected)
})

test('aging slows movement at the same energy cost in both foraging modes', () => {
  for (const foraging of [undefined, 'walkthrough']) {
    const setup = { ...starter(), foraging, predation:false }
    const initial = founders(setup)
    initial.roster = [{ ...initial.roster[0], age:8, sense:0 }]
    const aging = { ...setup, aging:{ ...setup.aging, enabled:true } }
    const normal = dawn(setup, 9, initial)
    const slower = dawn(aging, 9, initial)
    const [old] = slower.blobs
    const [young] = normal.blobs
    const { x, y } = old
    assert.equal(old.speedWorld, young.speedWorld * 0.8)
    assert.equal(old.rate, young.rate)
    assert.equal(old.moveCost, young.moveCost)
    step(normal, setup)
    step(slower, aging)
    const distance = blob => Math.hypot(blob.x - x, blob.y - y)
    assert.ok(distance(young) > 0)
    assert.ok(Math.abs(distance(old) - distance(young) * 0.8) < 1e-9)
    assert.equal(old.energy, young.energy)
  }
})

test('aging stays off when upgrading older runs and the CSV counts absent historical causes as zero', () => {
  for (const foraging of [undefined, 'walkthrough']) {
    const before = { ...starter(REPRODUCTION_RULE_VERSION), foraging, food:150 }
    const after = { ...setupForNewRun(before), version:AGING_RULE_VERSION }
    assert.deepEqual(after.aging, AGING_DEFAULTS)
    let checkpoint = founders(before)
    const summaries = []
    for (let day = 1; day <= 5; day++) {
      const legacy = dawn(before, day, checkpoint)
      const upgraded = dawn(after, day, checkpoint)
      const previous = step(legacy, before, Infinity, true)
      const current = step(upgraded, after, Infinity, true)
      summaries.push(previous.summary)
      for (const row of Object.values(current.summary.rows)) {
        assert.equal(row.causes['Old age'], 0)
        delete row.causes['Old age']
      }
      assert.deepEqual(current, previous)
      assert.deepEqual(snapshot(upgraded), snapshot(legacy))
      checkpoint = previous.checkpoint
    }
    const [columns, first] = csv({ id:'older', setup:before, summaries }, 'all').split('\r\n').map(row => row.split(','))
    assert.equal(first[columns.indexOf('"Old age"')], '"0"')
  }
})
