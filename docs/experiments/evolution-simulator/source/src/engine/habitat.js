import { plantsForDay, usesHabitatRules, usesRefugeBorder, usesWalkthroughForaging } from './config.js'
import { FIELD, REFUGE_WIDTH } from './geometry.js'
import { random } from './random.js'

export function openingHabitat(config, day) {
  const custom = usesHabitatRules(config)
  const refugeWidth = custom ? FIELD * config.refugePercent / 100 : usesRefugeBorder(config) ? REFUGE_WIDTH : 0
  const margin = refugeWidth ? refugeWidth + 2 : usesWalkthroughForaging(config) ? 0 : 12
  const width = FIELD - 2 * margin
  const count = plantsForDay(config, day)
  if (!custom || config.foodPlacement === 'scattered') {
    const plants = Array.from({ length: count }, (_, id) => ({
      id, x: margin + width * random(config.seed, 5, day, id, 0),
      y: margin + width * random(config.seed, 5, day, id, 1), eaten: false,
    }))
    return { refugeWidth, plants, patches: [] }
  }

  const radius = config.patchRadius
  const epoch = config.patchRelocation === 'interval' ? Math.floor((day - 1) / config.patchInterval) : 0
  const span = width - 2 * radius
  const patches = Array.from({ length: config.patchCount }, (_, index) => ({
    x: margin + radius + span * random(config.seed, 42, epoch, index, 0),
    y: margin + radius + span * random(config.seed, 42, epoch, index, 1),
    radius,
  }))
  const plants = Array.from({ length: count }, (_, id) => {
    const center = patches[id % patches.length]
    // The square root spreads the plants evenly over the area of each circle.
    const distance = radius * Math.sqrt(random(config.seed, 43, day, id, 0))
    const angle = 2 * Math.PI * random(config.seed, 43, day, id, 1)
    return { id, x: center.x + distance * Math.cos(angle), y: center.y + distance * Math.sin(angle), eaten: false }
  })
  return { refugeWidth, plants, patches }
}
