import { PALETTE, TRAITS, rulesFor, speciesTemplate, validate } from './config.js'
import { random } from './random.js'
import { adjustedTrait, validTraitChange } from './trait-adjustments.js'

export const SPECIES_PRESETS = {
  Balanced: { speed: 10, size: 10, sense: 20 },
  Fast: { speed: 16, size: 10, sense: 20 },
  Sturdy: { speed: 10, size: 16, sense: 20 },
  'Wide sight': { speed: 10, size: 10, sense: 40 },
}
export const SPECIES_TRAIT_LABELS = { speed: 'Speed', size: 'Size', sense: 'Sense Range' }

export function newSpecies(species, version, source, preset = 'Balanced') {
  const id = crypto.randomUUID()
  const used = new Set(species.map(item => item.color.toLowerCase()))
  let color = PALETTE.find(value => !used.has(value.toLowerCase()))
  for (let i = 1; !color; i++) {
    const candidate = '#' + ((i * 2654435761) >>> 8).toString(16).padStart(6, '0')
    if (!used.has(candidate)) color = candidate
  }
  const stem = source ? source.name.slice(0, 21) + ' copy' : 'Species'
  let name = source ? stem : stem + ' ' + (species.length + 1)
  for (let i = 2; species.some(item => item.name.trim().toLowerCase() === name.toLowerCase()); i++) name = stem + ' ' + i
  return source ? { ...JSON.parse(JSON.stringify(source)), id, name, color } :
    { ...speciesTemplate(id, name, color, 10, true, version), ...SPECIES_PRESETS[preset] }
}

export function speciesWithEdits(species, edits) {
  if (!edits || !Object.keys(edits).length) return species
  return [
    ...species.map(item => Object.hasOwn(edits, item.id) ? { ...item, ...edits[item.id] } : item),
    ...Object.values(edits).filter(item => item.id && !species.some(base => base.id === item.id)),
  ]
}

export function speciesEditsAfter(edits, action) {
  return { ...edits, [action.id]: action.definition ?? { ...edits?.[action.id], ...action.identity } }
}

export function runSpecies(run, day = Infinity, tick = Infinity) {
  const base = rulesFor(run.setup, run.revisions ?? [], day).species
  let edits
  for (const action of run.speciesActions ?? []) {
    if (action.day > day || (action.day === day && action.tick > tick)) break
    edits = speciesEditsAfter(edits, action)
  }
  return speciesWithEdits(base, edits)
}

export function splitSample(blobs, count, seed, day, tick) {
  return blobs.map(blob => ({ blob, key: random(seed, 53, day, tick, blob.id) }))
    .sort((a, b) => a.key - b.key || a.blob.id - b.blob.id)
    .slice(0, count).map(item => item.blob)
}

export function speciesTraitValue(blob, trait, change, rules) {
  if (!change || !Object.hasOwn(change.values, trait)) return blob[trait]
  return change.mode === 'set' ? change.values[trait] : adjustedTrait(blob, trait, change.values[trait], rules)
}

function validTraitEdit(edit) {
  if (edit == null) return true
  if (!['set', 'adjust'].includes(edit.mode) || !edit.values || !Object.keys(edit.values).length) return false
  return Object.entries(edit.values).every(([key, value]) => TRAITS.includes(key) && validTraitChange(value) &&
    (edit.mode !== 'set' || value >= (key === 'sense' ? 0 : 0.01)))
}

export function speciesActionIssue(action, rules, blobs) {
  const { kind, id, definition, identity, sourceId, creatureIds, count, traits } = action
  const existing = rules.species.find(item => item.id === id)
  const editing = kind === 'edit'
  if (!id || typeof id !== 'string' || ['all', '__proto__', 'constructor', 'prototype'].includes(id) ||
      !['edit', 'split', 'introduce'].includes(kind) || editing !== !!existing) return 'Choose a valid species.'
  if (editing && (!identity || definition != null || Object.keys(identity).some(key => !['name', 'color'].includes(key)))) {
    return 'Choose a valid name and color.'
  }
  const candidate = editing ? { ...existing, ...identity } : definition
  if (typeof candidate?.name !== 'string' || candidate.id !== id) return 'Enter a species name.'
  const name = candidate.name.trim().toLowerCase()
  if (!name || name.length > 30 || rules.species.some(item => item.id !== id && item.name.trim().toLowerCase() === name)) {
    return 'Enter a unique species name with 1–30 characters.'
  }
  const color = typeof candidate.color === 'string' ? candidate.color.toLowerCase() : ''
  if (!/^#[0-9a-f]{6}$/.test(color) || rules.species.some(item => item.id !== id && item.color.toLowerCase() === color)) {
    return 'Choose a distinct color.'
  }
  if (!editing) {
    const checked = { ...rules, species: [candidate] }
    if (Object.keys(validate(checked)).some(key => key === 'species' || key.startsWith(id + '.'))) {
      return 'Check the new species’ traits, energy, and inherited rules.'
    }
  }
  if (!validTraitEdit(traits)) return 'Enter valid trait values.'
  if (kind === 'introduce') {
    if (traits || !Number.isInteger(count) || count < 1 || count > 1000) return 'Introduce 1–1,000 blobs.'
    return ''
  }
  if (!Array.isArray(creatureIds) || new Set(creatureIds).size !== creatureIds.length ||
      creatureIds.some(value => !Number.isSafeInteger(value) || value < 1)) return 'Choose valid living blobs.'
  if (kind === 'split' && (!creatureIds.length || !rules.species.some(item => item.id === sourceId && item.enabled))) {
    return 'Choose at least one living blob from the source species.'
  }
  if (blobs) {
    const actual = blobs.filter(blob => blob.alive && blob.species === (editing ? id : sourceId))
    const ids = new Set(actual.map(blob => blob.id))
    if (creatureIds.some(value => !ids.has(value)) || (editing && actual.length !== creatureIds.length)) {
      return 'The living group has changed. Check the preview and try again.'
    }
    if (editing && candidate.name === existing.name && candidate.color === existing.color &&
        !actual.some(blob => TRAITS.some(trait => speciesTraitValue(blob, trait, traits, rules) !== blob[trait]))) {
      return 'Change the name, color, or a living trait.'
    }
  }
  return ''
}

export function validSpeciesHistory(setup, revisions, actions) {
  if (!Array.isArray(actions)) return false
  let edits
  let previous = { day: 0, tick: 0, order: 0 }
  for (const action of actions) {
    if (!action || !Number.isInteger(action.day) || action.day < 1 || action.day > setup.days ||
        !Number.isInteger(action.tick) || action.tick < 0 || action.tick >= 1_000_000 ||
        !Number.isSafeInteger(action.order) || action.order <= previous.order ||
        action.day < previous.day || (action.day === previous.day && action.tick < previous.tick)) return false
    const base = rulesFor(setup, revisions, action.day)
    if (action.kind === 'introduce' && (!Array.isArray(action.creatureIds) ||
        action.creatureIds.length !== action.count ||
        action.creatureIds.some((id, index) => !Number.isSafeInteger(id) || id < 1 || id !== action.creatureIds[0] + index))) return false
    if (speciesActionIssue(action, { ...base, species: speciesWithEdits(base.species, edits) })) return false
    edits = speciesEditsAfter(edits, action)
    previous = action
  }
  return true
}
