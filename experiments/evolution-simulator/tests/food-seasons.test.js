import assert from 'node:assert/strict'
import test from 'node:test'
import { foodSupplyForDay, plantsForDay, PRECISE_THRESHOLDS_RULE_VERSION, rulesFor, starter, validate } from '../src/engine/config.js'
import { openingHabitat } from '../src/engine/habitat.js'
import { dawnForRun, founders, step } from '../src/engine/simulation.js'
import { setupFromLink, setupLink } from '../src/export.js'
import { simulateForecast } from '../src/forecast.js'

function seasonalSetup(season = {}, fields = {}) {
  const setup = { ...starter(), food: 80, ...fields }
  Object.assign(setup.foodSeasons, { enabled: true, ...season })
  return setup
}

test('food seasons follow asymmetric half-cosines and wrap before the first peak', () => {
  const setup = seasonalSetup()
  for (const [day, count, phase] of [
    [1, 120, 'Peak'], [3, 80, 'Falling'], [5, 40, 'Leanest'], [9, 80, 'Recovering'], [13, 120, 'Peak'],
  ]) {
    assert.equal(plantsForDay(setup, day), count)
    assert.equal(foodSupplyForDay(setup, day).phase, phase)
    assert.equal(openingHabitat(setup, day).plants.length, count)
  }
  assert.ok(Math.abs(foodSupplyForDay(setup, 2).multiplier - (100 + 25 * Math.SQRT2)) < 1e-12)
  setup.foodSeasons.peakDay = 5
  assert.equal(foodSupplyForDay(setup, 1).phase, 'Recovering')
  assert.equal(plantsForDay(setup, 1), 80)
  assert.equal(plantsForDay(setup, 5), 120)
  assert.equal(plantsForDay(setup, 9), 40)

  setup.foodSeasons = { ...setup.foodSeasons, decline: 1, recovery: 1, peakDay: 2 }
  assert.deepEqual([1, 2, 3, 4].map(day => plantsForDay(setup, day)), [40, 120, 40, 120])
})

test('apply seasons after rounding the base schedule, then round and limit the dawn supply', () => {
  const setup = seasonalSetup({ peakDay: 2 }, { food: 18, scheduleMode: 'ramp', schedule: [{ day: 3, food: 19 }] })
  assert.equal(foodSupplyForDay(setup, 2).base, 19)
  assert.equal(plantsForDay(setup, 2), 29)
  setup.scheduleMode = 'step'
  assert.equal(plantsForDay(setup, 2), 27)
  setup.scheduleMode = 'constant'
  assert.equal(plantsForDay(setup, 2), 27)

  const thirds = seasonalSetup({ decline: 3, recovery: 3 }, { food: 50 })
  assert.equal(plantsForDay(thirds, 2), 63)
  assert.equal(plantsForDay(thirds, 6), 63)

  const limited = seasonalSetup({ peak: 200, lean: 0 }, { food: 600 })
  assert.equal(foodSupplyForDay(limited, 1).limit, 1000)
  assert.equal(foodSupplyForDay(limited, 5).limit, 10)
  assert.equal(plantsForDay(limited, 1), 1000)
  assert.equal(plantsForDay(limited, 5), 10)
  limited.food = 500
  assert.equal(foodSupplyForDay(limited, 1).limit, null)
})

test('food-season validation keeps valid parked settings and checks an enabled peak day against both legs', () => {
  const setup = seasonalSetup({ peakDay: 12 })
  assert.deepEqual(validate(setup), {})
  setup.foodSeasons.decline = 3
  assert.match(validate(setup)['foodSeasons.peakDay'], /from 1 to 11/)
  assert.equal(setup.foodSeasons.peakDay, 12)
  setup.foodSeasons.enabled = false
  assert.deepEqual(validate(setup), {})
  setup.foodSeasons.enabled = true
  for (const [key, value] of [['peak', 200.1], ['lean', -1], ['decline', 0], ['recovery', 101]]) {
    const previous = setup.foodSeasons[key]
    setup.foodSeasons[key] = value
    assert.ok(validate(setup)['foodSeasons.' + key])
    setup.foodSeasons[key] = previous
  }
})

function settlements(setup, revisions, limit) {
  let checkpoint = founders(rulesFor(setup, revisions, 1))
  return Array.from({ length: limit }, (_, index) => {
    const day = index + 1
    const rules = rulesFor(setup, revisions, day)
    const board = dawnForRun(setup, revisions, day, checkpoint)
    let result
    while (!(result = step(board, rules, 1))) {}
    checkpoint = result.checkpoint
    return result.summary
  })
}

test('off and neutral seasons preserve older behavior, and forks and forecasts use the correct days', () => {
  const fields = { seed: 118, food: 500, predation: false, endMode: 'timed', duration: 100, foodPlacement: 'patches' }
  const original = { ...starter(PRECISE_THRESHOLDS_RULE_VERSION), ...fields }
  const off = seasonalSetup({ enabled: false, peakDay: 5 }, fields)
  const neutral = seasonalSetup({ peak: 100, lean: 100 }, fields)
  const oldDays = settlements(original, [], 8)
  for (const config of [off, neutral]) {
    assert.deepEqual(openingHabitat(config, 3), openingHabitat(original, 3))
    assert.deepEqual(settlements(config, [], 8), oldDays)
  }

  const revised = seasonalSetup({ peakDay: 4 }, fields)
  const unrelated = { ...revised, name: 'Seasonal branch' }
  const revisions = [{ day: 1, setup: original }, { day: 4, setup: revised }, { day: 6, setup: unrelated }]
  assert.deepEqual(validate(revised), {})
  const recorded = settlements(revised, revisions, 8)
  assert.deepEqual(recorded.slice(0, 3), oldDays.slice(0, 3))
  assert.deepEqual(recorded.slice(3).map(day => day.rows.all.food), [750, 677, 500, 323, 250])
  const forecast = simulateForecast({ setup: revised, revisions, checkpoint: founders(original), start: 0, end: 3, target: 8 })
  assert.deepEqual(forecast.summaries, recorded.slice(3))
})

test('food seasons round-trip in compact setup links with enabled and parked values', t => {
  Object.defineProperty(globalThis, 'location', {
    value: new URL('https://example.test/experiments/evolution-simulator/'), configurable: true,
  })
  t.after(() => { delete globalThis.location })
  for (const config of [starter(), seasonalSetup({ peak: 187, lean: 37, decline: 5, recovery: 6, peakDay: 10 }),
    seasonalSetup({ enabled: false, peak: 160, peakDay: 7 }), starter(PRECISE_THRESHOLDS_RULE_VERSION)]) {
    const link = setupLink(config)
    assert.ok(link)
    assert.deepEqual(setupFromLink(new URL(link).hash), config)
  }
})
