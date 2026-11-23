import { TERRITORY_DEFAULTS, TERRITORY_EDGES, usesTerritoryRules } from './config.js'
import { clamp, FIELD, radius } from './geometry.js'
import { random, shuffle } from './random.js'

export const territoryFor = (config, species) => species?.territory ?? config.territories ?? TERRITORY_DEFAULTS

// Keep the whole band on the edge by shifting it inward near a corner.
const bandStartFraction = ({ center, width }) => clamp(2 * center - width, 0, 200 - 2 * width) / 200

function samePlacement(current, previous) {
  return current.width === previous.width && bandStartFraction(current) === bandStartFraction(previous) &&
    current.edges.length === previous.edges.length && current.edges.every(edge => previous.edges.includes(edge))
}

function shouldPlace(config, day, previous) {
  if (!usesTerritoryRules(config) || !config.territories?.enabled) return false
  const activeSpecies = config.species.filter(species => species.enabled)
  if (activeSpecies.every(species => samePlacement(territoryFor(config, species), TERRITORY_DEFAULTS))) return false
  if (config.territories.timing === 'daily' || day === 1) return true
  if (config === previous) return false
  if (!usesTerritoryRules(previous) || !previous.territories?.enabled || previous.territories.timing !== config.territories.timing) return true
  return activeSpecies.some(species => !samePlacement(territoryFor(config, species),
    territoryFor(previous, previous.species.find(item => item.id === species.id))))
}

export function startingPose(blob, edge, along, refugeWidth, seed, day) {
  const inset = refugeWidth ? Math.min(refugeWidth, blob.r + 2) : blob.r + 2
  const [x, y, inward] = [[inset, along, 0], [FIELD - inset, along, Math.PI],
    [along, inset, Math.PI / 2], [along, FIELD - inset, -Math.PI / 2]][edge]
  return { x, y, angle: inward + (random(seed, 4, day, blob.id) - 0.5) * Math.PI / 6 }
}

export function territoryPositions(config, day, previous, roster, refugeWidth) {
  if (!shouldPlace(config, day, previous)) return null
  const grouped = new Map(config.species.map(species => [species.id, []]))
  for (const blob of roster) grouped.get(blob.species).push(blob)
  const positions = new Map()
  const margin = refugeWidth + 6
  const usable = FIELD - 2 * margin
  const edgeOrder = shuffle(TERRITORY_EDGES, config.seed, day, 50)
  for (const species of config.species) {
    const placement = territoryFor(config, species)
    const { edges, width } = placement
    const selected = edgeOrder.filter(edge => edges.includes(edge))
    const bandWidth = usable * width / 100
    const bandStart = margin + usable * bandStartFraction(placement)
    const cohort = shuffle(grouped.get(species.id), config.seed, day, 51)
    for (const [index, blob] of cohort.entries()) {
      const side = index % selected.length
      const slot = Math.floor(index / selected.length)
      const slots = Math.ceil((cohort.length - side) / selected.length)
      const along = bandStart + bandWidth * (slot + 0.1 + random(config.seed, 52, day, blob.id) * 0.8) / slots
      const edge = ['left', 'right', 'top', 'bottom'].indexOf(selected[side])
      positions.set(blob.id, startingPose({ id: blob.id, r: radius(blob.size) }, edge, along, refugeWidth, config.seed, day))
    }
  }
  return positions
}

export function startingEdge({ x, y }) {
  const distances = [y, FIELD - x, FIELD - y, x]
  return TERRITORY_EDGES[distances.indexOf(Math.min(...distances))]
}
