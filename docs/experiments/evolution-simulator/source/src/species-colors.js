import { PALETTE } from './engine/config.js'

export const starterBlueDisplay = '#365E85'

export function speciesDisplayColor(species) {
  return species.id === 'blue' && species.color === PALETTE[0] ? starterBlueDisplay : species.color
}
