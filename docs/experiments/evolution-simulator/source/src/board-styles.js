import { reactive, readonly } from 'vue'

const storageKey = 'evolution-simulator:board-styles'
export const boardStyleRange = { min: 50, max: 200, step: 5 }
export const defaultBoardStyles = { blobSize: 115, foodSize: 75 }

function validSize(value) {
  const { min, max, step } = boardStyleRange
  return Number.isInteger(value) && value >= min && value <= max && (value - min) % step === 0
}

function readStyles() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(storageKey)) ?? {}
  } catch {
    return {}
  }
}

const saved = readStyles()
const styles = reactive({
  blobSize: validSize(saved.blobSize) ? saved.blobSize : defaultBoardStyles.blobSize,
  foodSize: validSize(saved.foodSize) ? saved.foodSize : defaultBoardStyles.foodSize,
})
export const boardStyles = readonly(styles)
const validColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
const colorKey = (runId, speciesId) => JSON.stringify([runId, speciesId])
const speciesColors = reactive(Object.fromEntries(
  Object.entries(saved.speciesColors ?? {}).filter(([key, value]) => key.startsWith('[') && validColor(value))
))

function saveStyles() {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify({ ...styles, speciesColors }))
  } catch {
    // The controls still work for this session if storage is unavailable.
  }
}

export function setBoardStyles(update) {
  for (const key of Object.keys(defaultBoardStyles)) {
    if (validSize(update[key])) styles[key] = update[key]
  }
  saveStyles()
}

export function speciesColorOverride(runId, speciesId) {
  return runId == null ? undefined : speciesColors[colorKey(runId, speciesId)]
}

export function setSpeciesColorOverride(runId, speciesId, color) {
  const key = colorKey(runId, speciesId)
  if (color === null) delete speciesColors[key]
  else if (validColor(color)) speciesColors[key] = color.toLowerCase()
  else return
  saveStyles()
}
