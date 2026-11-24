import { usesAgingRules } from './config.js'

export const METRICS = [
  { key: 'population', label: 'Population', short: 'Population', unit: 'blobs', color: '#EEEDD6', petal: '#EEEDD6' },
  { key: 'age', label: 'Average Age', short: 'Age', unit: 'days', color: '#FDDE3B', heading: '#FADE69', petal: '#FDDE3B', inner: '#FEE97F', outer: '#FEF2B8' },
  { key: 'deathAge', label: 'Average Age at Death', short: 'Age at Death', unit: 'days', color: '#DDDAD0', heading: '#FFFDFC', petal: '#FFFDFC', inner: '#E9E6DF', outer: '#F3F1ED' },
  { key: 'speed', label: 'Average Speed', short: 'Speed', unit: 'points', color: '#E97167', heading: '#E78482', petal: '#D20F18', inner: '#F1A29B', outer: '#F7CCC8' },
  { key: 'size', label: 'Average Size', short: 'Size', unit: 'points', color: '#1CC1AA', heading: '#70BAAB', petal: '#1CC1AA', inner: '#6BD6C7', outer: '#B0E8DF' },
  { key: 'sense', label: 'Average Sense Range', short: 'Sense Range', unit: 'world units', color: '#07C7FB', heading: '#7EC1DF', petal: '#07C7FB', inner: '#5EDAFB', outer: '#A8EAFC' },
]
const legacyDeathCauses = ['Starvation', 'Missed home', 'Predation', 'Energy depletion']
export const DEATH_CAUSES = [...legacyDeathCauses, 'Old age']

export function distribution(values) {
  const n = values.length
  if (!n) return { n, mean: null, min: null, p25: null, p75: null, max: null, sd: null }
  values.sort((a, b) => a - b)
  const mean = values.reduce((sum, value) => sum + value / n, 0)
  const quantile = p => {
    const index = (n - 1) * p
    const lower = Math.floor(index)
    return values[lower] + (values[Math.ceil(index)] - values[lower]) * (index - lower)
  }
  const sd = n < 2 ? 0 : Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1))
  return { n, mean, min: values[0], p25: quantile(0.25), p75: quantile(0.75), max: values[n - 1], sd }
}

export function summaries(day, config, opening, closing, events, supply, plantsLeft, hasEdits) {
  const rows = {}
  const causes = usesAgingRules(config) ? DEATH_CAUSES : legacyDeathCauses
  for (const id of ['all', ...config.species.filter(s => s.enabled).map(s => s.id)]) {
    const belongs = item => id === 'all' || item.species === id
    const lives = closing.filter(belongs)
    const scoped = events.filter(belongs)
    const deaths = scoped.filter(event => event.type === 'death')
    const births = scoped.filter(event => event.type === 'birth').length
    const introduced = scoped.filter(event => event.type === 'introduced').length
    const transferredIn = id === 'all' ? 0 : scoped.filter(event => event.type === 'transferred').length
    const transferredOut = id === 'all' ? 0 : events.filter(event => event.type === 'transferred' && event.fromSpecies === id).length
    rows[id] = {
      day, opening: opening.filter(belongs).length, population: lives.length, births,
      deaths: deaths.length, net: births - deaths.length + introduced + transferredIn - transferredOut,
      ...(hasEdits && { introduced, transferredIn, transferredOut }), food: supply, plantsLeft,
      plants: scoped.filter(e => e.type === 'plant').length,
      hunts: scoped.filter(e => e.type === 'prey').length,
      causes: Object.fromEntries(causes
        .map(cause => [cause, deaths.filter(e => e.cause === cause).length])),
      age: distribution(lives.map(b => b.age)), deathAge: distribution(deaths.map(e => e.age)),
      speed: distribution(lives.map(b => b.speed)), size: distribution(lives.map(b => b.size)),
      sense: distribution(lives.map(b => b.sense)),
    }
  }
  return { day, rows }
}

export function metricValue(row, key) {
  return key === 'population' ? row?.population : row?.[key]?.mean
}

function difference(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) ? left - right : null
}

function rate(numerator, denominator, scale = 1) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? (numerator / denominator) * scale : null
}

export function survivalStats(row) {
  const { opening, population, births, deaths, causes, introduced, transferredIn, transferredOut } = row ?? {}
  const participants = opening + (introduced ?? 0) + (transferredIn ?? 0)
  return {
    opening, population, births, deaths, causes,
    ...(introduced != null && { introduced, transferredIn, transferredOut }),
    survivalRate: rate(difference(participants, deaths), participants, 100),
    growthRate: rate(difference(population, opening), opening, 100),
    birthRate: rate(births, opening, 100),
  }
}

export function traitSpread(sample) {
  return {
    ...sample,
    iqr: difference(sample?.p75, sample?.p25),
    sd: sample?.n >= 2 && Number.isFinite(sample.sd) ? sample.sd : null,
  }
}

export function foragingStats(row, field) {
  const { opening, plants, hunts } = row ?? {}
  const { food, plantsLeft } = field ?? {}
  return {
    opening, plants, hunts, food, plantsLeft,
    plantsPerStarter: rate(plants, opening),
    huntsPerStarter: rate(hunts, opening),
    fieldUse: rate(difference(food, plantsLeft), food, 100),
  }
}

const cohortKeys = ['age', 'speed', 'size', 'sense']

export function openingSummary({ day, rows }, previous, founders = []) {
  // Each day's opening roster is the preceding day's survivors and newborns.
  const scopes = Object.entries(rows).map(([scope, row]) => {
    const roster = previous ? [] : founders.filter(blob => scope === 'all' || blob.species === scope)
    const traits = Object.fromEntries(cohortKeys.map(key => [
      key, previous?.[scope]?.[key] ?? distribution(roster.map(blob => blob[key])),
    ]))
    return [scope, { ...row, ...traits, population: row.opening }]
  })
  return { day, rows: Object.fromEntries(scopes) }
}

export function openingTrends(run) {
  const founders = run.checkpoints.find(point => point.day === 0)?.roster ?? []
  return run.summaries.map((record, index) => openingSummary(record, run.summaries[index - 1]?.rows, founders))
}

export function runSpeedRange(run) {
  let min = Infinity, max = -Infinity
  for (const species of run.setup.species) if (species.enabled) {
    min = Math.min(min, species.speed)
    max = Math.max(max, species.speed)
  }
  for (const record of run.summaries) {
    const speed = record.rows.all?.speed
    if (!Number.isFinite(speed?.min) || !Number.isFinite(speed?.max)) continue
    min = Math.min(min, speed.min)
    max = Math.max(max, speed.max)
  }
  return { min, max }
}

const numberFormats = new Map()
export function format(value, digits = 2) {
  if (value == null) return '—'
  if (!numberFormats.has(digits)) numberFormats.set(digits, new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  }))
  return numberFormats.get(digits).format(value)
}
