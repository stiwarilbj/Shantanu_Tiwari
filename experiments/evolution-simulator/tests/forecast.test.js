import assert from 'node:assert/strict'
import test from 'node:test'
import { predict, predictDistribution } from '../src/forecast.js'

const rows = values => values.map((value, i) => ({ day:i+1, value }))
const read = row => row.value

test('prediction fits a recent slope and starts at the last visible observation', () => {
  const history = rows([800, 900, ...Array.from({ length:10 }, (_, index)=>index*2), 100])
  assert.deepEqual(predict(history.slice(0, -1), read, 3), [20, 22, 24])
  assert.deepEqual(predict(rows([1, 9, 5]), read, 2), [7, 9])
})

test('prediction requires three consecutive finite samples at the visible endpoint', () => {
  assert.deepEqual(predict(rows([1, 2]), read, 2), [])
  assert.deepEqual(predict(rows([1, 2, 3, null]), read, 2), [])
  assert.deepEqual(predict(rows([1, 2, 3, 4]).filter(row=>row.day!==2), read, 2), [])
  assert.deepEqual(predict(rows([1, 2, 3, null, 5, 6, 7]), read, 2), [8, 9])
})

test('prediction constrains counts and rates and preserves signed values', () => {
  assert.deepEqual(predict(rows([7, 4, 2]), read, 2, { integer:true }), [0, 0])
  assert.deepEqual(predict(rows([4, 6, 7]), read, 2, { integer:true }), [9, 10])
  assert.deepEqual(predict(rows([80, 90, 99]), read, 2, { max:100 }), [100, 100])
  assert.deepEqual(predict(rows([-3, -2, -1]), read, 2, { min:-Infinity,max:0 }), [0, 0])
  assert.deepEqual(predict(rows([2, 0, -2]), read, 2, { min:-Infinity }), [-4, -6])
  assert.deepEqual(predict(rows([10, 11, 12]), read, 2, { extinct: row=>row.day===3 }), [])
})

test('forecast quartiles and mean stay within the range as bounds cross', () => {
  const history = [0, 1, 2].map(i => ({
    day:i+1, min:1+4*i, p25:4+3*i, mean:10, p75:16-2*i, max:20-4*i, sd:3,
  }))
  const forecasts = predictDistribution(history, row=>row, 3)
  for (const { min, p25, mean, p75, max, upper, lower, sd } of forecasts) {
    assert.ok(min <= p25 && p25 <= p75 && p75 <= max)
    assert.ok(min <= mean && mean <= max)
    assert.equal(upper, Math.min(max, mean+sd))
    assert.equal(lower, Math.max(min, mean-sd))
  }
  assert.equal(predictDistribution(history, row=>({...row, sd:null}), 1)[0].upper, undefined)
})
