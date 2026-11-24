import assert from 'node:assert/strict'
import test from 'node:test'
import { starter } from '../src/engine/config.js'
import { applySpeciesAction, applyTraitAdjustment, dawnForRun, founders, snapshot, step } from '../src/engine/simulation.js'
import { newSpecies, runSpecies, speciesActionIssue, splitSample, validSpeciesHistory } from '../src/engine/species-actions.js'
import { csv } from '../src/export.js'
import { simulateForecast } from '../src/forecast.js'

function experiment() {
  const setup = starter()
  Object.assign(setup, { endMode: 'timed', mode: 'live', duration: 100, food: 100 })
  setup.species[0].aging = { ...setup.aging }
  return setup
}

test('creating and duplicating species uses unique identities and independent inherited settings', () => {
  const setup = experiment(), source = setup.species[0]
  const copy = newSpecies(setup.species, setup.version, source)
  assert.notEqual(copy.id, source.id)
  assert.notEqual(copy.color, source.color)
  assert.deepEqual(copy.aging, source.aging)
  copy.mutation.speed = false
  copy.inheritance.mutationChance.speed = 12
  assert.equal(source.mutation.speed, true)
  assert.equal(source.inheritance.mutationChance.speed, 100)
  assert.equal(newSpecies([...setup.species, copy], setup.version, null, 'Wide sight').sense, 40)
})

test('live species edits preserve identity and catch up identically in scheduled runs and forecasts', () => {
  const setup = experiment(), initial = founders(setup)
  const field = dawnForRun(setup, [], 1, initial)
  step(field, setup, 2)
  const tick = field.tick
  const guest = { ...newSpecies(setup.species, setup.version, null, 'Fast'), name: 'Mint' }
  const introduced = { kind: 'introduce', id: guest.id, day: 1, tick, order: 1,
    definition: guest, count: 1, creatureIds: [initial.nextId] }
  assert.equal(speciesActionIssue({ ...introduced, count: 1001 }, setup, field.blobs), 'Introduce 1–1,000 blobs.')
  assert.equal(applySpeciesAction(field, setup, introduced), '')
  assert.deepEqual(field.blobs.at(-1).parent, null)

  const living = field.blobs.filter(blob => blob.alive && blob.species === 'blue')
  const sample = splitSample(living, 2, setup.seed, 1, tick)
  assert.deepEqual(splitSample([...living].reverse(), 2, setup.seed, 1, tick), sample)
  const split = { ...newSpecies([...setup.species, guest], setup.version, setup.species[0]), name: 'Teal' }
  const transfer = { kind: 'split', id: split.id, sourceId: 'blue', day: 1, tick, order: 2,
    definition: split, creatureIds: sample.map(blob => blob.id) }
  const before = sample.map(blob => ({ ...blob }))
  assert.equal(applySpeciesAction(field, setup, transfer), '')
  for (const [index, blob] of sample.entries()) {
    const keys = ['id', 'x', 'y', 'age', 'energy', 'credits', 'parent', 'speed', 'size', 'sense']
    assert.deepEqual(keys.map(key => blob[key]), keys.map(key => before[index][key]))
    assert.equal(blob.species, split.id)
  }

  const adjustment = { day: 1, tick, order: 3, changes: { speed: 2.5, size: 0, sense: 0 }, creatureIds: transfer.creatureIds }
  assert.equal(applyTraitAdjustment(field, setup, adjustment.changes, adjustment.creatureIds), 2)
  const renamed = { kind: 'edit', id: split.id, day: 1, tick, order: 4,
    identity: { name: 'Jade', color: split.color }, creatureIds: transfer.creatureIds,
    traits: { mode: 'set', values: { speed: 14, sense: 0 } } }
  assert.equal(applySpeciesAction(field, setup, renamed), '')
  assert.ok(sample.every(blob => blob.speed === 14 && blob.sense === 0))
  const actions = [introduced, transfer, renamed]
  assert.ok(validSpeciesHistory(setup, [], JSON.parse(JSON.stringify(actions))))
  assert.ok(!validSpeciesHistory(setup, [], [introduced, { ...transfer, creatureIds: [-1] }]))
  assert.ok(!validSpeciesHistory(setup, [], [introduced, { ...renamed, identity: { speed: 45 } }]))
  const run = { id: 'live-species', setup, revisions: [], speciesActions: actions }
  assert.equal(runSpecies(run, 1, tick - 1).some(item => item.id === guest.id), false)
  assert.equal(runSpecies(run, 1, tick).find(item => item.id === split.id).name, 'Jade')

  const playback = dawnForRun(setup, [], 1, initial, [adjustment], actions)
  step(playback, setup, tick)
  assert.deepEqual(snapshot(playback), snapshot(field))
  const live = step(field, setup, 1000)
  assert.deepEqual(step(playback, setup, 1000, true), live)
  const forecast = simulateForecast({ setup, revisions: [], start: 0, end: 0, target: 1, checkpoint: initial,
    traitAdjustments: [adjustment], speciesActions: actions })
  assert.deepEqual(forecast.summaries, [live.summary])
  assert.deepEqual(forecast.checkpoint, live.checkpoint)
  const rows = live.summary.rows
  assert.equal(rows.all.introduced, 1)
  assert.equal(rows.all.transferredIn, 0)
  assert.equal(rows.blue.transferredOut, 2)
  assert.equal(rows[split.id].transferredIn, 2)
  for (const row of Object.values(rows)) assert.equal(row.net, row.population - row.opening)
  const branch = { ...setup, food: 150 }
  assert.doesNotThrow(() => dawnForRun(branch, [{ day: 1, setup }, { day: 2, setup: branch }], 2, live.checkpoint))
  assert.equal(live.checkpoint.speciesEdits[split.id].name, 'Jade')
  const output = csv({ ...run, summaries: [live.summary] }, '*')
  assert.match(output, /"species_name","species_color","introduced","transferredIn","transferredOut"/)
  assert.match(output, /"Jade"/)
})
