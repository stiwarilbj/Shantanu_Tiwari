import { shuffle } from './random.js'

export const PLANT_FOOD_TYPES = [
  { id: 'seeds', label: 'Seeds', color: '#83a51e' },
  { id: 'berries', label: 'Berries', color: '#bf3f86' },
  { id: 'mushrooms', label: 'Mushrooms', color: '#c87d29' },
]
const allTypes = Object.freeze(PLANT_FOOD_TYPES.map(type => type.id))
export const DEFAULT_PLANT_FOODS = Object.freeze({
  enabled: false, weights: Object.freeze([1, 1, 1]), diets: Object.freeze({}),
})

export const validFoodWeight = value => Number.isInteger(value) && value >= 0 && value <= 100
export function validPlantFoods(foods) {
  return !!foods && typeof foods.enabled === 'boolean' &&
    Array.isArray(foods.weights) && foods.weights.length === allTypes.length &&
    [...foods.weights].every(validFoodWeight) && (!foods.enabled || foods.weights.some(Boolean)) &&
    !!foods.diets && typeof foods.diets === 'object' && !Array.isArray(foods.diets) &&
    Object.entries(foods.diets).every(([id, types]) => id && Array.isArray(types) &&
      new Set(types).size === types.length && [...types].every(type => allTypes.includes(type)))
}

export const plantDietFor = (foods, id) => Object.hasOwn(foods.diets, id) ? foods.diets[id] : allTypes

export function plantFoodCounts(weights, count) {
  const sum = weights.reduce((total, weight) => total + weight, 0)
  if (!sum) return weights.map(() => 0)
  const products = weights.map(weight => weight * count)
  const counts = products.map(product => Math.floor(product / sum))
  const remaining = count - counts.reduce((total, amount) => total + amount, 0)
  // Assign spare portions by the largest fractional remainders, with fixed tie order.
  const order = products.map((_, index) => index).sort((a, b) => products[b] % sum - products[a] % sum || a - b)
  for (const index of order.slice(0, remaining)) counts[index]++
  return counts
}

export function assignPlantFoods(plants, weights, seed, day) {
  const shuffled = shuffle(plants, seed, day, 65)
  let offset = 0
  for (const [index, count] of plantFoodCounts(weights, plants.length).entries()) {
    for (let n = 0; n < count; n++) shuffled[offset++].type = allTypes[index]
  }
}
