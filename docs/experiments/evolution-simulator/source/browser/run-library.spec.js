import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { summarizeRun } from '../src/archive.js'
import { LEGACY_RULE_VERSION, starter } from '../src/engine/config.js'
import { dawn, founders, step } from '../src/engine/simulation.js'

function recordedRun(id, name, seed) {
  const setup = { ...starter(LEGACY_RULE_VERSION), name, seed, food: 400, days: 10, mode: 'live' }
  let latest = founders(setup)
  const checkpoints = [{ day: 0, ...latest }]
  const summaries = []
  for (let day = 1; day <= 2; day++) {
    const state = dawn(setup, day, latest)
    let result
    while (!(result = step(state, setup, 60, true))) {}
    latest = result.checkpoint
    summaries.push(result.summary)
  }
  return { id, setup, created: seed, checkpoints, summaries, latest, revisions: [], partial: null }
}

async function seedLibrary(page, baseURL, version, extraRuns = 0) {
  const fixtureURL = new URL('./?run-library-fixture', baseURL).href
  await page.route(fixtureURL, route => route.fulfill({ contentType: 'text/html', body: '<title>Run library fixture</title>' }))
  await page.goto(fixtureURL)
  const runs = [recordedRun('active', 'Active field', 118), recordedRun('archived', 'Archived field', 119)]
  await page.evaluate(({ runs, summaries, version, extraRuns }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('evolution-simulator', version)
    open.onerror = () => reject(open.error)
    open.onupgradeneeded = () => {
      open.result.createObjectStore('runs', { keyPath: 'id' })
      if (version === 2) open.result.createObjectStore('runSummaries', { keyPath: 'id' })
    }
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction([...db.objectStoreNames], 'readwrite')
      const records = tx.objectStore('runs')
      const index = version === 2 ? tx.objectStore('runSummaries') : null
      for (const run of runs) records.put(run)
      for (const summary of summaries) index?.put(summary)
      // Give the extra archived rows enough checkpoint data to expose bulk reads.
      const checkpoints = Array.from({ length: 50 }, (_, n) => ({ ...structuredClone(runs[0].latest), day: n * 10 }))
      for (let n = 0; n < extraRuns; n++) {
        const id = 'extra-' + n
        const setup = { ...runs[0].setup, name: 'Extra field ' + n }
        records.put({ ...runs[0], id, setup, checkpoints })
        index?.put({ ...summaries[0], id, setup })
      }
      tx.onabort = () => { db.close(); reject(tx.error) }
      tx.oncomplete = () => {
        db.close()
        localStorage.setItem('evolution.active', 'active')
        localStorage.setItem('evolution.tour', '1')
        resolve()
      }
    }
  }), { runs, summaries: runs.map(summarizeRun), version, extraRuns })
}

async function holdLibraryReads(page, mode) {
  await page.addInitScript(mode => {
    const pending = []
    const reads = []
    const archive = window.archiveTest = {
      reads, pending,
      release() {
        archive.released = true
        for (const complete of pending.splice(0)) complete()
      },
    }
    for (const method of ['get', 'getAll', 'getAllKeys']) {
      const native = IDBObjectStore.prototype[method]
      IDBObjectStore.prototype[method] = function (...args) {
        reads.push({ store: this.name, method, key: args[0], mode: this.transaction.mode })
        return native.apply(this, args)
      }
    }
    const complete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...complete,
      set(callback) {
        const hold = this.mode === mode && this.objectStoreNames.contains('runSummaries')
        complete.set.call(this, hold ? event => {
          if (archive.released) callback.call(this, event)
          else pending.push(() => callback.call(this, event))
        } : callback)
      },
    })
  }, mode)
}

async function keyedReads(page) {
  const reads = await page.evaluate(() => window.archiveTest.reads)
  expect(reads.filter(read => read.store === 'runs' && read.method === 'getAll')).toEqual([])
  return reads.filter(read => read.store === 'runs' && read.method === 'get' && read.mode === 'readonly')
    .map(read => read.key)
}

async function openLibrary(page) {
  await page.getByRole('button', { name: 'Run options' }).click()
  await page.getByRole('button', { name: 'Run Library' }).click()
  return page.getByRole('dialog', { name: 'Run Library' })
}

async function storedRun(page, id) {
  return page.evaluate(id => new Promise((resolve, reject) => {
    const open = indexedDB.open('evolution-simulator')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(['runs', 'runHistory'], 'readonly')
      const record = tx.objectStore('runs').get(id)
      const history = tx.objectStore('runHistory').getAll(IDBKeyRange.bound([id, 0], [id, Infinity]))
      tx.onabort = () => { db.close(); reject(tx.error) }
      tx.oncomplete = () => {
        db.close()
        resolve({ record: record.result, history: history.result })
      }
    }
  }), id)
}

test('Quick Sim migrates one saved run and appends only new generation history @pages', async ({ page, baseURL }) => {
  await seedLibrary(page, baseURL, 2)
  await page.addInitScript(() => {
    window.historyWrites = []
    const { put } = IDBObjectStore.prototype
    IDBObjectStore.prototype.put = function (record, ...args) {
      if (this.name === 'runHistory') window.historyWrites.push([record.runId, record.day, record.kind])
      return put.call(this, record, ...args)
    }
  })
  await page.goto('./')
  const button = name => page.getByRole('button', { name, exact: true })
  const status = button('Run options')
  await expect(status).toHaveText('Day 3 / 10 · Ready')
  const active = await storedRun(page, 'active')
  const other = await storedRun(page, 'archived')
  expect(active.record.summaries).toHaveLength(2)
  expect(active.history).toEqual([])
  expect(other.history).toEqual([])

  async function completeThroughTen() {
    await button('Quick Sim').click()
    await button('Complete through day').click()
    await page.getByLabel('Target day').fill('10')
    await button('Simulate').click()
    const saved = page.getByRole('dialog').locator('dt').filter({ hasText: /^Saved through$/ })
      .locator('xpath=following-sibling::dd[1]')
    await expect(saved).toHaveText('Day 10')
    await button('Close').click()
  }
  await completeThroughTen()

  const { record, history } = await storedRun(page, 'active')
  expect(record.summaries).toBeUndefined()
  expect(record.checkpoints).toBeUndefined()
  const summaries = history.filter(row => row.kind === 'summaries').map(row => row.value)
  const checkpoints = history.filter(row => row.kind === 'checkpoints').map(row => row.value)
  expect(summaries.slice(0, 2)).toEqual(active.record.summaries)
  expect(summaries.map(row => row.day)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1))
  expect(checkpoints.map(row => row.day)).toEqual([0, 10])
  expect(checkpoints[0]).toEqual(active.record.checkpoints[0])
  expect(checkpoints[1]).toEqual({ day: 10, ...record.latest })
  const writes = await page.evaluate(() => window.historyWrites)
  expect(writes).toHaveLength(history.length)
  expect(new Set(writes.map(key => JSON.stringify(key)))).toEqual(new Set(
    history.map(row => JSON.stringify([row.runId, row.day, row.kind])),
  ))
  expect(await storedRun(page, 'archived')).toEqual(other)

  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()
  async function exportResults() {
    await button('Download').click()
    const downloaded = page.waitForEvent('download')
    await page.getByRole('dialog', { name: 'Download' }).getByRole('button', { name: 'Download' }).click()
    return readFile(await (await downloaded).path(), 'utf8')
  }
  const results = await exportResults()
  await page.reload()
  await expect(status).toHaveText('Day 10 / 10 · Replay')
  await expect(trends).toHaveAttribute('aria-current', 'page')
  expect(await exportResults()).toBe(results)
  expect(await page.evaluate(() => window.historyWrites)).toEqual([])

  await status.click()
  await button('Branch here').click()
  await page.getByLabel('Branch after day').fill('9')
  await page.getByLabel('Plants per day').fill(String(active.record.setup.food))
  await button('Create branch').click()
  await expect(status).toHaveAccessibleDescription('Active field · branch')
  const branchId = await page.evaluate(() => localStorage.getItem('evolution.active'))
  await completeThroughTen()
  const branch = await storedRun(page, branchId)
  expect(branch.record.source).toBe('active')
  expect(branch.record.forkDay).toBe(9)
  expect(branch.history.filter(row => row.kind === 'checkpoints').map(row => row.day)).toEqual([0, 9, 10])
  expect(branch.history.filter(row => row.kind === 'summaries').map(row => row.value)).toEqual(summaries)
  expect(await storedRun(page, 'active')).toEqual({ record, history })
})

test('an aborted run save rolls back all records and a stale writer keeps its own history', async ({ page, baseURL }) => {
  await seedLibrary(page, baseURL, 2)
  const fixture = new URL('./archive-module.js', baseURL).href
  const source = await readFile(new URL('../src/archive.js', import.meta.url), 'utf8')
  await page.route(url => url.href.startsWith(fixture), route => route.fulfill({ contentType: 'text/javascript', body: source }))
  const report = await page.evaluate(async fixture => {
    const one = await import(fixture + '?first')
    const two = await import(fixture + '?second')
    const original = await one.readRun('active')
    const { put } = IDBObjectStore.prototype
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args)
      if (this.name === 'runSummaries') this.transaction.abort()
      return result
    }
    let aborted
    try {
      await one.saveRun({ ...original, bookmarks: [1] })
      aborted = false
    } catch {
      aborted = true
    } finally {
      IDBObjectStore.prototype.put = put
    }
    const rollback = await storedSnapshot()
    await one.saveRun(original)
    const left = await one.readRun('active')
    const right = await two.readRun('active')
    // The two pages can commit different days after editing the same live generation.
    const next = (run, day, marker) => ({
      ...run, summaries: [...run.summaries, { ...run.summaries.at(-1), day, marker }],
    })
    await one.saveRun(next(next(left, 3, 'left'), 4, 'left'))
    await two.saveRun(next(right, 3, 'right'))
    const winner = await one.readRun('active')
    return { aborted, rollback, original, winner }
    async function storedSnapshot() {
      const run = await one.readRun('active')
      const library = await one.readLibrary()
      return { run, savedThrough: library.summaries.find(item => item.id === 'active').savedThrough }
    }
  }, fixture)
  expect(report.aborted).toBe(true)
  expect(report.rollback).toEqual({ run: report.original, savedThrough: 2 })
  expect(report.winner.summaries.slice(0, 2)).toEqual(report.original.summaries)
  expect(report.winner.summaries.slice(2).map(({ day, marker }) => [day, marker])).toEqual([[3, 'right']])
  expect((await storedRun(page, 'active')).history.map(row => row.day)).toEqual([0, 1, 2, 3])
})

test('direct replay opens a version 1 save before the legacy library finishes indexing @pages', async ({ page, baseURL }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await seedLibrary(page, baseURL, 1, 18)
  await holdLibraryReads(page, 'readwrite')
  await page.goto('./#/r/archived/s/2/viewer')

  const status = page.getByRole('button', { name: 'Run options' })
  await expect(status).toHaveAccessibleDescription('Archived field')
  await expect(status).toHaveText('Day 2 / 10 · Replay')
  const library = await openLibrary(page)
  await expect(library.getByText('Loading saved runs…')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.archiveTest.pending.length)).toBe(1)
  expect(await keyedReads(page)).toEqual(['archived'])

  await page.evaluate(() => window.archiveTest.release())
  await expect(library.getByText('Loading saved runs…')).toBeHidden()
  await expect(library.locator('article')).toHaveCount(20)
  const other = library.locator('article').filter({ hasText: 'Active field' })
  await expect(other).toContainText('Saved through Day 2')
  await other.getByRole('button', { name: 'Resume' }).click()
  await expect(status).toHaveAccessibleDescription('Active field')
  await expect(status).toHaveText('Day 3 / 10 · Ready')
  await expect(page).toHaveURL(/#\/r\/active\/s\/3\/viewer$/)
  expect(await keyedReads(page)).toEqual(['archived', 'active'])

  await page.goto('./?reopen')
  await expect(status).toHaveAccessibleDescription('Active field')
  await expect(status).toHaveText('Day 3 / 10 · Ready')
  const reopened = await openLibrary(page)
  await expect(reopened.locator('article')).toHaveCount(20)
  expect(await keyedReads(page)).toEqual(['active'])
  expect(await page.evaluate(() => window.archiveTest.pending.length)).toBe(0)
  expect(errors).toEqual([])
})

test('opening a large run library reads only summaries and loads another run on demand @pages', async ({ page, baseURL }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await seedLibrary(page, baseURL, 2, 96)
  await holdLibraryReads(page, 'readonly')
  await page.goto('./#/r/missing/s/3/viewer')

  const status = page.getByRole('button', { name: 'Run options' })
  await expect(status).toHaveAccessibleDescription('Active field')
  await expect(status).toHaveText('Day 3 / 10 · Ready')
  await expect(page).toHaveURL(/#\/r\/active\/s\/3\/viewer$/)
  const library = await openLibrary(page)
  await expect(library.getByText('Loading saved runs…')).toBeVisible()
  expect(await keyedReads(page)).toEqual(['missing', 'active'])

  const active = library.locator('article').filter({ hasText: 'Active field' })
  await active.getByRole('button', { name: 'Actions' }).click()
  await active.getByRole('button', { name: 'Rename' }).click()
  await active.getByLabel('Name', { exact: true }).fill('Renamed field')
  await active.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(library.getByText('Renamed field', { exact: true })).toBeVisible()

  await page.evaluate(() => window.archiveTest.release())
  await expect(library.locator('article')).toHaveCount(98)
  await expect(library.getByText('Renamed field', { exact: true })).toBeVisible()
  expect(await keyedReads(page)).toEqual(['missing', 'active'])

  await library.getByRole('searchbox').fill('Archived field')
  await expect(library.locator('article')).toHaveCount(1)
  await library.getByRole('button', { name: 'Resume' }).click()
  await expect(status).toHaveAccessibleDescription('Archived field')
  await expect(status).toHaveText('Day 3 / 10 · Ready')
  await expect(page).toHaveURL(/#\/r\/archived\/s\/3\/viewer$/)
  await page.goBack()
  await expect(status).toHaveAccessibleDescription('Renamed field')
  expect(await keyedReads(page)).toEqual(['missing', 'active', 'archived', 'active'])

  const reopened = await openLibrary(page)
  const archived = reopened.locator('article').filter({ hasText: 'Archived field' })
  await archived.getByRole('button', { name: 'Actions' }).click()
  await archived.getByRole('button', { name: 'Delete', exact: true }).click()
  await archived.getByRole('button', { name: 'Delete run' }).click()
  await expect(archived).toHaveCount(0)
  expect(await keyedReads(page)).toEqual(['missing', 'active', 'archived', 'active'])
  expect(errors).toEqual([])
})

test('a direct comparison keeps both saved days while library summaries are still loading', async ({ page, baseURL }) => {
  await seedLibrary(page, baseURL, 2)
  await holdLibraryReads(page, 'readonly')
  await page.goto('./#/r/active/s/3/compare?left=active&right=archived&pairDay=1&leftDay=1&rightDay=2')
  const results = page.getByRole('heading', { name: 'Day 1 vs Day 2 results' })
  await expect(results).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Shared day progress' })).toBeEnabled()
  expect(await keyedReads(page)).toEqual(['active', 'archived'])
  await page.evaluate(() => window.archiveTest.release())
  await expect(page.getByRole('combobox', { name: 'Right run' })).toHaveValue('archived')
  await expect(results).toBeVisible()
  expect(await keyedReads(page)).toEqual(['active', 'archived'])
})
