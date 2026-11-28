import { DEFAULT_DIET, EMPTY_FOOD_WEB } from './engine/food-web.js'
import { DEFAULT_PLANT_FOODS, PLANT_FOOD_TYPES } from './engine/plant-food.js'
import { runSpecies } from './engine/species-actions.js'
import { DEATH_CAUSES, METRICS } from './engine/stats.js'
import { ADVANCED_DEFAULTS, AGING_DEFAULTS, FOOD_SEASON_DEFAULTS, FOOD_WEB_RULE_VERSION, FORAGING_DEFAULTS, HABITAT_DEFAULTS, INHERITANCE_DEFAULTS,
  MUTATION_DEFAULTS, PLANT_FOOD_RULE_VERSION, REPRODUCTION_DEFAULTS, setupWithRuleDefaults, TERRITORY_DEFAULTS, TERRITORY_EDGES, usesAgingRules, usesFoodSeasonsRules,
  usesForagingDecisionRules, usesOptionalRules, usesReproductionRules, usesTerritoryRules } from './engine/config.js'

function omitDefaults(values, defaults) {
  const entries = Object.entries(values ?? {}).filter(([key, value]) => value !== defaults[key])
  return entries.length ? Object.fromEntries(entries) : undefined
}

// These positions are part of the share-link format.
const foragingLinkOrder = ['plantMemory', 'switchSavings', 'returnMargin', 'preyPursuit']
function packForaging(settings) {
  const values = foragingLinkOrder.map(key => settings?.[key] === FORAGING_DEFAULTS[key] ? null : settings?.[key] ?? null)
  while (values.at(-1) === null) values.pop()
  return values
}

function unpackForaging({ fd, ...setup }) {
  if (!Array.isArray(fd)) return setup
  setup.foragingDecisions = Object.fromEntries(
    foragingLinkOrder.flatMap((key, index) => fd[index] == null ? [] : [[key, fd[index]]]),
  )
  return setup
}

// Share links use an edge bitmask, band center, band width, and two field-only flags.
function packTerritory(placement, field = false) {
  const mask = TERRITORY_EDGES.reduce((bits, edge, index) =>
    placement.edges.includes(edge) ? bits | (1 << index) : bits, 0)
  const values = [
    mask === (1 << TERRITORY_EDGES.length) - 1 ? null : mask,
    placement.center === TERRITORY_DEFAULTS.center ? null : placement.center,
    placement.width === TERRITORY_DEFAULTS.width ? null : placement.width,
  ]
  if (field) values.push(placement.enabled ? 1 : null, placement.timing === 'daily' ? 1 : null)
  while (values.at(-1) === null) values.pop()
  return values
}

function unpackTerritory({ tt, ...setup }, field = false) {
  if (!Array.isArray(tt)) return setup
  const [mask, center, width, enabled, daily] = tt
  const placement = {
    ...(mask != null && { edges: TERRITORY_EDGES.filter((_, index) => mask & (1 << index)) }),
    ...(center != null && { center }),
    ...(width != null && { width }),
  }
  if (field) setup.territories = { ...placement, enabled: enabled === 1, timing: daily === 1 ? 'daily' : 'opening' }
  else setup.territory = placement
  return setup
}

const seasonLinkOrder = ['peak', 'lean', 'decline', 'recovery', 'peakDay', 'enabled']
function packSeasons(season) {
  const values = seasonLinkOrder.map(key => season?.[key] === FOOD_SEASON_DEFAULTS[key] ? null : season?.[key] ?? null)
  while (values.at(-1) === null) values.pop()
  return values.length ? values : undefined
}

function unpackSeasons({ fs, ...setup }) {
  if (Array.isArray(fs)) {
    setup.foodSeasons = Object.fromEntries(seasonLinkOrder.flatMap((key, index) => fs[index] == null ? [] : [[key, fs[index]]]))
  }
  return setup
}

function packFoodWeb(web, species) {
  const indexOf = id => {
    const index = species.findIndex(item => item.id === id)
    return index < 0 ? id : index
  }
  const diets = Object.entries(web?.diets ?? {}).map(([id, diet]) => [
    indexOf(id), Number(diet.plants), ['any', 'selected', 'none'].indexOf(diet.hunt), ...diet.prey.map(indexOf),
  ])
  return web?.enabled || diets.length ? [Number(web.enabled), ...diets] : undefined
}

function unpackFoodWeb(setup) {
  if (!Array.isArray(setup.fw)) return setup
  const { fw: [enabled, ...rows], ...rest } = setup
  const idOf = value => typeof value === 'number' ? setup.species[value]?.id : value
  if (![0, 1].includes(enabled) || rows.some(row => !Array.isArray(row) || row.length < 3 ||
      ![0, 1].includes(row[1]) || ![0, 1, 2].includes(row[2]) ||
      ![row[0], ...row.slice(3)].every(value => idOf(value)))) throw new Error('Invalid food web in setup link.')
  const diets = Object.fromEntries(rows.map(([id, plants, mode, ...prey]) => [
    idOf(id), { ...DEFAULT_DIET, plants: plants === 1, hunt: ['any', 'selected', 'none'][mode], prey: prey.map(idOf) },
  ]))
  return { ...rest, foodWeb: { ...EMPTY_FOOD_WEB, enabled: enabled === 1, diets } }
}

function packPlantFoods(foods = DEFAULT_PLANT_FOODS, species) {
  const weights = foods.weights.every((weight, index) => weight === DEFAULT_PLANT_FOODS.weights[index]) ? null : foods.weights
  const diets = Object.entries(foods.diets).map(([id, types]) => {
    const index = species.findIndex(item => item.id === id)
    const mask = PLANT_FOOD_TYPES.reduce((bits, type, i) => types.includes(type.id) ? bits | (1 << i) : bits, 0)
    return [index === -1 ? id : index, mask]
  })
  return foods.enabled || weights || diets.length ? [Number(foods.enabled), weights, ...diets] : undefined
}

function unpackPlantFoods({ pf, ...setup }) {
  if (pf === undefined) return setup
  if (!Array.isArray(pf)) throw new Error('Invalid food types in setup link.')
  const [enabled, weights, ...rows] = pf
  const idOf = value => Number.isInteger(value) ? setup.species[value]?.id : typeof value === 'string' ? value : null
  if (![0, 1].includes(enabled) || rows.some(row => !Array.isArray(row) || row.length !== 2 || !idOf(row[0]) ||
    !Number.isInteger(row[1]) || row[1] < 0 || row[1] >= (1 << PLANT_FOOD_TYPES.length))) {
    throw new Error('Invalid food types in setup link.')
  }
  const diets = Object.fromEntries(rows.map(([id, mask]) => [
    idOf(id), PLANT_FOOD_TYPES.filter((_, index) => mask & (1 << index)).map(type => type.id),
  ]))
  return { ...setup, plantFoods: { enabled: enabled === 1, weights: weights ?? DEFAULT_PLANT_FOODS.weights, diets } }
}

export function setupLink(setup) {
  let compact = setup
  if (usesReproductionRules(setup)) {
    const foraging = usesForagingDecisionRules(setup)
    const fieldDecisions = foraging ? packForaging(setup.foragingDecisions) : []
    const territories = usesTerritoryRules(setup)
    const fieldTerritory = territories && setup.territories ? packTerritory(setup.territories, true) : []
    compact = {
      ...omitDefaults(setup, HABITAT_DEFAULTS),
      ...(usesOptionalRules(setup) && { advanced: omitDefaults(setup.advanced, ADVANCED_DEFAULTS) }),
      ...(usesAgingRules(setup) && { aging: omitDefaults(setup.aging, AGING_DEFAULTS) }),
      ...(foraging && { foragingDecisions: undefined, fd: fieldDecisions.length ? fieldDecisions : undefined }),
      ...(territories && { territories: undefined, tt: fieldTerritory.length ? fieldTerritory : undefined }),
      ...(usesFoodSeasonsRules(setup) && { foodSeasons: undefined, fs: packSeasons(setup.foodSeasons) }),
      ...(setup.version >= FOOD_WEB_RULE_VERSION && { foodWeb: undefined, fw: packFoodWeb(setup.foodWeb, setup.species) }),
      ...(setup.version >= PLANT_FOOD_RULE_VERSION && { plantFoods: undefined, pf: packPlantFoods(setup.plantFoods, setup.species) }),
      reproduction: omitDefaults(setup.reproduction, REPRODUCTION_DEFAULTS),
      species: setup.species.map(item => {
        const mutationChance = omitDefaults(item.inheritance?.mutationChance, INHERITANCE_DEFAULTS.mutationChance)
        const mutationPattern = item.inheritance?.mutationPattern
        const aging = usesAgingRules(setup) && item.aging
          ? { aging: omitDefaults(item.aging, AGING_DEFAULTS) ?? {} }
          : {}
        const decisions = foraging && item.foragingDecisions
          ? { foragingDecisions: undefined, fd: packForaging(item.foragingDecisions) }
          : {}
        const placement = territories && item.territory ? { territory: undefined, tt: packTerritory(item.territory) } : {}
        return { ...item, ...aging, ...decisions, ...placement,
          mutation: omitDefaults(item.mutation, MUTATION_DEFAULTS),
          inheritance: omitDefaults({ mutationPattern, mutationChance }, INHERITANCE_DEFAULTS) }
      }),
    }
  }
  const bytes=new TextEncoder().encode(JSON.stringify(compact))
  if(bytes.length>1350) return null
  const token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
  const link=location.origin+location.pathname+'#/setup/'+token
  return link.length<=1800 ? link : null
}

export function setupFromLink(hash) {
  if(!hash.startsWith('#/setup/')) return null
  const token=hash.slice(8)
  const bytes=Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))
  let setup = JSON.parse(new TextDecoder().decode(bytes))
  // Share links omit defaults to keep common configurations within the URL limit.
  if (!setup || !usesReproductionRules(setup) || !Array.isArray(setup.species) ||
      !setup.species.every(item => item && typeof item === 'object')) return setup
  setup = { ...setup, species: setup.species.map(item => ({ ...item, mutation: { ...MUTATION_DEFAULTS, ...item.mutation } })) }
  if (!usesForagingDecisionRules(setup)) return setupWithRuleDefaults(setup)
  const decoded = { ...unpackForaging(setup), species: setup.species.map(unpackForaging) }
  if (!usesTerritoryRules(setup)) return setupWithRuleDefaults(decoded)
  const withTerritories = { ...unpackTerritory(decoded, true), species: decoded.species.map(item => unpackTerritory(item)) }
  const withSeasons = usesFoodSeasonsRules(setup) ? unpackSeasons(withTerritories) : withTerritories
  const withFoodWeb = setup.version >= FOOD_WEB_RULE_VERSION ? unpackFoodWeb(withSeasons) : withSeasons
  return setupWithRuleDefaults(setup.version >= PLANT_FOOD_RULE_VERSION ? unpackPlantFoods(withFoodWeb) : withFoodWeb)
}

export function download(name, mime, content) {
  const url=URL.createObjectURL(new Blob([content],{type:mime}))
  const link=document.createElement('a')
  link.href=url
  link.download=name
  link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export function csv(run, scope='all', start=1, end=1000) {
  const traits=METRICS.filter(m=>m.key!=='population')
  const fields=['n','mean','p25','p75','min','max','sd']
  const base=['opening','population','births','deaths','net','food','plants','plantsLeft','hunts']
  const hasSpeciesHistory = run.speciesActions?.some(action => action.kind !== 'food-web')
  const movement = ['introduced', 'transferredIn', 'transferredOut']
  const headers=['run','seed','rule_version','day','scope','rule_start_day','fork_day',...base,...DEATH_CAUSES,...traits.flatMap(m=>fields.map(f=>m.key+'_'+f)),
    ...(hasSpeciesHistory ? ['species_name', 'species_color', ...movement] : [])]
  const out=[headers]
  for(const day of run.summaries.filter(s=>s.day>=start&&s.day<=end)) {
    const revision=run.revisions?.findLast(r=>r.day<=day.day)
    const rules=revision?.setup ?? run.setup
    const species = hasSpeciesHistory ? new Map(runSpecies(run, day.day).map(item => [item.id, item])) : null
    for(const [id,row] of Object.entries(day.rows)) {
      if(scope!=='*'&&scope!==id) continue
      out.push([run.id,rules.seed,rules.version,day.day,id,revision?.day ?? 1,run.forkDay,...base.map(k=>row[k]),...DEATH_CAUSES.map(c=>row.causes?.[c] ?? 0),
        ...traits.flatMap(m=>fields.map(f=>row[m.key]?.[f])),
        ...(species ? [id === 'all' ? 'All species' : species.get(id)?.name, species.get(id)?.color,
          ...movement.map(key => row[key] ?? 0)] : [])])
    }
  }
  return out.map(row=>row.map(v=>v==null?'':'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')
}
