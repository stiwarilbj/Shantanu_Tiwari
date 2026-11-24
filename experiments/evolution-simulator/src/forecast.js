import { rulesFor } from './engine/config.js'
import { dawnForRun, step } from './engine/simulation.js'

export function forecastEndpoint(rows) {
  const end = rows.at(-1)?.day
  return rows.length >= 3 && rows.at(-2).day === end - 1 && rows.at(-3).day === end - 2 ? end : null
}

export function forecastCheckpoint(run, end) {
  return end === run.summaries.at(-1)?.day
    ? { day: end, ...run.latest }
    : run.checkpoints.findLast(point => point.day <= end)
}

export function simulateForecast({ setup, revisions, checkpoint, start, end, target, traitAdjustments }, progress = () => {}) {
  const summaries = []
  let through = start
  let lastProgress = performance.now()

  for (let day = start + 1; day <= target && checkpoint.roster.length; day++) {
    const rules = rulesFor(setup, revisions, day)
    const state = dawnForRun(setup, revisions, day, checkpoint, traitAdjustments)
    let result
    do {
      result = step(state, rules, 20, true)
      const now = performance.now()
      if (now - lastProgress >= 1000) {
        progress()
        lastProgress = now
      }
    } while (!result)
    checkpoint = result.checkpoint
    through = day
    if (day > end) summaries.push(result.summary)
  }
  return { summaries, through, checkpoint }
}

export function pairedForecastRows(left, right, map) {
  const length = Math.max(left.length, right.length)
  return Array.from({ length }, (_, index) => map(left[index], right[index]))
}
