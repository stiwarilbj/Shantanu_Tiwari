import { advancedRuleEnabled, endsWhenSettled, huntingOnDay, INHERITANCE_DEFAULTS, REPRODUCTION_DEFAULTS, TRAITS,
  rulesFor, usesImprovedSteering, usesReproductionRules, usesStandardDeviation, usesWalkthroughForaging } from './config.js'
import { random, normal, shuffle } from './random.js'
import { canEatPlants, foodWebAfter } from './food-web.js'
import { summaries } from './stats.js'
import { forage } from './foraging.js'
import { improvedIntent, steer } from './steering.js'
import { FIELD, DT, WALKTHROUGH_STEP, Grid, clamp, radius, travel, cost, walkthroughStepCost,
  canHunt, turn, edgePoint, homePoints, refugeContact, refugeDistance, pathOf, contact } from './geometry.js'
import { openingHabitat } from './habitat.js'
import { agingRules, oldAgeRisk, travelSpeedPercent } from './aging.js'
import { DECISION, foragingDecisionsFor, tracksForagingDecisions } from './foraging-decisions.js'
import { startingPose, territoryPositions } from './starting-territories.js'
import { adjustedTrait } from './trait-adjustments.js'
import { speciesActionIssue, speciesEditsAfter, speciesTraitValue, speciesWithEdits } from './species-actions.js'

export const STATES = ['Searching', 'Foraging', 'Chasing', 'Fleeing', 'Returning', 'Home', 'Dead', 'Born']
const MIN_POSITIVE_TRAIT = 2 ** -1022
const MAX_SETTLED_STEPS = 1_000_000
const stepLimit = (ctx, config) => ctx.limit ?? (usesStandardDeviation(config) ? MAX_SETTLED_STEPS : Infinity)

export function founders(config) {
  let id = 1
  const roster = config.species.filter(s => s.enabled).flatMap(s => Array.from({ length: s.count }, () => ({
    id: id++, species: s.id, parent: null, age: 0, born: 1, speed: s.speed, size: s.size, sense: s.sense,
  })))
  return { roster, nextId: id }
}

function standardSpawn(blob, i, count, edges, seed, day, refugeWidth) {
  const edge = edges[i % 4], slot = Math.floor(i / 4), slots = Math.ceil((count - i % 4) / 4)
  const margin = refugeWidth ? refugeWidth + 2 : 25
  const along = clamp(margin + (FIELD - 2 * margin) * (slot + 0.1 + random(seed, 3, day, blob.id) * 0.8) / slots,
    blob.r + 6, FIELD - blob.r - 6)
  return startingPose(blob, edge, along, refugeWidth, seed, day)
}

export function dawnForRun(setup, revisions, day, checkpoint, adjustments, speciesActions) {
  const rules = rulesFor(setup, revisions, day)
  const revised = revisions.some(revision => revision.day === day)
  const state = dawn(rules, day, revised ? { ...checkpoint, foodWeb: rules.foodWeb } : checkpoint,
    rulesFor(setup, revisions, day - 1))
  const scheduled = [...(adjustments ?? []), ...(speciesActions ?? [])].filter(edit => edit.day === day)
    .sort((a, b) => a.tick - b.tick || (a.order ?? 0) - (b.order ?? 0))
  if (scheduled.length) {
    state.scheduledAdjustments = scheduled
    state.nextAdjustment = 0
    applyScheduledAdjustments(state, rules)
  }
  return state
}

export function dawn(config, day, checkpoint, previous = config) {
  const { roster, nextId } = checkpoint
  config = effectiveSpecies(config, checkpoint)
  previous = effectiveSpecies(previous, checkpoint)
  const foraging = usesWalkthroughForaging(config)
  const { refugeWidth, plants } = openingHabitat(config, day)
  const inheritedEdges = foraging && !refugeWidth
  const stepSeconds = config.metabolism === 'walkthrough' ? WALKTHROUGH_STEP : DT
  const species = new Map(config.species.map(s => [s.id, s]))
  const territories = territoryPositions(config, day, previous, roster, refugeWidth)
  const edges = inheritedEdges || territories ? null : shuffle([0, 1, 2, 3], config.seed, day, 2)
  const slots = edges && new Map(shuffle(roster, config.seed, day, 1).map((blob, i) => [blob.id, i]))
  const blobs = roster.map(original => {
    const r = radius(original.size)
    const position = territories?.get(original.id) ?? (inheritedEdges
      ? { ...(original.edge ?? edgePoint(FIELD * random(config.seed, 3, day, original.id, 0),
        FIELD * random(config.seed, 3, day, original.id, 1))), angle: 0 }
      : standardSpawn({ id: original.id, r }, slots.get(original.id), roster.length, edges, config.seed, day, refugeWidth))
    return initializeBlob(original, position, r, config, species.get(original.species), stepSeconds)
  })
  if (!foraging) blobs.sort((a, b) => a.id - b.id)
  const limit = endsWhenSettled(config) ? null : Math.round(config.duration / 10 / stepSeconds)
  return { day, tick: 0, stepSeconds, limit, refugeWidth,
    nextId, opening: roster, blobs, plants, events: [], settled: false,
    ...(config.foodWeb && { foodWeb: config.foodWeb }),
    ...(checkpoint.speciesEdits && { speciesEdits: checkpoint.speciesEdits }) }
}

function effectiveSpecies(config, state) {
  const species = speciesWithEdits(config.species, state.speciesEdits)
  const foodWeb = state.foodWeb ?? config.foodWeb
  return species === config.species && foodWeb === config.foodWeb ? config : { ...config, species, foodWeb }
}

function initializeBlob(original, position, r, config, settings, stepSeconds) {
  const energy = settings.energy
  return { ...original, ...position, r, energy, capacity: energy, credits: 0, preyCredits: 0,
    state: 0, alive: true, home: false, returning: false, target: null,
    velocityX: 0, velocityY: 0, ...movementTraits(original, config, settings, stepSeconds),
    ...(tracksForagingDecisions(config) && {
      foragingSettings: foragingDecisionsFor(config, settings),
      foragingDecision: DECISION.searching,
      foragingSavings: 0,
    }) }
}

function record(ctx, blob, time, type, extra = {}) {
  ctx.events.push({ day: ctx.day, time, type, id: blob.id, species: blob.species, age: blob.age,
    x: blob.x, y: blob.y, energy: blob.energy, ...extra })
}

function movementTraits(blob, config, species, stepSeconds) {
  const speedMultiplier = travelSpeedPercent(agingRules(config, species), blob.age) / 100
  const moveCost = config.metabolism === 'walkthrough' ? walkthroughStepCost(blob, config) : null
  return { speedWorld: travel(blob, config) * speedMultiplier, moveCost,
    rate: moveCost == null ? cost(blob, config) : moveCost / stepSeconds }
}

export function applyTraitAdjustment(ctx, config, changes, creatureIds) {
  if (ctx.settled) return 0
  config = effectiveSpecies(config, ctx)
  const species = new Map(config.species.map(s => [s.id, s]))
  const targets = creatureIds == null ? null : new Set(creatureIds)
  const time = ctx.tick * ctx.stepSeconds
  let affected = 0
  for (const blob of ctx.blobs) {
    if (!blob.alive || (targets && !targets.has(blob.id))) continue
    const [speed, size, sense] = TRAITS.map(trait => adjustedTrait(blob, trait, changes[trait], config))
    if (speed === blob.speed && size === blob.size && sense === blob.sense) continue
    const traits = { speed, size, sense, r: radius(size),
      ...movementTraits({ ...blob, speed, size, sense }, config, species.get(blob.species), ctx.stepSeconds) }
    Object.assign(blob, traits)
    record(ctx, blob, time, 'traits', { traits })
    affected++
  }
  return affected
}

export function applySpeciesAction(ctx, config, action) {
  if (ctx.settled) return 'This generation has ended.'
  const rules = effectiveSpecies(config, ctx)
  const issue = speciesActionIssue(action, rules, ctx.blobs)
  if (issue) return issue
  const { kind, id, count, creatureIds, definition, traits } = action
  if (kind === 'introduce' && (creatureIds?.length !== count ||
      creatureIds.some((creature, index) => creature !== ctx.nextId + index))) return 'The next creature IDs have changed.'
  const time = ctx.tick * ctx.stepSeconds
  const web = foodWebAfter(rules.foodWeb, action)
  if (web !== rules.foodWeb) {
    ctx.foodWeb = web
    ctx.events.push({ day: ctx.day, time, type: 'food-web', foodWeb: web })
  }
  if (kind === 'food-web') {
    clearForbiddenMeals(ctx, { ...rules, foodWeb: web })
    return ''
  }
  ctx.speciesEdits = speciesEditsAfter(ctx.speciesEdits, action)
  ctx.events.push({ day: ctx.day, time, type: 'species-edit', edit: ctx.speciesEdits[id], species: id })
  if (kind === 'introduce') {
    const edges = shuffle([0, 1, 2, 3], config.seed, ctx.day, 54, ctx.tick)
    for (const [index, creature] of creatureIds.entries()) {
      const { speed, size, sense } = definition
      const original = { id: creature, species: id, parent: null, age: 0, born: ctx.day, speed, size, sense }
      const r = radius(size)
      const position = standardSpawn({ id: creature, r }, index, count, edges, config.seed, ctx.day, ctx.refugeWidth)
      const blob = initializeBlob(original, position, r, config, definition, ctx.stepSeconds)
      ctx.blobs.push(blob)
      record(ctx, blob, time, 'introduced', { blob: { ...blob } })
    }
    ctx.nextId += count
    return ''
  }
  const targets = new Set(creatureIds)
  const settings = definition ?? rules.species.find(item => item.id === id)
  for (const blob of ctx.blobs) {
    if (!targets.has(blob.id)) continue
    if (kind === 'split') {
      const fromSpecies = blob.species
      blob.species = id
      if (tracksForagingDecisions(config)) blob.foragingSettings = foragingDecisionsFor(config, settings)
      record(ctx, blob, time, 'transferred', { fromSpecies, speciesName: settings.name })
    }
    const next = Object.fromEntries(TRAITS.map(trait => [trait, speciesTraitValue(blob, trait, traits, config)]))
    if (TRAITS.every(trait => next[trait] === blob[trait]) && kind !== 'split') continue
    const properties = { ...next, r: radius(next.size),
      ...movementTraits({ ...blob, ...next }, config, settings, ctx.stepSeconds) }
    Object.assign(blob, properties)
    record(ctx, blob, time, 'traits', { traits: properties })
  }
  if (kind === 'split') clearForbiddenMeals(ctx, { ...rules, foodWeb: web })
  return ''
}

function clearForbiddenMeals(ctx, config) {
  if (!config.foodWeb?.enabled) return
  const blobs = new Map(ctx.blobs.map(blob => [blob.id, blob]))
  for (const blob of ctx.blobs) {
    const memory = blob.steering
    if (!memory) continue
    const permitsPlants = canEatPlants(blob, config)
    if (!permitsPlants) memory.plant = null
    const target = memory.kind === 'prey' ? blobs.get(memory.id) : null
    if ((memory.kind === 'plant' && !permitsPlants) || (target && !canHunt(blob, target, config))) {
      memory.kind = null
      memory.id = null
      blob.foragingDecision = DECISION.searching
      blob.foragingSavings = 0
    }
  }
}

function applyScheduledAdjustments(ctx, config) {
  let edit = ctx.scheduledAdjustments?.[ctx.nextAdjustment]
  while (edit?.tick === ctx.tick) {
    if (edit.kind) {
      const issue = applySpeciesAction(ctx, config, edit)
      if (issue) throw new Error(issue)
    } else applyTraitAdjustment(ctx, config, edit.changes, edit.creatureIds)
    edit = ctx.scheduledAdjustments[++ctx.nextAdjustment]
  }
}

function kill(ctx, blob, time, cause, extra) {
  blob.alive = false
  blob.state = 6
  record(ctx, blob, time, 'death', { cause, ...extra })
}

function settleHome(ctx, blob, time) {
  blob.home = true
  blob.state = 5
  blob.velocityX = blob.velocityY = 0
  record(ctx, blob, time, 'home')
}

function eat(ctx, config, blob, target, time, type) {
  const beforeEnergy = blob.energy
  const extra = { target: target.id, beforeEnergy }
  if (type === 'plant') {
    target.eaten = true
    if (blob.steering?.plant?.id === target.id) blob.steering.plant = null
    if (advancedRuleEnabled(config, 'mealRefills')) blob.energy = Math.min(blob.capacity, blob.energy + config.plantReward)
  } else {
    blob.preyCredits++
    if (advancedRuleEnabled(config, 'mealRefills')) blob.energy = Math.min(blob.capacity, blob.energy + config.preyReward)
    extra.targetSpecies = target.species
  }
  blob.credits++
  record(ctx, blob, time, type, extra)
}

function nearest(blob, candidates, eligible) {
  let best = null, closest = blob.sense ** 2
  for (const target of candidates) {
    const d = (target.x - blob.x) ** 2 + (target.y - blob.y) ** 2
    if (d <= closest && eligible(target) && (d < closest || best === null || target.id < best.id)) {
      closest = d
      best = target
    }
  }
  return best
}

function intent(blob, ctx, config, plantGrid, blobGrid) {
  const nearby = [...blobGrid.near(blob.x, blob.y, blob.sense)]
  const threat = nearest(blob, nearby, other => canHunt(other, blob, config) && other.credits < 2)
  const timeLeft = (stepLimit(ctx, config) - ctx.tick) * (ctx.stepSeconds ?? DT)
  const left = Math.min(timeLeft, blob.energy / blob.rate)
  const homes = homePoints(blob, ctx.refugeWidth)
  const base = homes[0]
  const towards = target => Math.atan2(target.y - blob.y, target.x - blob.x)
  const required = target => target.distance / blob.speedWorld +
    (target.distance ? Math.abs(turn(blob.angle, towards(target))) / (2 * Math.PI) : 0) + 0.25
  if (blob.credits >= 2 || (blob.credits === 1 && left <= required(base))) blob.returning = true
  if (blob.returning) {
    if (threat) {
      const away = homes.find(point => required(point) <= left &&
        point.dx * (blob.x - threat.x) + point.dy * (blob.y - threat.y) > 0)
      if (away) blob.target = away
    }
    blob.target ??= base
    blob.state = 4
    return towards(blob.target)
  }
  if (threat) {
    blob.state = 3
    return Math.atan2(blob.y - threat.y, blob.x - threat.x)
  }
  const food = nearest(blob, plantGrid.near(blob.x, blob.y, blob.sense), plant => !plant.eaten)
  const foodTime = food ? Math.hypot(food.x - blob.x, food.y - blob.y) / blob.speedWorld : Infinity
  let prey = null
  for (const other of nearby) {
    if (!canHunt(blob, other, config)) continue
    const dx = other.x - blob.x, dy = other.y - blob.y
    if (dx * dx + dy * dy > blob.sense ** 2) continue
    const reach = contact({ x: 0, y: 0, dx: blob.speedWorld * left, dy: 0 },
      { x: Math.hypot(dx, dy), y: 0, dx: (other.velocityX * dx + other.velocityY * dy) * left / (Math.hypot(dx, dy) || 1), dy: 0 },
      blob.r + other.r)
    if (reach === null || reach * left >= foodTime) continue
    if (!prey || other.speedWorld < prey.blob.speedWorld ||
        (other.speedWorld === prey.blob.speedWorld && (reach < prey.reach ||
          (reach === prey.reach && other.id < prey.blob.id)))) prey = { blob: other, reach }
  }
  if (prey) {
    blob.state = 2
    return towards({ x: prey.blob.x + prey.blob.velocityX * prey.reach * left,
      y: prey.blob.y + prey.blob.velocityY * prey.reach * left })
  }
  if (food) {
    blob.state = 1
    return towards(food)
  }
  blob.state = 0
  const margin = blob.r + 0.5
  if (Math.min(blob.x, blob.y, FIELD - blob.x, FIELD - blob.y) < margin) return towards({ x: 250, y: 250 })
  return blob.angle + (ctx.tick % 5 === 0 ? (random(config.seed, 6, ctx.day, ctx.tick, blob.id) - 0.5) * 70 * Math.PI / 180 : 0)
}

function tick(ctx, config) {
  const seconds = ctx.stepSeconds ?? DT
  const improved = usesImprovedSteering(config)
  const timeLeft = (stepLimit(ctx, config) - ctx.tick) * seconds
  const discreteCost = config.metabolism === 'walkthrough'
  const homeFraction = path => refugeContact(path, ctx.refugeWidth || path.blob.r + 6)
  const active = ctx.blobs.filter(b => {
    if (!b.alive || b.home) return false
    if (ctx.refugeWidth && b.energy <= 0) {
      kill(ctx, b, ctx.tick * seconds, 'Energy depletion')
      return false
    }
    // An inherited speed can be positive but too small to change a field coordinate.
    if (usesStandardDeviation(config) && b.speedWorld * seconds < Number.EPSILON) {
      if (ctx.refugeWidth && b.credits && refugeDistance(b, ctx.refugeWidth) === 0) {
        settleHome(ctx, b, ctx.tick * seconds)
      } else kill(ctx, b, ctx.tick * seconds, b.credits ? 'Missed home' : 'Starvation')
      return false
    }
    return true
  })
  if (!active.length) {
    ctx.tick++
    return
  }
  const plantGrid = new Grid(), blobGrid = new Grid(), pathGrid = new Grid()
  for (const plant of ctx.plants) if (!plant.eaten) plantGrid.insert(plant)
  for (const blob of active) blobGrid.insert(blob)
  const paths = new Map()
  // All intent queries read positions and velocities from the opening tick.
  for (const blob of active) {
    const wanted = improved ? improvedIntent(blob, ctx, config, plantGrid, blobGrid, timeLeft)
      : intent(blob, ctx, config, plantGrid, blobGrid)
    let motion
    if (improved) motion = steer(blob, wanted, seconds)
    else {
      const angle = blob.angle + clamp(turn(blob.angle, wanted), -2 * Math.PI * seconds, 2 * Math.PI * seconds)
      motion = { ...pathOf(blob, angle, blob.speedWorld, seconds), angle }
    }
    const path = { ...motion, spent: 0, blob }
    paths.set(blob.id, path)
    pathGrid.insert(path, path.x, path.y, path.x + path.dx, path.y + path.dy)
  }
  for (const path of paths.values()) path.blob.angle = path.angle

  const move = (path, t) => {
    const b = path.blob
    b.x = path.x + path.dx * t
    b.y = path.y + path.dy * t
  }
  // The walkthrough pays for the entire move before a blob can collect food or hunt.
  if (discreteCost) {
    for (const path of paths.values()) {
      const b = path.blob
      if (b.energy > 0 && b.returning && homeFraction(path) === 0) continue
      const moved = b.energy > 0
      b.energy = Math.max(0, b.energy - b.moveCost)
      if (b.energy > 0) continue
      if (moved) move(path, 1)
      kill(ctx, b, (ctx.tick + Number(moved)) * seconds, 'Energy depletion')
    }
  }

  const candidates = []
  const push = (t, kind, path, target = null) => {
    if (t == null || t > 1) return
    candidates.push({ t, kind, path, target, tie: random(config.seed, 7, ctx.day, ctx.tick, path.blob.id, target?.id ?? target?.blob?.id ?? 0) })
  }
  for (const path of paths.values()) {
    const b = path.blob
    if (!b.alive) continue
    if (b.returning) push(homeFraction(path), 0, path)
    if (b.credits >= 2) continue
    const endX = path.x + path.dx, endY = path.y + path.dy
    if (canEatPlants(b, config)) {
      for (const plant of plantGrid.near(path.x, path.y, b.r + 2, endX, endY)) {
        push(contact(path, plant, b.r + 2), 1, path, plant)
      }
    }
    if (!config.predation) continue
    for (const other of new Set(pathGrid.near(path.x, path.y, b.r + 50, endX, endY))) {
      if (canHunt(b, other.blob, config)) push(contact(path, other, b.r + other.blob.r), 2, path, other)
    }
  }
  candidates.sort((a, b) => a.t - b.t || Number(a.kind !== 0) - Number(b.kind !== 0) || a.tie - b.tie ||
    a.path.blob.id - b.path.blob.id || a.kind - b.kind)
  const charge = (path, t) => {
    const b = path.blob
    if (!b.alive || b.home) return false
    if (discreteCost) {
      move(path, t)
      return true
    }
    const debit = b.rate * seconds * (t - path.spent)
    if (b.energy <= debit) {
      const fraction = path.spent + b.energy / (b.rate * seconds)
      move(path, fraction)
      b.energy = 0
      kill(ctx, b, (ctx.tick + fraction) * seconds, 'Energy depletion')
      return false
    }
    b.energy -= debit
    path.spent = t
    move(path, t)
    return true
  }
  for (const { t, kind, path, target } of candidates) {
    const b = path.blob
    if ((kind !== 0 && b.credits >= 2) || !charge(path, t)) continue
    const time = (ctx.tick + t) * seconds
    if (kind === 0) {
      settleHome(ctx, b, time)
    } else if (kind === 1 && !target.eaten) {
      eat(ctx, config, b, target, time, 'plant')
    } else if (kind === 2 && charge(target, t)) {
      const victim = target.blob
      kill(ctx, victim, time, 'Predation', { target: b.id })
      eat(ctx, config, b, victim, time, 'prey')
    }
  }
  for (const path of paths.values()) {
    charge(path, 1)
    const b = path.blob
    b.velocityX = b.home ? 0 : path.dx / seconds
    b.velocityY = b.home ? 0 : path.dy / seconds
  }
  ctx.tick++
}

export function step(ctx, config, count = 1, skipIdle = false) {
  if (!ctx.scheduledAdjustments?.[ctx.nextAdjustment]) return advance(ctx, config, count, skipIdle)
  const end = ctx.tick + count
  while (ctx.scheduledAdjustments[ctx.nextAdjustment]?.tick <= end) {
    const edit = ctx.scheduledAdjustments[ctx.nextAdjustment]
    const result = advance(ctx, config, edit.tick - ctx.tick, skipIdle)
    if (result) return result
    applyScheduledAdjustments(ctx, config)
  }
  return advance(ctx, config, end - ctx.tick, skipIdle)
}

function advance(ctx, config, count, skipIdle) {
  if (ctx.settled) return ctx.settled
  config = effectiveSpecies(config, ctx)
  const limit = stepLimit(ctx, config)
  const stop = Math.min(limit, ctx.tick + count)
  const hasActive = () => ctx.blobs.some(b => b.alive && !b.home)
  const foraging = usesWalkthroughForaging(config)
  const dayRules = config.predation && !huntingOnDay(config, ctx.day) ? { ...config, predation: false } : config
  while (ctx.tick < stop) {
    if ((ctx.limit == null || skipIdle) && !hasActive()) {
      if (ctx.limit == null) break
      ctx.tick = stop
      break
    }
    if (foraging) forage(ctx, dayRules, settleHome, kill, eat)
    else tick(ctx, dayRules)
  }
  return ctx.tick === limit || (ctx.limit == null && !hasActive()) ? dusk(ctx, config) : null
}

function breed(ctx, config, time, settings, rules, first, second) {
  const { blob, survivor } = first
  const partner = second?.blob
  const { seed } = config
  const { day } = ctx
  const partnerId = partner?.id ?? 0
  if (rules.birthChance < 100 && random(seed, 45, day, blob.id, partnerId) * 100 >= rules.birthChance) return []
  const twins = rules.twinChance > 0 && random(seed, 46, day, blob.id, partnerId) * 100 < rules.twinChance
  if (usesReproductionRules(config)) {
    survivor.lastBirthDay = day
    if (second) second.survivor.lastBirthDay = day
  }
  const standard = usesStandardDeviation(config)
  const inheritance = usesReproductionRules(config) ? settings.inheritance ?? INHERITANCE_DEFAULTS : INHERITANCE_DEFAULTS
  const children = []
  for (let index = 0; index < (twins ? 2 : 1); index++) {
    const child = { id: ctx.nextId++, species: blob.species, parent: blob.id, age: 0, born: day,
      ...(partner && { secondParent: partner.id }), ...(survivor.edge && { edge: survivor.edge }) }
    for (const [traitIndex, trait] of TRAITS.entries()) {
      const inherited = partner ? (blob[trait] + partner[trait]) / 2 : blob[trait]
      child[trait] = inherited
      const chance = inheritance.mutationChance[trait]
      if (!settings.mutation[trait] ||
          (chance < 100 && random(seed, 47, day, child.id, traitIndex) * 100 >= chance)) continue
      const deviation = standard ? settings.standardDeviation[trait] : Math.sqrt(settings.variance[trait])
      const draw = inheritance.mutationPattern === 'bounded'
        ? Math.sqrt(3) * (2 * random(seed, 48, day, child.id, traitIndex) - 1)
        : normal(seed, day, child.id, traitIndex)
      const minimum = standard ? (trait === 'sense' ? 0 : MIN_POSITIVE_TRAIT) : 1
      child[trait] = Math.max(minimum, inherited + deviation * draw)
    }
    children.push(child)
    const newborn = { ...child, x: blob.x, y: blob.y, angle: blob.angle, r: radius(child.size),
      capacity: settings.energy, energy: settings.energy, credits: 0, preyCredits: 0, state: 7, alive: true }
    record(ctx, newborn, time, 'birth', { parent: blob.id, ...(partner && { secondParent: partner.id }) })
    ctx.newborns ??= []
    ctx.newborns.push(newborn)
  }
  return children
}

export function dusk(ctx, config) {
  if (ctx.settled) return ctx.settled
  config = effectiveSpecies(config, ctx)
  const closing = []
  const time = (ctx.limit ?? ctx.tick) * (ctx.stepSeconds ?? DT)
  const species = new Map(config.species.map(s => [s.id, s]))
  const foraging = usesWalkthroughForaging(config)
  const currentRules = usesReproductionRules(config)
  const rules = currentRules ? config.reproduction ?? REPRODUCTION_DEFAULTS : REPRODUCTION_DEFAULTS
  const breeding = advancedRuleEnabled(config, 'breeding')
  const candidates = breeding && rules.parentMode === 'pair' ? new Map() : null
  for (const b of ctx.blobs) {
    if (!b.alive) continue
    if (!b.home && ctx.refugeWidth && b.credits && b.energy > 0 && refugeDistance(b, ctx.refugeWidth) <= 1e-9) {
      settleHome(ctx, b, time)
    }
    if (!b.credits || !b.home) {
      kill(ctx, b, time, b.credits ? 'Missed home' : 'Starvation')
      continue
    }
    const attainedAge = ++b.age
    const settings = species.get(b.species)
    const risk = oldAgeRisk(agingRules(config, settings), attainedAge)
    if (risk > 0 && (risk === 100 || random(config.seed, 49, ctx.day, b.id) * 100 < risk)) {
      kill(ctx, b, time, 'Old age')
      continue
    }
    const survivor = { id: b.id, species: b.species, parent: b.parent, born: b.born,
      age: attainedAge, speed: b.speed, size: b.size, sense: b.sense }
    if (b.secondParent != null) survivor.secondParent = b.secondParent
    if (currentRules && b.lastBirthDay != null) survivor.lastBirthDay = b.lastBirthDay
    if (foraging && !ctx.refugeWidth) survivor.edge = b.target
    if (!foraging || candidates) closing.push(survivor)
    const eligible = breeding && b.credits >= 2 && b.age - 1 >= rules.minimumBreedingAge &&
      (survivor.lastBirthDay == null || ctx.day - survivor.lastBirthDay > rules.birthWait)
    if (eligible) {
      const parent = { blob: b, survivor }
      if (candidates) {
        if (!candidates.has(b.species)) candidates.set(b.species, [])
        candidates.get(b.species).push(parent)
      } else {
        closing.push(...breed(ctx, config, time, settings, rules, parent))
      }
    }
    if (foraging && !candidates) closing.push(survivor)
  }
  if (candidates) {
    for (const [id, group] of candidates) {
      // Give each eligible parent a seeded order independent of roster position.
      const order = group.map(parent => ({ parent, key: random(config.seed, 44, ctx.day, parent.blob.id) }))
      order.sort((a, b) => a.key - b.key || a.parent.blob.id - b.parent.blob.id)
      for (let i = 0; i + 1 < order.length; i += 2) {
        const a = order[i].parent, b = order[i + 1].parent
        const [first, second] = a.blob.id < b.blob.id ? [a, b] : [b, a]
        closing.push(...breed(ctx, config, time, species.get(id), rules, first, second))
      }
    }
  }
  ctx.events.sort((a, b) => a.time - b.time)
  ctx.settled = { summary: summaries(ctx.day, config, ctx.opening, closing, ctx.events, ctx.plants.length,
    ctx.plants.filter(p => !p.eaten).length, !!ctx.speciesEdits), checkpoint: { roster: closing, nextId: ctx.nextId,
      ...(ctx.foodWeb && { foodWeb: ctx.foodWeb }),
      ...(ctx.speciesEdits && { speciesEdits: ctx.speciesEdits }) } }
  return ctx.settled
}

export function snapshot(ctx) {
  const stepSeconds = ctx.stepSeconds ?? DT
  const time = ctx.tick * stepSeconds
  const duration = ctx.settled ? time : ctx.limit == null ? null : ctx.limit * stepSeconds
  return { day: ctx.day, time, duration, stepSeconds, nextId: ctx.nextId, refugeWidth: ctx.refugeWidth ?? 0,
    blobs: [...ctx.blobs, ...(ctx.newborns ?? [])], plants: ctx.plants.filter(p => !p.eaten), events: ctx.events,
    ...(ctx.foodWeb && { foodWeb: ctx.foodWeb }),
    ...(ctx.speciesEdits && { speciesEdits: ctx.speciesEdits }) }
}
