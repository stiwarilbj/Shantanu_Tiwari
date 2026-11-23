import { reactive, readonly } from 'vue'

const storageKey = 'evolution-simulator:graph-predictions'
export const maxForecastCycles = 25
export const validForecastCycles = value => Number.isInteger(value) && value >= 1 && value <= maxForecastCycles

function readPreferences() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(storageKey)) ?? {}
  } catch {
    return {}
  }
}

const saved = readPreferences()
const preferences = reactive({
  enabled: saved.enabled !== false,
  cycles: validForecastCycles(saved.cycles) ? saved.cycles : 5,
})
export const forecastPreferences = readonly(preferences)

export function setForecastPreferences(update) {
  Object.assign(preferences, update)
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    // The settings still work for this session if the browser blocks storage.
  }
}
