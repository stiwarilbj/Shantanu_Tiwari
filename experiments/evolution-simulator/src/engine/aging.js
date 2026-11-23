import { AGING_DEFAULTS, usesAgingRules } from './config.js'

export function agingRules(config, species) {
  if (!usesAgingRules(config)) return AGING_DEFAULTS
  return species?.aging ?? config.aging ?? AGING_DEFAULTS
}

export function lifespanReached(rules, age) {
  return rules.enabled && rules.maxAge > 0 && age >= rules.maxAge
}

export function oldAgeRisk(rules, age) {
  if (!rules.enabled) return 0
  if (lifespanReached(rules, age)) return 100
  return Math.min(100, Math.max(0, age - rules.onsetAge) * rules.riskIncrease)
}

export function travelSpeedPercent(rules, age) {
  if (!rules.enabled) return 100
  return Math.max(rules.speedFloor, 100 - Math.max(0, age - rules.onsetAge) * rules.speedLoss)
}
