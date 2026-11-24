export const TRAITS = ['speed', 'size', 'sense']
export const PALETTE = ['#406780', '#F47E18', '#CE6591', '#80A653', '#9B7ACA', '#46A49D', '#D5A84C', '#C76052']
export const LEGACY_RULE_VERSION = 1
export const SETTLED_RULE_VERSION = 3
export const WALKTHROUGH_RULE_VERSION = 4
export const REFUGE_RULE_VERSION = 5
export const STEERING_RULE_VERSION = 6
export const HABITAT_RULE_VERSION = 7
export const REPRODUCTION_RULE_VERSION = 8
export const AGING_RULE_VERSION = 9
export const FORAGING_DECISION_RULE_VERSION = 10
export const TERRITORY_RULE_VERSION = 11
export const OPTIONAL_RULES_VERSION = 12
export const PRECISE_THRESHOLDS_RULE_VERSION = 13
export const FOOD_SEASONS_RULE_VERSION = 14
export const FOOD_WEB_RULE_VERSION = 15
export const VERSION = FOOD_WEB_RULE_VERSION
export const MAX_SEED = 0xffffffff
export const HABITAT_DEFAULTS = Object.freeze({
  foodPlacement: 'scattered',
  patchCount: 3,
  patchRadius: 30,
  patchRelocation: 'fixed',
  patchInterval: 5,
  refugePercent: 10,
  huntingAdvantage: 25,
  firstHuntingDay: 1,
})
export const FOOD_SEASON_DEFAULTS = Object.freeze({
  enabled: false, peak: 150, lean: 50, decline: 4, recovery: 8, peakDay: 1,
})
export const FOOD_SEASON_FIELDS = [
  { key: 'peak', label: 'Peak supply (%)', min: 100, max: 200 },
  { key: 'lean', label: 'Lean supply (%)', min: 0, max: 100 },
  { key: 'decline', label: 'Generations from peak to leanest', min: 1, max: 100 },
  { key: 'recovery', label: 'Generations from leanest to peak', min: 1, max: 100 },
]
export const REPRODUCTION_DEFAULTS = Object.freeze({
  parentMode: 'single',
  minimumBreedingAge: 0,
  birthWait: 0,
  birthChance: 100,
  twinChance: 0,
})
export const AGING_DEFAULTS = Object.freeze({
  enabled: false,
  onsetAge: 4,
  riskIncrease: 5,
  speedLoss: 5,
  speedFloor: 50,
  maxAge: null,
})
export const AGING_FIELDS = [
  { key: 'onsetAge', label: 'Aging starts after age', min: 0, max: 1000, step: 1 },
  { key: 'riskIncrease', label: 'Extra old-age death risk per generation', min: 0, max: 100, step: 0.1 },
  { key: 'speedLoss', label: 'Travel speed lost per generation (%)', min: 0, max: 100, step: 0.1 },
  { key: 'speedFloor', label: 'Minimum travel speed (%)', min: 10, max: 100, step: 1 },
]
export const FORAGING_DEFAULTS = Object.freeze({
  plantMemory: 0.6,
  switchSavings: 20,
  returnMargin: 2,
  preyPursuit: 1,
})
export const FORAGING_FIELDS = [
  { key: 'plantMemory', label: 'Plant memory (seconds)', min: 0, max: 3, step: 0.1 },
  { key: 'switchSavings', label: 'Time saved to switch meals (%)', min: 0, max: 100, step: 1 },
  { key: 'returnMargin', label: 'Return safety margin (steps)', min: 0, max: 20, step: 1 },
  { key: 'preyPursuit', label: 'Maximum prey pursuit (seconds)', min: 0, max: 3, step: 0.1 },
]
export const TERRITORY_EDGES = Object.freeze(['top', 'right', 'bottom', 'left'])
export const TERRITORY_DEFAULTS = Object.freeze({ edges: TERRITORY_EDGES, center: 50, width: 100 })
export const TERRITORY_FIELDS = [
  { key: 'center', label: 'Band center (%)', min: 0, max: 100 },
  { key: 'width', label: 'Band width (%)', min: 5, max: 100 },
]
export const ADVANCED_DEFAULTS = Object.freeze({ mealRefills: true, breeding: true, customForaging: true })
export const MUTATION_DEFAULTS = Object.freeze({ speed: true, size: true, sense: true })
export const INHERITANCE_DEFAULTS = Object.freeze({
  mutationPattern: 'normal',
  mutationChance: Object.freeze({ speed: 100, size: 100, sense: 100 }),
})
export const endsWhenSettled = config => config.version >= SETTLED_RULE_VERSION && config.endMode === 'settled'
export const usesStandardDeviation = config => config.version >= WALKTHROUGH_RULE_VERSION
export const usesWalkthroughForaging = config => usesStandardDeviation(config) && config.foraging === 'walkthrough'
export const usesRefugeBorder = config => config.version >= REFUGE_RULE_VERSION
export const usesImprovedSteering = config => config.version >= STEERING_RULE_VERSION && !usesWalkthroughForaging(config)
export const usesHabitatRules = config => config.version >= HABITAT_RULE_VERSION
export const usesFoodSeasonsRules = config => config.version >= FOOD_SEASONS_RULE_VERSION
export const usesReproductionRules = config => config.version >= REPRODUCTION_RULE_VERSION
export const usesAgingRules = config => config.version >= AGING_RULE_VERSION
export const usesForagingDecisionRules = config => config.version >= FORAGING_DECISION_RULE_VERSION
export const usesTerritoryRules = config => config.version >= TERRITORY_RULE_VERSION
export const usesOptionalRules = config => config.version >= OPTIONAL_RULES_VERSION
export const advancedRuleEnabled = (config, key) => !usesOptionalRules(config) || config.advanced?.[key] !== false
export const breedingCanProduceOffspring = config => advancedRuleEnabled(config, 'breeding') &&
  (!usesOptionalRules(config) || config.reproduction?.birthChance !== 0)
export const mutationEnabled = (config, species, trait) =>
  breedingCanProduceOffspring(config) && species.mutation?.[trait] === true
export const mutationProducesSpread = (config, species, trait) =>
  mutationEnabled(config, species, trait) && species.inheritance?.mutationChance?.[trait] !== 0
export const huntingOnDay = (config, day) => config.predation &&
  (!usesHabitatRules(config) || day >= config.firstHuntingDay)

export function setupWithRuleDefaults(setup) {
  if (usesOptionalRules(setup)) setup = { ...setup, advanced: { ...ADVANCED_DEFAULTS, ...setup.advanced } }
  if (usesHabitatRules(setup)) setup = { ...HABITAT_DEFAULTS, ...setup }
  if (usesFoodSeasonsRules(setup)) setup = { ...setup, foodSeasons: { ...FOOD_SEASON_DEFAULTS, ...setup.foodSeasons } }
  if (usesAgingRules(setup)) setup = { ...setup, aging: { ...AGING_DEFAULTS, ...setup.aging } }
  if (usesForagingDecisionRules(setup)) {
    setup = { ...setup, foragingDecisions: { ...FORAGING_DEFAULTS, ...setup.foragingDecisions } }
  }
  if (usesTerritoryRules(setup)) {
    setup = { ...setup, territories: { ...TERRITORY_DEFAULTS, enabled: false, timing: 'opening', ...setup.territories } }
  }
  if (!usesReproductionRules(setup)) return setup
  return {
    ...setup,
    reproduction: { ...REPRODUCTION_DEFAULTS, ...setup.reproduction },
    species: setup.species.map(item => ({
      ...item,
      ...(usesAgingRules(setup) && item.aging !== undefined && { aging: { ...AGING_DEFAULTS, ...item.aging } }),
      ...(usesForagingDecisionRules(setup) && item.foragingDecisions !== undefined && {
        foragingDecisions: { ...FORAGING_DEFAULTS, ...item.foragingDecisions },
      }),
      ...(usesTerritoryRules(setup) && item.territory !== undefined && {
        territory: { ...TERRITORY_DEFAULTS, ...item.territory },
      }),
      inheritance: {
        ...INHERITANCE_DEFAULTS, ...item.inheritance,
        mutationChance: { ...INHERITANCE_DEFAULTS.mutationChance, ...item.inheritance?.mutationChance },
      },
    })),
  }
}

export function speciesTemplate(id, name, color, count = 10, enabled = true, version = VERSION) {
  const spread = usesStandardDeviation({ version })
    ? { standardDeviation: { speed: 0.5, size: 0.5, sense: 0.5 } }
    : { variance: { speed: 0.25, size: 0.25, sense: 0.25 } }
  return { id, name, color, count, enabled, energy: 500, speed: 10, size: 10, sense: 20,
    ...spread,
    ...(usesReproductionRules({ version }) && {
      inheritance: { ...INHERITANCE_DEFAULTS, mutationChance: { ...INHERITANCE_DEFAULTS.mutationChance } },
    }),
    mutation: { ...MUTATION_DEFAULTS } }
}

export function starter(version = VERSION) {
  return setupWithRuleDefaults({
    version, name: 'Starter field', days: 50, endMode: 'settled', duration: 100, seed: 18, food: 50,
    mode: 'prepare', predation: true, sameSpecies: true, stride: 'linked', metabolism: 'walkthrough',
    plantReward: 0, preyReward: 0, schedule: [], scheduleMode: 'constant',
    species: [speciesTemplate('blue', 'Blue', PALETTE[0], 50, true, version),
      { ...speciesTemplate('orange', 'Orange', PALETTE[1], 10, false, version), sense: 50 },
      { ...speciesTemplate('pink', 'Pink', PALETTE[2], 10, false, version), speed: 9, size: 9 }]
  })
}

export function validDiet(diet, ids) {
  return !!diet && typeof diet.plants === 'boolean' && ['any', 'selected', 'none'].includes(diet.hunt) &&
    Array.isArray(diet.prey) && new Set(diet.prey).size === diet.prey.length &&
    diet.prey.every(id => typeof id === 'string' && !!id && (!ids || ids.has(id)))
}

export function validFoodWeb(web, ids) {
  return !!web && typeof web.enabled === 'boolean' && !!web.diets &&
    typeof web.diets === 'object' && !Array.isArray(web.diets) &&
    Object.entries(web.diets).every(([id, diet]) => id && (!ids || ids.has(id)) && validDiet(diet, ids))
}

export function validate(config) {
  const errors = {}
  if (config?.version >= FOOD_WEB_RULE_VERSION && config.foodWeb !== undefined && !validFoodWeb(config.foodWeb)) {
    errors.foodWeb = 'Check the species diets and food-web switch.'
  }
  const number = (key, name, value, min, max, integer = true) => {
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      errors[key] = `${name} must be ${integer ? 'a whole number ' : ''}from ${min} to ${max}.`
    }
  }
  if (!config || !Number.isInteger(config.version) || config.version < LEGACY_RULE_VERSION || config.version > VERSION) {
    return { setup: 'Choose a setup file with a supported rule version.' }
  }
  if (typeof config.name !== 'string' || !config.name.trim() || config.name.trim().length > 60) errors.name = 'Enter a run name with 1–60 characters.'
  number('days', 'Days', config.days, 10, 1000)
  if (config.version >= SETTLED_RULE_VERSION && !['settled', 'timed'].includes(config.endMode)) errors.endMode = 'Choose when each day ends.'
  if (!endsWhenSettled(config)) {
    number('duration', 'Seconds per day', config.duration / 10, 1, 60, false)
    if (!errors.duration && !Number.isInteger(config.duration)) errors.duration = 'Enter seconds in tenths.'
  }
  number('seed', 'Seed', config.seed, 1, MAX_SEED)
  number('food', 'Starting plants', config.food, 10, 1000)
  if (usesOptionalRules(config) && config.advanced !== undefined) {
    for (const key of Object.keys(ADVANCED_DEFAULTS)) {
      const value = config.advanced?.[key]
      if (value !== undefined && typeof value !== 'boolean') errors['advanced.' + key] = 'Choose whether this rule is enabled.'
    }
  }
  if (advancedRuleEnabled(config, 'mealRefills')) {
    number('plantReward', 'Plant reward', config.plantReward, 0, 1000)
    number('preyReward', 'Prey reward', config.preyReward, 0, 1000)
  }
  if (!['prepare', 'live'].includes(config.mode) || !['linked', 'speed'].includes(config.stride) ||
      !['walkthrough', 'product', 'additive'].includes(config.metabolism) || typeof config.predation !== 'boolean' ||
      typeof config.sameSpecies !== 'boolean' ||
      (config.foraging !== undefined && !usesWalkthroughForaging(config))) errors.rules = 'Choose supported simulation rules.'
  if (usesHabitatRules(config)) {
    if (!['scattered', 'patches'].includes(config.foodPlacement)) errors.foodPlacement = 'Choose scattered plants or patches.'
    if (config.foodPlacement === 'patches') {
      number('patchCount', 'Number of patches', config.patchCount, 1, 8)
      number('patchRadius', 'Patch radius', config.patchRadius, 10, 60)
      if (!['fixed', 'interval'].includes(config.patchRelocation)) errors.patchRelocation = 'Choose when food patches move.'
      if (config.patchRelocation === 'interval') number('patchInterval', 'Generations between moves', config.patchInterval, 1, 100)
    }
    if (![10, 15, 20].includes(config.refugePercent)) errors.refugePercent = 'Choose a supported refuge width.'
    if (config.predation) {
      number('huntingAdvantage', 'Minimum hunting size advantage', config.huntingAdvantage, 5, 100)
      number('firstHuntingDay', 'First hunting day', config.firstHuntingDay, 1, Number.isInteger(config.days) ? config.days : 1000)
    }
  }
  if (usesFoodSeasonsRules(config) && config.foodSeasons !== undefined) {
    const season = config.foodSeasons
    if (typeof season?.enabled !== 'boolean') errors['foodSeasons.enabled'] = 'Choose whether food seasons are enabled.'
    if (season?.enabled === true) {
      for (const { key, label, min, max } of FOOD_SEASON_FIELDS) number('foodSeasons.' + key, label, season[key], min, max)
      if (!errors['foodSeasons.decline'] && !errors['foodSeasons.recovery']) {
        number('foodSeasons.peakDay', 'First peak day in cycle', season.peakDay, 1, season.decline + season.recovery)
      }
    }
  }
  if (usesReproductionRules(config) && config.reproduction !== undefined && advancedRuleEnabled(config, 'breeding')) {
    const rules = config.reproduction
    const canBreed = breedingCanProduceOffspring(config)
    if (canBreed) {
      if (!['single', 'pair'].includes(rules?.parentMode)) errors.parentMode = 'Choose a parent mode.'
      number('minimumBreedingAge', 'Minimum breeding age', rules?.minimumBreedingAge, 0, 30)
      number('birthWait', 'Wait after a birth', rules?.birthWait, 0, 30)
    }
    number('birthChance', 'Chance of a birth', rules?.birthChance, 0, 100)
    if (canBreed) number('twinChance', 'Chance of twins', rules?.twinChance, 0, 100)
  }
  function validateAging(rules, prefix) {
    if (typeof rules?.enabled !== 'boolean') errors[prefix + 'enabled'] = 'Choose whether aging is enabled.'
    if (usesOptionalRules(config) && rules?.enabled === false) return
    for (const { key, label, min, max, step } of AGING_FIELDS) {
      const value = rules?.[key]
      number(prefix + key, label, value, min, max, step === 1)
      if (step === 0.1 && Number.isFinite(value) && Math.abs(value * 10 - Math.round(value * 10)) > 1e-9) {
        errors[prefix + key] = 'Use at most one decimal place.'
      }
    }
    if (usesOptionalRules(config) && rules?.maxAgeEnabled !== undefined && typeof rules.maxAgeEnabled !== 'boolean') {
      errors[prefix + 'maxAgeEnabled'] = 'Choose whether to limit the lifespan.'
    }
    if (rules?.maxAge !== null && (!usesOptionalRules(config) || rules?.maxAgeEnabled !== false)) {
      number(prefix + 'maxAge', 'Maximum lifespan', rules?.maxAge, 1, 1000)
    }
  }

  function validateForaging(rules, prefix) {
    if (usesOptionalRules(config) && (!advancedRuleEnabled(config, 'customForaging') || usesWalkthroughForaging(config))) return
    for (const { key, label, min, max, step } of FORAGING_FIELDS) {
      const value = rules?.[key]
      number(prefix + key, label, value, min, max, step === 1)
      if (step === 0.1 && Number.isFinite(value) && Math.abs(value * 10 - Math.round(value * 10)) > 1e-9) {
        errors[prefix + key] = 'Use at most one decimal place.'
      }
    }
  }

  if (usesAgingRules(config) && config.aging !== undefined) validateAging(config.aging, 'aging.')
  if (usesForagingDecisionRules(config) && config.foragingDecisions !== undefined) {
    validateForaging(config.foragingDecisions, 'foragingDecisions.')
  }
  function validateTerritory(placement, prefix) {
    const edges = placement?.edges
    const active = !usesOptionalRules(config) || config.territories?.enabled !== false
    if (!Array.isArray(edges) || (active && !edges.length) || new Set(edges).size !== edges.length ||
        edges.some(edge => !TERRITORY_EDGES.includes(edge))) errors[prefix + 'edges'] = 'Choose at least one starting edge.'
    if (!active) return
    for (const { key, label, min, max } of TERRITORY_FIELDS) {
      number(prefix + key, label, placement?.[key], min, max)
    }
  }
  if (usesTerritoryRules(config) && config.territories !== undefined) {
    const settings = config.territories
    if (typeof settings?.enabled !== 'boolean') errors['territories.enabled'] = 'Choose whether to use starting territories.'
    if (!['opening', 'daily'].includes(settings?.timing)) errors['territories.timing'] = 'Choose when territories apply.'
    validateTerritory(settings, 'territories.')
  }
  if (!Array.isArray(config.schedule) || !['constant', 'ramp', 'step'].includes(config.scheduleMode)) {
    errors.schedule = 'Choose a supported food schedule.'
  } else {
    const days = new Set()
    for (const point of config.schedule) {
      if (!point || !Number.isInteger(point.day) || point.day < 2 || point.day > config.days ||
          days.has(point.day) || !Number.isInteger(point.food) || point.food < 10 || point.food > 1000) {
        errors.schedule = 'Use unique days from 2 through the run limit and 10–1,000 plants.'
        break
      }
      days.add(point.day)
    }
  }
  if (!Array.isArray(config.species) || !config.species.some(item => item?.enabled)) errors.species = 'Enable at least one species.'
  const names = new Set(), colors = new Set(), ids = new Set()
  for (const item of Array.isArray(config.species) ? config.species : []) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.enabled !== 'boolean') {
      errors.species = 'Every species needs a unique identity and enable state.'
      continue
    }
    ids.add(item.id)
    const name = typeof item.name === 'string' ? item.name.trim().toLowerCase() : ''
    const color = typeof item.color === 'string' ? item.color.toLowerCase() : ''
    if (!name || name.length > 30 || names.has(name)) errors[item.id + '.name'] = 'Enter a unique species name with 1–30 characters.'
    if (!/^#[0-9a-f]{6}$/.test(color) || colors.has(color)) errors[item.id + '.color'] = 'Choose a distinct six-digit color.'
    names.add(name)
    colors.add(color)
    number(item.id + '.count', 'Starting creatures', item.count, 10, 1000)
    number(item.id + '.energy', 'Starting energy', item.energy, 10, 1000)
    if (usesAgingRules(config) && item.aging !== undefined) validateAging(item.aging, item.id + '.aging.')
    if (usesForagingDecisionRules(config) && item.foragingDecisions !== undefined) {
      validateForaging(item.foragingDecisions, item.id + '.foragingDecisions.')
    }
    if (usesTerritoryRules(config) && item.territory !== undefined) {
      validateTerritory(item.territory, item.id + '.territory.')
    }
    const inheritance = usesReproductionRules(config) ? item.inheritance : undefined
    const legacy = !usesOptionalRules(config)
    const validateSpread = trait => legacy || mutationProducesSpread(config, item, trait)
    if (inheritance !== undefined && TRAITS.some(validateSpread) && !['normal', 'bounded'].includes(inheritance?.mutationPattern)) {
      errors[item.id + '.mutationPattern'] = 'Choose a mutation pattern.'
    }
    for (const trait of TRAITS) {
      number(item.id + '.' + trait, trait, item[trait], 1, 100)
      if (typeof item.mutation?.[trait] !== 'boolean') errors[item.id + '.mutation.' + trait] = 'Specify which traits mutate.'
      if (validateSpread(trait)) {
        if (usesStandardDeviation(config)) {
          number(item.id + '.standardDeviation.' + trait, 'Standard deviation', item.standardDeviation?.[trait], 0, 10, false)
        } else {
          number(item.id + '.variance.' + trait, 'Variance', item.variance?.[trait], 0.01, 10, false)
        }
      }
      if (inheritance !== undefined && (legacy || mutationEnabled(config, item, trait))) {
        number(item.id + '.mutationChance.' + trait, 'Mutation chance', inheritance?.mutationChance?.[trait], 0, 100)
      }
    }
  }
  return errors
}

function basePlantsForDay(config, day) {
  if (config.scheduleMode === 'constant') return config.food
  let previous = { day: 1, food: config.food }
  for (const next of [...config.schedule].sort((a, b) => a.day - b.day)) {
    if (day === next.day) return next.food
    if (day < next.day) {
      return config.scheduleMode === 'step' ? previous.food :
        Math.floor(previous.food + (next.food - previous.food) * (day - previous.day) / (next.day - previous.day) + 0.5)
    }
    previous = next
  }
  return previous.food
}

export function foodSupplyForDay(config, day) {
  const base = basePlantsForDay(config, day)
  const season = config.foodSeasons
  if (!usesFoodSeasonsRules(config) || season?.enabled !== true) {
    return { base, count: base, multiplier: 100, phase: null }
  }
  const { peak, lean, decline, recovery, peakDay } = season
  const cycleLength = decline + recovery
  const offset = ((day - peakDay) % cycleLength + cycleLength) % cycleLength
  const falling = offset < decline
  const elapsed = falling ? offset : offset - decline
  const length = falling ? decline : recovery
  const phase = offset === 0 ? 'Peak' : offset === decline ? 'Leanest' : falling ? 'Falling' : 'Recovering'
  const turn = elapsed / length
  // Keep exact half-plant ties from drifting below the rounding threshold.
  const progress = turn === 1 / 3 ? 0.25 : turn === 0.5 ? 0.5 : turn === 2 / 3 ? 0.75 : (1 - Math.cos(Math.PI * turn)) / 2
  const multiplier = falling ? peak + (lean - peak) * progress : lean + (peak - lean) * progress
  const rounded = Math.round(base * multiplier / 100)
  const count = Math.max(10, Math.min(1000, rounded))
  return { base, count, multiplier, phase, offset, cycleLength, limit: rounded === count ? null : count }
}

export function plantsForDay(config, day) {
  return foodSupplyForDay(config, day).count
}

export function rulesFor(setup, revisions, day) {
  return revisions.findLast(revision => day >= revision.day)?.setup ?? setup
}

export function validateRevisions(setup, revisions) {
  if (!Array.isArray(revisions)) return false
  if (!revisions.length) return true
  if (revisions[0]?.day !== 1) return false
  const foundersOf = settings => settings.species.map(s => [
    s.id,s.name,s.color,s.enabled,s.count,s.energy,s.speed,s.size,s.sense
  ])
  const identity = JSON.stringify(foundersOf(setup))
  let previous = 0
  for (const revision of revisions) {
    if (!revision || !Number.isInteger(revision.day) || revision.day <= previous || revision.day > setup.days ||
        Object.keys(validate(revision.setup)).length || revision.setup.seed !== setup.seed ||
        JSON.stringify(foundersOf(revision.setup)) !== identity) return false
    previous = revision.day
  }
  return true
}

export function randomSeed(exclude = 0) {
  if (!Number.isInteger(exclude) || exclude < 1 || exclude > MAX_SEED) return 1 + Math.floor(Math.random() * MAX_SEED)
  const draw = 1 + Math.floor(Math.random() * (MAX_SEED - 1))
  return draw >= exclude ? draw + 1 : draw
}

export function setupForNewRun(setup) {
  if (setup.version >= WALKTHROUGH_RULE_VERSION && setup.version <= VERSION) {
    return setupWithRuleDefaults({ ...setup, version: VERSION })
  }
  if (setup.version !== SETTLED_RULE_VERSION) return setup
  const species = setup.species.map(({ variance, ...item }) => ({
    ...item, standardDeviation: Object.fromEntries(TRAITS.map(trait => [trait, Math.sqrt(variance[trait])])),
  }))
  return setupWithRuleDefaults({ ...setup, version: VERSION, species })
}
