import { TRAITS, usesStandardDeviation } from './config.js'

export const MAX_TRAIT_CHANGE = 100

export function validTraitChange(value) {
  return Number.isFinite(value) && Math.abs(value) <= MAX_TRAIT_CHANGE &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
}

export function validTraitAdjustment(changes) {
  return !!changes && TRAITS.every(trait => validTraitChange(changes[trait])) &&
    TRAITS.some(trait => changes[trait] !== 0)
}

export function adjustedTrait(blob, trait, delta, rules) {
  const floor = trait === 'sense' && usesStandardDeviation(rules) ? 0 : Math.min(1, blob[trait])
  return Math.max(floor, blob[trait] + delta)
}
