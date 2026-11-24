import { advancedRuleEnabled, FORAGING_DEFAULTS, PRECISE_THRESHOLDS_RULE_VERSION, usesForagingDecisionRules, usesWalkthroughForaging, VERSION } from './config.js'

export const DECISION = Object.freeze({
  searching: 0,
  plant: 1,
  prey: 2,
  rememberedPlant: 3,
  keepMeal: 4,
  switchPlant: 5,
  switchPrey: 6,
  returnWithFood: 7,
  returnForTime: 8,
  escape: 9,
  retreat: 10,
  noSafeMeal: 11,
  forgotPlant: 12,
  pursuitLimit: 13,
  missingPlant: 14,
})

export function tracksForagingDecisions(config) {
  return usesForagingDecisionRules(config) && !usesWalkthroughForaging(config)
}

export function foragingDecisionsFor(config, species) {
  if (!tracksForagingDecisions(config) || !advancedRuleEnabled(config, 'customForaging')) return FORAGING_DEFAULTS
  return species?.foragingDecisions ?? config.foragingDecisions ?? FORAGING_DEFAULTS
}

export const remembersPlant = (elapsed, seconds) => seconds > 0 && elapsed <= seconds + 1e-9
export function keepsMeal(currentTime, bestTime, savings, version = VERSION) {
  const threshold = currentTime * ((100 - savings) / 100)
  if (bestTime >= threshold) return true
  // A computed tie can be one rounding step below the threshold.
  return version >= PRECISE_THRESHOLDS_RULE_VERSION && savings > 0 &&
    bestTime >= threshold - Number.EPSILON * threshold
}
export const returnReserve = (settings, stepSeconds) => settings.returnMargin * stepSeconds
export const shouldReturn = (left, toRefuge, reserve) => left <= toRefuge + reserve
export const shouldReturnWithoutMeal = (left, toRefuge, reserve) => left <= toRefuge + reserve + .75
export const mealFitsBudget = (toMeal, toRefuge, spendable) => toMeal + toRefuge <= spendable
export const canPursuePrey = (interceptTime, maximum) => maximum > 0 && interceptTime <= maximum
export const timeSavedPercent = (currentTime, bestTime) => currentTime ? (1 - bestTime / currentTime) * 100 : 0
