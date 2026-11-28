import { PALETTE } from './engine/config.js'
import { speciesColorOverride } from './board-styles.js'

export const starterBlueDisplay = '#365E85'

export function speciesDisplayColor(species) {
  return species.id === 'blue' && species.color === PALETTE[0] ? starterBlueDisplay : species.color
}

export function boardSpeciesColor(species, runId) {
  return speciesColorOverride(runId, species.id) ?? speciesDisplayColor(species)
}
