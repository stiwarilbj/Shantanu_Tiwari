import { FOOD_WEB_RULE_VERSION, huntingOnDay, rulesFor } from './config.js'

export const DEFAULT_DIET = Object.freeze({ plants: true, hunt: 'any', prey: Object.freeze([]) })
export const EMPTY_FOOD_WEB = Object.freeze({ enabled: false, diets: Object.freeze({}) })
export const usesFoodWeb = config => config.version >= FOOD_WEB_RULE_VERSION && config.foodWeb?.enabled === true

export function dietFor(web, id) {
  return web && Object.hasOwn(web.diets, id) ? web.diets[id] : DEFAULT_DIET
}

export function setDiet(web, id, diet) {
  const diets = { ...web.diets, [id]: diet }
  if (diet.plants && diet.hunt === 'any' && !diet.prey.length) delete diets[id]
  return { ...web, diets }
}

export function copyDiet(diet, fromId, toId) {
  return { ...diet, prey: diet.prey.map(id => id === fromId ? toId : id) }
}

export function foodWebAfter(web, action) {
  if (action.kind === 'food-web') return action.foodWeb
  const diet = action.diet ?? (action.kind === 'split' && web
    ? copyDiet(dietFor(web, action.sourceId), action.sourceId, action.id) : DEFAULT_DIET)
  if (diet.plants && diet.hunt === 'any' && !diet.prey.length) return web
  return setDiet(web ?? EMPTY_FOOD_WEB, action.id, diet)
}

export function foodWebAt(run, day, tick = Infinity) {
  const revisions = run.revisions ?? []
  const base = rulesFor(run.setup, revisions, day)
  const start = revisions.findLast(revision => revision.day <= day)?.day ?? 1
  let web = base.foodWeb
  for (const action of run.speciesActions ?? []) {
    if (action.day < start) continue
    if (action.day > day || (action.day === day && action.tick > tick)) break
    web = foodWebAfter(web, action)
  }
  return web
}

export const canEatPlants = (blob, config) => !usesFoodWeb(config) || dietFor(config.foodWeb, blob.species).plants

export function permitsPrey(hunter, prey, config) {
  if (!usesFoodWeb(config)) return true
  const diet = dietFor(config.foodWeb, hunter.species)
  return diet.hunt === 'any' || (diet.hunt === 'selected' && diet.prey.includes(prey.species))
}

export function encounterResult(config, hunter, prey, day, huntingBlock) {
  if (!hunter?.enabled || (prey && !prey.enabled)) return 'This species is disabled in the setup.'
  if (!prey) return canEatPlants(hunter, config)
    ? 'This species can eat plants.' : 'This diet excludes plants.'
  if (config.predation && !huntingOnDay(config, day)) return `Hunting begins on Day ${config.firstHuntingDay}.`
  return huntingBlock(hunter, prey, config) ?? 'This hunt is allowed if the hunter catches the prey.'
}
