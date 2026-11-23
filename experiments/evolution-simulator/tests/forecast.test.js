import assert from 'node:assert/strict'
import test from 'node:test'
import { REPRODUCTION_RULE_VERSION, REFUGE_RULE_VERSION, rulesFor, setupForNewRun, starter } from '../src/engine/config.js'
import { dawn, founders, step } from '../src/engine/simulation.js'
import { openingSummary, openingTrends } from '../src/engine/stats.js'
import { forecastCheckpoint, forecastEndpoint, simulateForecast } from '../src/forecast.js'

function record(setup, revisions, limit) {
  let latest = founders(setup)
  const checkpoints = [{ day: 0, ...latest }]
  const summaries = []
  for (let day = 1; day <= limit && latest.roster.length; day++) {
    const rules = rulesFor(setup, revisions, day)
    const state = dawn(rules, day, latest)
    let result
    while (!(result = step(state, rules, 1))) {}
    latest = result.checkpoint
    summaries.push(result.summary)
    if (day % 10 === 0) checkpoints.push({ day, ...latest })
  }
  return { setup, revisions, latest, checkpoints, summaries }
}

function preview(run, end, count, checkpoint = forecastCheckpoint(run, end)) {
  return simulateForecast({ setup: run.setup, revisions: run.revisions,
    start: checkpoint.day, checkpoint, end, target: end + count })
}

test('requires three consecutive observed days at the visible endpoint', () => {
  const endpoint = (...days) => forecastEndpoint(days.map(day => ({ day })))
  assert.equal(endpoint(1, 2), null)
  assert.equal(endpoint(1, 2, 4, 5), null)
  assert.equal(endpoint(4, 5, 6), 6)
})

test('a historical forecast reproduces the exact later dawn and dusk stats across a rules change', async () => {
  const setup = { ...starter(REPRODUCTION_RULE_VERSION), seed:118, food:500, days:10,
    endMode:'timed', duration:200, foraging:'walkthrough' }
  const branch = { ...setup, scheduleMode:'step', schedule:[{ day:5, food:700 }, { day:7, food:600 }],
    foodPlacement:'patches', patchCount:8, patchRadius:90, patchRelocation:'interval', patchInterval:2,
    reproduction:{ parentMode:'single', birthChance:70, twinChance:20 },
    species:setup.species.map(species => ({ ...species, inheritance:{
      mutationPattern:'bounded', mutationChance:{ speed:50, size:80, sense:20 },
    } })),
  }
  const revisions = [{ day:1, setup }, { day:5, setup:branch }]
  const full = record(setup, revisions, 12)
  const early = record(setup, revisions, 4)
  assert.equal(forecastCheckpoint(full, 4).day, 0)
  const copyBefore = structuredClone(early)

  const fromHistory = await preview(full, 4, 8)
  const fromLatest = await preview(early, 4, 8)
  assert.deepEqual(fromHistory, fromLatest)
  assert.equal(fromLatest.through, 12)
  assert.deepEqual(fromLatest.summaries, full.summaries.slice(4))
  assert.notEqual(fromLatest.summaries[0].rows.all.food, early.summaries.at(-1).rows.all.food)
  assert.deepEqual(early, copyBefore)

  const futureDawn = fromLatest.summaries.map((summary, index) =>
    openingSummary(summary, (fromLatest.summaries[index - 1] ?? early.summaries.at(-1)).rows))
  assert.deepEqual(futureDawn, openingTrends(full).slice(4))
})

test('keeps the extinction generation and stops there without inventing trait samples', async () => {
  const setup = { ...starter(REFUGE_RULE_VERSION), seed:6, food:10, days:10 }
  const run = record(setup, [], 3)
  const actual = record(setup, [], 10)
  const projected = await preview(run, 3, 25)
  assert.equal(projected.through, 4)
  assert.deepEqual(projected.summaries, actual.summaries.slice(3))
  assert.equal(projected.summaries[0].rows.all.population, 0)
  assert.equal(projected.summaries[0].rows.all.speed.mean, null)
  assert.deepEqual((await preview(actual, 4, 5)).summaries, [])
})

test('predictions cross an aging revision and match subsequent generations', async () => {
  const setup = { ...starter(REPRODUCTION_RULE_VERSION), seed:118, food:500, predation:false, days:10,
    endMode:'timed', duration:100 }
  const revised = setupForNewRun(setup)
  Object.assign(revised.aging, { enabled:true, onsetAge:1, riskIncrease:0, speedLoss:10, maxAge:4 })
  const revisions = [{ day:1, setup }, { day:4, setup:revised }]
  const current = record(setup, revisions, 3)
  const full = record(setup, revisions, 8)
  const forecast = await preview(current, 3, 5)
  assert.ok(forecast.summaries[0].rows.all.causes['Old age'] > 0)
  assert.deepEqual(forecast.summaries, full.summaries.slice(3))
  assert.deepEqual(await preview(full, 3, 5), forecast)
})
