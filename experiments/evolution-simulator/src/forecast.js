const WINDOW = 10

export function predict(rows, value, cycles, { min = 0, max = Infinity, integer = false, extinct } = {}) {
  const latest = rows.at(-1)
  if (!latest || extinct?.(latest)) return []
  const values = []
  for (let index = rows.length - 1; index >= 0 && values.length < WINDOW; index--) {
    const row = rows[index]
    const sample = value(row)
    if (row.day !== latest.day - values.length || !Number.isFinite(sample)) break
    values.push(sample)
  }
  if (values.length < 3) return []

  // Fit a slope in generation units, then start the line at the last measured value.
  const midpoint = (values.length - 1) / 2
  let covariance = 0, variance = 0
  for (const [index, sample] of values.entries()) {
    const distance = midpoint - index
    covariance += distance * (sample - values[0])
    variance += distance ** 2
  }
  const slope = covariance / variance
  return Array.from({ length: cycles }, (_, index) => {
    const estimate = values[0] + slope * (index + 1)
    return Math.min(max, Math.max(min, integer ? Math.round(estimate) : estimate))
  })
}

export function predictDistribution(rows, read, cycles) {
  const bounds = ['min', 'p25', 'p75', 'max']
  const fields = [...bounds, 'mean', 'sd']
  const forecasts = fields.map(key => predict(rows, row => read(row)?.[key], cycles))
  return Array.from({ length: cycles }, (_, index) => {
    const sample = Object.fromEntries(fields.map((key, i) => [key, forecasts[i][index] ?? null]))
    const available = bounds.filter(key => sample[key] != null)
    const ordered = available.map(key => sample[key]).sort((a, b) => a - b)
    available.forEach((key, i) => { sample[key] = ordered[i] })
    if (sample.mean != null) {
      sample.mean = Math.min(sample.max ?? Infinity, Math.max(sample.min ?? 0, sample.mean))
      if (sample.sd != null) {
        sample.upper = Math.min(sample.max ?? Infinity, sample.mean + sample.sd)
        sample.lower = Math.max(sample.min ?? 0, sample.mean - sample.sd)
      }
    }
    return sample
  })
}
