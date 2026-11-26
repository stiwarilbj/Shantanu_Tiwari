import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { LEGACY_RULE_VERSION, REFUGE_RULE_VERSION, starter, WALKTHROUGH_RULE_VERSION } from '../src/engine/config.js'
import { setupFromLink } from '../src/export.js'
import { guideSource } from '../src/guide-replay.js'

async function openSimulator(page) {
  await page.addInitScript(() => localStorage.setItem('evolution.tour', '1'))
  await page.goto('./')
}

async function startRun(page, days = '10', configure) {
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await page.getByLabel('Run name').fill('Browser test run')
  await page.getByRole('spinbutton', { name: 'Days to run' }).fill(days)
  await configure?.()
  await page.getByRole('button', { name: 'Basic', exact: true }).click()
  await page.getByRole('button', { name: /^Watch live/ }).click()
  await page.getByRole('button', { name: 'Evolve!' }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText(`Day 1 / ${days} · Ready`)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
}

async function advancedSettings(page, group = 'Plant supply') {
  const advanced = page.getByRole('button', { name: 'Advanced', exact: true })
  if (await advanced.getAttribute('aria-pressed') !== 'true') await advanced.click()
  const sibling = page.getByRole('navigation', { name: / topics$/ }).getByRole('button', { name: group, exact: true })
  if (await sibling.count()) {
    await sibling.click()
    return
  }
  const categories = page.getByRole('navigation', { name: 'Advanced settings categories' })
  if (await categories.count() === 0) await page.getByRole('button', { name: 'All categories' }).click()
  await categories.getByRole('button', { name: group, exact: true }).click()
}

async function fixedDay(page, seconds = '10') {
  await advancedSettings(page, 'Day length')
  await page.getByRole('combobox', { name: 'End each day' }).selectOption('timed')
  await page.getByRole('spinbutton', { name: 'Seconds per day', exact: true }).fill(seconds)
  await page.getByRole('button', { name: 'Basic', exact: true }).click()
}

async function stepTo(page, seconds) {
  await page.getByRole('button', { name: 'Playback actions' }).click()
  await page.getByRole('button', { name: 'Step one tick', exact: true }).click()
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeCloseTo(seconds)
}

async function savedManualProgress(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('evolution-simulator')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const transaction = db.transaction('runs', 'readonly')
      const get = transaction.objectStore('runs').get(localStorage.getItem('evolution.active'))
      transaction.onabort = () => { db.close(); reject(transaction.error) }
      transaction.oncomplete = () => {
        db.close()
        const run = get.result
        resolve(run && { tick: run.partial?.tick ?? null, days: run.summaries.map(row => row.day) })
      }
    }
  }))
}

async function quickThrough(page, day, trigger = 'Quick Sim') {
  await page.getByRole('button', { name: trigger, exact: true }).click()
  await page.getByRole('button', { name: 'Complete through day' }).click()
  await page.getByLabel('Target day').fill(String(day))
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
}

function batchStatus(page, label) {
  return page.getByRole('dialog').locator('dt').filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]')
}

function dayTile(page, day) {
  return page.getByRole('button', { name: new RegExp(`^Day ${day}, population`) })
}

async function openRunLibrary(page) {
  await page.getByRole('button', { name: 'Run options' }).click()
  await page.getByRole('button', { name: 'Run Library' }).click()
}

async function startRefugeFixture(page, configure) {
  const setup = { ...starter(REFUGE_RULE_VERSION), name:'Browser test run', days:10, mode:'live' }
  configure?.(setup)
  await openRunLibrary(page)
  await page.getByRole('dialog', { name:'Run Library' }).locator('input[type=file]').setInputFiles({
    name:'refuge-rules.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(setup)),
  })
  await page.getByRole('button', { name:'Evolve!' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 1 / 10 · Ready')
}

function historicalCohort(setup) {
  setup.endMode = 'timed'
  setup.food = 400
  Object.assign(setup.species[1], { enabled:true, energy:1000 })
}

async function fieldColors(page, canvas) {
  const screenshot = await canvas.screenshot({ scale:'css' })
  return page.evaluate(async encoded => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + encoded
    await image.decode()
    const sample = document.createElement('canvas')
    sample.width = image.width
    sample.height = image.height
    const ctx = sample.getContext('2d')
    ctx.drawImage(image, 0, 0)
    // World overhead keeps 600 field units in the shorter canvas dimension.
    const scale = Math.min(image.width, image.height) / 600
    const tone = (x, y) => {
      const pixels = ctx.getImageData(
        Math.round(image.width / 2 + x * scale) - 2, Math.round(image.height / 2 + y * scale) - 2, 5, 5).data
      return Array.from({ length:25 }, (_, i) => pixels[4 * i]).sort((a,b) => a - b)[12]
    }
    return {
      sides: [[-225,0],[0,-225],[225,0],[0,225]].map(([x,y]) => tone(x,y)),
      corners: [[-225,-225],[225,-225],[225,225],[-225,225]].map(([x,y]) => tone(x,y)),
      interior: tone(0,0),
    }
  }, screenshot.toString('base64'))
}

async function installSaveDelay(page) {
  await page.addInitScript(() => {
    const onComplete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')
    const saves = window.saveTest = { hold: false, pending: [] }
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...onComplete,
      set(handler) {
        onComplete.set.call(this, event => {
          if (saves.hold && this.mode === 'readwrite') saves.pending.push(() => handler.call(this, event))
          else handler.call(this, event)
        })
      },
    })
  })
}

async function releaseSaves(page) {
  await page.evaluate(() => {
    const saves = window.saveTest
    saves.hold = false
    for (const release of saves.pending.splice(0)) release()
  })
}

async function addFoodPoint(page, day, plants) {
  await page.getByRole('button', { name: 'Add point', exact: true }).click()
  const row = page.locator('.schedule-row').last()
  await row.getByRole('spinbutton', { name: 'Day', exact: true }).fill(String(day))
  await row.getByRole('spinbutton', { name: 'Plants', exact: true }).fill(String(plants))
}

async function delayReplays(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const jobs = new Map()
    const received = []
    window.replayTest = { jobs, received }
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (data.type !== 'replay') return super.postMessage(data)
        const receive = event => {
          if (event.data.type === 'replay-progress') return
          received.push(event.data.day ?? data.day)
          this.removeEventListener('message', receive)
        }
        jobs.set(data.day, {
          release: () => {
            this.addEventListener('message', receive)
            super.postMessage(data)
          },
          progress: () => this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'replay-progress', id: data.id },
          })),
          fail: () => this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'error', id: data.id, message: 'Replay unavailable' },
          })),
        })
      }
    }
  })
}

async function finishReplay(page, day, action = 'release') {
  await expect.poll(() => page.evaluate(day => window.replayTest.jobs.has(day), day)).toBe(true)
  await page.evaluate(({ day, action }) => {
    const job = window.replayTest.jobs.get(day)
    window.replayTest.jobs.delete(day)
    job[action]()
  }, { day, action })
  if (action === 'release') {
    await expect.poll(() => page.evaluate(day => window.replayTest.received.includes(day), day)).toBe(true)
  }
}

test('the production build runs a new experiment and shows its charts @pages', async ({ page, context, request, baseURL }) => {
  test.setTimeout(90000)
  const app = new URL(baseURL)
  const problems = []
  page.on('pageerror', error => problems.push(error.message))
  const isAppRequest = address => address.startsWith(app.href)
  context.on('response', response => {
    if (isAppRequest(response.url()) && !response.ok() && response.status() >= 400) problems.push(response.url())
  })
  context.on('requestfailed', failed => {
    if (isAppRequest(failed.url())) problems.push(failed.url())
  })
  if (process.env.PAGES_URL) {
    const built = await readFile(new URL('../../../docs/experiments/evolution-simulator/index.html', import.meta.url), 'utf8')
    const entry = built.match(/<script type="module"[^>]* src="([^"]+)"/)?.[1]
    expect(entry).toBeTruthy()
    await expect.poll(async () => (await request.get('./')).text(), { timeout: 45000 }).toContain(entry)
  }
  await openSimulator(page)
  await expect(page.getByRole('heading', { name: 'Current Generation Stats' })).toBeVisible()
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Random seed' }).fill('118')
    await advancedSettings(page, 'Inheritance & mutation')
    const size = page.getByRole('spinbutton', { name: 'σ Size', exact: true })
    const sizeRow = page.locator('.inheritance-trait').filter({ has: size })
    await size.fill('1.00')
    await expect(sizeRow.getByText('Variance (σ²) = 1', { exact: true })).toBeVisible()
    await size.fill('0.50')
    await expect(sizeRow.getByText('Variance (σ²) = 0.25', { exact: true })).toBeVisible()
    await advancedSettings(page, 'Day length')
    await expect(page.getByRole('combobox', { name: 'End each day' })).toHaveValue('settled')
    await advancedSettings(page, 'Movement and energy')
    await expect(page.getByRole('spinbutton', { name: 'Plant reward' })).toHaveValue('0')
    await expect(page.getByRole('spinbutton', { name: 'Prey reward' })).toHaveValue('0')
    await advancedSettings(page, 'Hunting')
    await expect(page.getByRole('spinbutton', { name: 'Minimum hunting size advantage' })).toHaveValue('25')
  })
  await quickThrough(page, 3)
  await expect(page.getByRole('heading', { name: 'Simulation complete' })).toBeVisible()
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.getByText(/Browser test run .* Through Day 3/)).toBeVisible()
  await expect(page.locator('.trends canvas').first()).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(app.pathname)
  expect(problems).toEqual([])
})

test('the four gray home sides and corners stay visible during replay and in Canvas @pages', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await expect(page).toHaveTitle('Evolution Simulator')
  await startRun(page)
  const field = page.getByRole('region', { name:'Simulation field' })
  const canvas = field.locator('canvas.world-canvas')
  const overhead = async () => {
    await page.getByRole('button', { name:'View options' }).click()
    await page.getByRole('button', { name:/^Overhead/ }).click()
  }
  const painted = { sides:[229,229,229,229], corners:[229,229,229,229], interior:255 }
  await overhead()
  await expect(page.getByText('Canvas view', { exact:true })).toHaveCount(0)
  await expect.poll(() => fieldColors(page, canvas)).toEqual(painted)

  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name:'Watch last day' }).click()
  const time = page.getByRole('slider', { name:'Replay time' })
  await expect(time).toBeVisible()
  await time.fill('0')
  await expect.poll(() => fieldColors(page, canvas)).toEqual(painted)
  await page.getByRole('button', { name:'Layers', exact:true }).click()
  await page.getByRole('button', { name:'More layer options' }).click()
  await page.getByRole('checkbox', { name:'Show refuges' }).check()
  await page.getByRole('button', { name:'Back to layers' }).click()
  await page.getByRole('button', { name:'Close layers' }).click()

  await page.setViewportSize({ width:680, height:600 })
  const settings = await page.getByRole('button', { name:'Simulation Settings' }).boundingBox()
  expect((await canvas.boundingBox()).y).toBeGreaterThan(settings.y + settings.height)
  const lost = await canvas.evaluate(element => {
    const extension = element.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    extension?.loseContext()
    return !!extension
  })
  expect(lost).toBe(true)
  await expect(page.getByText('Canvas view', { exact:true })).toBeVisible()
  await expect.poll(() => fieldColors(page, canvas)).toEqual(painted)
  await page.getByRole('button', { name:'Next day' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 2 / 10 · Ready')
  await expect.poll(() => fieldColors(page, canvas)).toEqual(painted)

  await openRunLibrary(page)
  const legacy = { ...starter(WALKTHROUGH_RULE_VERSION), mode:'live', days:10 }
  await page.getByRole('dialog', { name:'Run Library' }).locator('input[type=file]').setInputFiles({
    name:'old-rules.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(legacy)),
  })
  await page.getByRole('button', { name:'Evolve!' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 1 / 10 · Ready')
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name:'Watch last day' }).click()
  await expect(time).toBeVisible()
  await time.fill('0')
  if (!(await page.locator('.world').getAttribute('class')).includes('is-overhead')) await overhead()
  await expect.poll(() => fieldColors(page, canvas)).toEqual({
    sides:[255,255,255,255], corners:[255,255,255,255], interior:255,
  })
  expect(errors).toEqual([])
})

test('live generations end when settled and Quick Sim stops at the extinction tile @pages', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await startRefugeFixture(page, setup => Object.assign(setup, { seed:6, food:10 }))
  await expect(page.getByText('0.00 s elapsed')).toBeVisible()
  await page.getByRole('button', { name: 'Play through generations' }).click()
  const speed = page.getByRole('button', { name: 'Viewing speed', exact: true })
  await speed.click()
  await page.getByRole('slider', { name: 'Viewing speed multiplier' }).fill('12')
  await speed.click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const runStatus = page.getByRole('button', { name: 'Run options' })
  await expect(runStatus).toHaveText('Day 1 / 10 · Final')
  await expect(page.getByRole('progressbar', { name: 'Current day elapsed' })).toHaveAttribute('aria-valuemax', '5')
  await page.getByRole('button', { name: 'Next day' }).click()
  await expect(runStatus).toHaveText('Day 2 / 10 · Ready')

  await quickThrough(page, 10)
  await expect(page.getByRole('heading', { name: 'Population extinct' })).toBeVisible()
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 4')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const tile = page.getByRole('button', { name: /Extinct on Day 4/ })
  await expect(tile.locator('svg')).toBeVisible()
  await expect(tile.locator('xpath=preceding-sibling::*[1]')).toHaveAttribute('data-day', '4')
  await expect(dayTile(page, 5)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Quick Sim', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'More Generations' })).toHaveCount(0)

  await dayTile(page, 3).click()
  await tile.click()
  const time = page.getByRole('slider', { name: 'Replay time' })
  await expect(time).toHaveValue('6.7')
  await page.reload()
  await expect(tile).toBeVisible()
  await expect(time).toHaveValue('6.7')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.getByText(/Browser test run .* Through Day 4/)).toBeVisible()
  expect(errors).toEqual([])
})

test('preparing a run that goes extinct on Day 1 opens its final replay', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await page.getByRole('spinbutton', { name: 'Energy', exact: true }).fill('10')
  await page.getByRole('button', { name: /^Prepare and watch/ }).click()
  await page.getByRole('button', { name: 'Evolve!' }).click()

  await expect(page.getByRole('button', { name: /Extinct on Day 1/ })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Replay time' })).toHaveValue('0.1')
  await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled()
  await page.getByRole('button', { name: 'Run options' }).click()
  await expect(page.getByRole('button', { name: 'Branch here' })).toBeDisabled()
})

test('generation bookmarks mark completed days, survive reload, and stay with their run @pages', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  const options = page.getByRole('button', { name: 'Generation options' })
  const menu = page.getByRole('region', { name: 'Generation options' })
  const bookmarks = page.getByRole('region', { name: 'Bookmarked generations' })
  const showBookmarks = async () => {
    await options.click()
    await menu.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  }
  await showBookmarks()
  await expect(bookmarks).toContainText('Select a completed day')
  await bookmarks.press('Escape')
  await expect(options).toBeFocused()

  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await dayTile(page, 3).press('i')
  const readings = page.getByRole('region', { name: 'Day 3 readings' })
  const bookmarkDay = readings.getByRole('button', { name: 'Bookmark Day 3', exact: true })
  await expect(bookmarkDay).toBeFocused()
  await bookmarkDay.press('Space')
  await expect(dayTile(page, 3)).toHaveAccessibleName(/bookmarked$/)
  await readings.getByRole('button', { name: 'Remove bookmark for Day 3' }).press('Escape')
  await expect(dayTile(page, 3)).toBeFocused()

  await dayTile(page, 1).press('Enter')
  await expect(dayTile(page, 1)).toHaveAttribute('aria-current', 'true')
  await options.click()
  await menu.getByRole('button', { name: 'Bookmark Day 1', exact: true }).click()
  await expect(dayTile(page, 1)).toHaveAccessibleName(/bookmarked$/)
  await menu.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  await expect(bookmarks.getByRole('listitem')).toHaveText(['Day 1', 'Day 3'])
  await bookmarks.getByRole('button', { name: 'Jump to Day 3' }).click()
  await expect(dayTile(page, 3)).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('slider', { name: 'Replay time' })).toBeVisible()

  await page.reload()
  await page.setViewportSize({ width: 390, height: 680 })
  await expect(dayTile(page, 1)).toHaveAccessibleName(/bookmarked$/)
  await expect(dayTile(page, 3)).toHaveAccessibleName(/bookmarked$/)
  await showBookmarks()
  await bookmarks.getByRole('button', { name: 'Jump to Day 1' }).click()
  await expect(dayTile(page, 1)).toHaveAttribute('aria-current', 'true')
  await options.click()
  await menu.getByRole('button', { name: 'Remove bookmark for Day 1' }).click()
  await expect(dayTile(page, 1)).not.toHaveAccessibleName(/bookmarked$/)
  const originalRun = page.url()

  await startRun(page)
  await showBookmarks()
  await expect(bookmarks).toContainText('Select a completed day')
  await page.goto(originalRun)
  await expect(dayTile(page, 3)).toHaveAccessibleName(/bookmarked$/)
  await showBookmarks()
  await expect(bookmarks.getByRole('listitem')).toHaveText(['Day 3'])
})

test('World can step backward and forward through a paused replay @pages', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page, '5'))
  const previous = page.getByRole('button', { name: 'Previous frame', exact: true })
  const next = page.getByRole('button', { name: 'Next frame', exact: true })
  const time = page.getByRole('slider', { name: 'Replay time' })
  const play = page.getByRole('button', { name: 'Play', exact: true })
  await expect(next).toHaveCount(0)

  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(previous).toBeDisabled()
  await page.getByRole('button', { name: 'Follow creature', exact: true }).click()
  const creature = page.getByRole('button', { name: /Current creature details.*#1$/ })
  await expect(creature).toBeVisible()
  await next.press('Enter')
  await expect(time).toHaveValue('0.1')
  await expect(play).toBeEnabled()
  await previous.click()
  await expect(time).toHaveValue('0')
  await expect(creature).toBeVisible()

  await time.fill('0.25')
  await next.click()
  await expect(time).toHaveValue('0.3')
  await previous.click()
  await expect(time).toHaveValue('0.2')
  await play.click()
  await expect(previous).toBeDisabled()
  await expect(next).toBeDisabled()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()

  await page.setViewportSize({ width: 320, height: 620 })
  await time.fill('4.95')
  await next.click()
  await expect(time).toHaveValue('5')
  await expect(next).toBeDisabled()
  await previous.click()
  await expect(time).toHaveValue('4.9')
  await expect(play).toBeEnabled()
})

test('World fits split windows and keeps its controls in full screen', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  const stats = page.getByRole('heading', { name: 'Current Generation Stats' })
  const timeline = page.getByRole('button', { name: 'Day 1, live', exact: true })
  const quick = page.getByRole('button', { name: 'Quick Sim', exact: true })
  const view = page.getByRole('button', { name: 'View options' })

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 720, height: 540 },
    { width: 512, height: 480 },
    { width: 320, height: 420 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(stats).toBeInViewport({ ratio: 1 })
    await expect(timeline).toBeInViewport({ ratio: 1 })
    await expect(quick).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => {
      const nav = document.querySelector('.app-header nav').getBoundingClientRect()
      const run = document.querySelector('.run-center').getBoundingClientRect()
      return nav.right <= run.left || nav.bottom <= run.top
    })).toBe(true)
    const exactValues = page.getByRole('button', { name: 'Exact values' })
    if (await exactValues.isVisible()) {
      const legend = await exactValues.boundingBox()
      const ribbon = await page.locator('.ribbon').boundingBox()
      expect(legend.y + legend.height).toBeLessThanOrEqual(ribbon.y + ribbon.height)
    }
    await expect.poll(() => page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))).toEqual(viewport)
  }

  await view.click()
  await page.getByRole('button', { name: 'Full screen', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('world'))).toBe(true)
  await expect(stats).toBeInViewport({ ratio: 1 })
  await expect(timeline).toBeInViewport({ ratio: 1 })
  await quick.click()
  await expect(page.getByRole('dialog', { name: 'Quick Sim' })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await view.click()
  await page.getByRole('button', { name: 'Exit full screen' }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)

  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()
  const food = page.getByRole('heading', { name: 'Food', exact: true })
  await food.scrollIntoViewIfNeeded()
  await expect(food).toBeInViewport({ ratio: 1 })
  await expect(trends).toBeInViewport({ ratio: 1 })
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('World shows hunting and resting thoughts and keeps one speed scale across days @pages', async ({ page }) => {
  await openSimulator(page)
  await page.emulateMedia({ reducedMotion:'reduce' })
  const { setup } = guideSource('hunt')
  Object.assign(setup, { mode:'live', days:10 })
  await openRunLibrary(page)
  await page.getByRole('dialog', { name:'Run Library' }).locator('input[type=file]').setInputFiles({
    name:'hunt.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(setup)),
  })
  await page.getByRole('button', { name:'Evolve!' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 1 / 10 · Ready')
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name:'Close', exact:true }).click()
  await dayTile(page, 1).click()

  const time = page.getByRole('slider', { name:'Replay time' })
  await expect(time).toHaveValue('0')
  await page.getByRole('button', { name:'Layers', exact:true }).click()
  await page.getByRole('button', { name:'Color by speed' }).click()
  await page.getByRole('button', { name:'Close layers' }).click()
  const bounds = page.locator('.speed-key div span')
  await expect(bounds).toHaveText(['8.89', '11.43'])
  await page.getByRole('combobox', { name:'Generation statistics species' }).selectOption('orange')
  await expect(bounds).toHaveText(['8.89', '11.43'])

  await page.getByRole('button', { name:'View options' }).click()
  await page.getByRole('button', { name:'Creatures', exact:true }).click()
  const details = page.getByRole('complementary', { name:'Creature details' })
  await details.getByRole('combobox', { name:'Creature', exact:true }).selectOption('51')
  await details.getByRole('button', { name:'Close creature details' }).click()
  await time.fill('0.2')
  await expect(page.getByRole('button', { name:'Creature thought · Chasing' }).locator('.lucide-utensils')).toBeVisible()
  await time.fill('0.5')
  await expect(page.getByRole('button', { name:'Creature thought · Home' }).getByText('zzz')).toBeVisible()
  await expect(page.getByRole('button', { name:'Current creature details · Orange · #51' })).toBeVisible()

  await dayTile(page, 3).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 3 / 10 · Replay')
  await expect(time).toHaveValue('0')
  await expect(bounds).toHaveText(['8.89', '11.43'])
})

test('World restores layers for every creature after clearing a selection', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  const layers = page.getByRole('button', { name: 'Layers', exact: true })
  const moreLayers = page.getByRole('button', { name: 'More layer options' })
  const sense = page.getByRole('button', { name: 'Sense range', exact: true })
  const selectedOnly = page.getByRole('checkbox', { name: 'Selected creature only' })

  await page.getByRole('button', { name: 'Follow creature' }).click()
  await layers.click()
  await sense.click()
  await moreLayers.click()
  await selectedOnly.check()

  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: 'Creatures', exact: true }).click()
  const details = page.getByRole('complementary', { name: 'Creature details' })
  await details.getByRole('combobox', { name: 'Creature', exact: true }).selectOption('')
  await details.getByRole('button', { name: 'Close creature details' }).click()

  await layers.click()
  await expect(sense).toHaveAttribute('aria-pressed', 'true')
  await moreLayers.click()
  await expect(selectedOnly).toBeDisabled()
  await expect(selectedOnly).not.toBeChecked()
})

test('World continues drawing live playback after losing WebGL', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))

  const field = page.getByRole('region', { name: 'Simulation field' })
  const canvas = field.locator('canvas.world-canvas')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const time = page.getByRole('progressbar', { name: 'Current day elapsed' })
  const elapsed = async () => Number(await time.getAttribute('aria-valuenow'))
  await expect.poll(elapsed).toBeGreaterThan(0)
  const lost = await canvas.evaluate(element => {
    const extension = element.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    extension?.loseContext()
    return !!extension
  })
  expect(lost).toBe(true)
  await expect(page.getByText('Canvas view', { exact: true })).toBeVisible()
  await expect.poll(() => canvas.evaluate(element => {
    const context = element.getContext('2d')
    const pixel = context?.getImageData(element.width / 2, element.height / 2, 1, 1).data
    return !!pixel && pixel[0] > 150 && pixel[3] === 255
  })).toBe(true)
  const fallbackTime = await elapsed()
  const startingImage = await canvas.evaluate(element => element.toDataURL())

  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
  await expect.poll(elapsed).toBeGreaterThan(fallbackTime)
  await expect.poll(() => canvas.evaluate((element, image) => element.toDataURL() !== image, startingImage)).toBe(true)
  expect(errors).toEqual([])
})

test('World suspends its hidden board and restores the current view @pages', async ({ page }) => {
  await page.addInitScript(() => {
    const activity = window.worldBoardActivity = { callbacks:0, measurements:0, paints:0 }
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
      return kind === 'webgl2' ? null : getContext.call(this, kind, ...options)
    }
    // Identify the board's animation callback by a paint on the World canvas.
    let drawing, boardCallback
    const schedule = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = callback => schedule(now => {
      drawing = callback
      if (callback === boardCallback) activity.callbacks++
      try { callback(now) } finally { drawing = null }
    })
    const fill = CanvasRenderingContext2D.prototype.fillRect
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (this.canvas.matches('.world .world-canvas') && this.fillStyle === '#242424') {
        if (drawing) boardCallback = drawing
        activity.paints++
      }
      return fill.apply(this, args)
    }
    for (const [owner, property] of [
      [HTMLElement.prototype, 'offsetWidth'], [Element.prototype, 'clientWidth'], [Element.prototype, 'clientHeight'],
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, property)
      Object.defineProperty(owner, property, { ...descriptor, get() {
        if (this.matches('.world .board')) activity.measurements++
        return descriptor.get.call(this)
      } })
    }
  })
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page, '20'))
  const canvas = page.locator('.world .world-canvas')
  const image = () => canvas.evaluate(element => element.toDataURL())
  const activity = () => page.evaluate(() => window.worldBoardActivity)
  const waitForFrames = () => page.evaluate(async () => {
    for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame)
  })
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  const world = page.getByRole('link', { name: 'World', exact: true })
  const elapsed = () => page.getByRole('progressbar', { name: 'Current day elapsed' }).getAttribute('aria-valuenow').then(Number)
  const play = page.getByRole('button', { name: 'Play', exact: true })

  async function switchViews(viewport) {
    await trends.press('Enter')
    await expect(canvas).toBeHidden()
    const hidden = await activity()
    if (viewport) await page.setViewportSize(viewport)
    await waitForFrames()
    expect(await activity()).toEqual(hidden)
    await world.press('Enter')
    await expect(canvas).toBeVisible()
    await expect.poll(async () => (await activity()).paints).toBeGreaterThan(hidden.paints)
  }

  await play.click()
  await expect.poll(elapsed).toBeGreaterThan(.2)
  await expect.poll(async () => (await activity()).callbacks).toBeGreaterThan(0)
  await switchViews({ width: 740, height: 700 })
  const visible = await activity()
  await waitForFrames()
  expect(await activity()).toMatchObject({ measurements: visible.measurements })
  await expect(play).toBeEnabled()
  expect(await elapsed()).toBeGreaterThan(.2)
  expect(await canvas.evaluate(element => {
    const box = element.parentElement
    const dpr = Math.min(devicePixelRatio, 1.8)
    return element.width === Math.round(box.clientWidth * dpr) &&
      element.height === Math.round(box.clientHeight * dpr)
  })).toBe(true)

  const pausedAt = await elapsed()
  const unzoomed = await image()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .42)
  await page.mouse.wheel(0, 160)
  await expect.poll(image).not.toBe(unzoomed)
  const zoomed = await image()
  await switchViews()
  expect(await elapsed()).toBe(pausedAt)
  expect(await image()).toBe(zoomed)

  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const scrubber = page.getByRole('slider', { name: 'Replay time' })
  await scrubber.fill('2.4')
  await waitForFrames()
  const replay = await image()
  await switchViews()
  await expect(scrubber).toHaveValue('2.4')
  expect(await image()).toBe(replay)
})

test('slow live playback draws intermediate poses and replay seeks directly to the requested pose', async ({ page }) => {
  await page.addInitScript(() => {
    const motion = window.motionTest = { time:0, poses:[] }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args)
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'frame') motion.time = data.frame.time
        })
      }
    }
    const painter = CanvasRenderingContext2D.prototype
    const originals = { clear:painter.fillRect, fill:painter.fill, ellipse:painter.ellipse, gradient:painter.createLinearGradient }
    const bodyGradients = new WeakSet()
    let seen = false, center
    painter.fillRect = function (...args) {
      if (this.canvas.classList.contains('world-canvas') && this.fillStyle === '#242424') seen = false
      return originals.clear.apply(this, args)
    }
    painter.ellipse = function (x, y, ...args) {
      if (this.canvas.classList.contains('world-canvas')) center = [x.toFixed(2), y.toFixed(2)].join(',')
      return originals.ellipse.call(this, x, y, ...args)
    }
    painter.createLinearGradient = function (...args) {
      const gradient = originals.gradient.apply(this, args)
      if (this.canvas.classList.contains('world-canvas')) bodyGradients.add(gradient)
      return gradient
    }
    painter.fill = function (...args) {
      if (!seen && bodyGradients.has(this.fillStyle)) {
        motion.poses.push({ time:motion.time, center })
        seen = true
      }
      return originals.fill.apply(this, args)
    }
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  const field = page.getByRole('region', { name:'Simulation field' })
  const canvas = field.locator('canvas.world-canvas')
  await page.getByRole('button', { name:'View options' }).click()
  await page.getByRole('button', { name:/^Overhead/ }).click()
  const nextPaint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const position = () => page.evaluate(() => window.motionTest.poses.at(-1)?.center)
  await nextPaint()
  const initial = await canvas.screenshot()
  const elapsed = page.getByRole('progressbar', { name:'Current day elapsed' })
  const readTime = async () => Number(await elapsed.getAttribute('aria-valuenow'))
  const play = page.getByRole('button', { name:'Play', exact:true })
  const pause = page.getByRole('button', { name:'Pause', exact:true })
  await play.click()
  await expect.poll(readTime).toBeGreaterThan(.2)
  await pause.click()
  expect((await canvas.screenshot()).equals(initial)).toBe(false)

  await canvas.evaluate(element => element.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext())
  await expect(page.getByText('Canvas view', { exact:true })).toBeVisible()
  const speed = page.getByRole('button', { name:'Viewing speed', exact:true })
  await speed.click()
  const slider = page.getByRole('slider', { name:'Viewing speed multiplier' })
  await slider.fill('0')
  await speed.click()
  await page.evaluate(() => { window.motionTest.poses = [] })
  await play.click()
  await expect.poll(() => page.evaluate(() => {
    const { poses, time } = window.motionTest
    return new Set(poses.filter(pose => pose.time === time).map(pose => pose.center)).size
  })).toBeGreaterThan(6)
  await pause.click()
  await nextPaint()
  const settled = await position()
  await nextPaint()
  expect(await position()).toBe(settled)
  const pausedTime = await readTime()
  await page.getByRole('button', { name:'Playback actions' }).click()
  await page.getByRole('button', { name:'Step one tick', exact:true }).click()
  await expect.poll(readTime).toBeGreaterThan(pausedTime)
  await expect.poll(position).not.toBe(settled)
  await speed.click()
  await slider.fill('12')
  await speed.click()
  const before = await readTime()
  await play.click()
  await expect.poll(readTime).toBeGreaterThan(before + .5)
  await pause.click()

  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name:'Watch last day' }).click()
  const replayTime = page.getByRole('slider', { name:'Replay time' })
  await replayTime.fill('0')
  await expect(replayTime).toHaveValue('0')
  await nextPaint()
  const dawn = await position()
  await replayTime.fill('0.5')
  await expect.poll(position).not.toBe(dawn)
  await replayTime.fill('0')
  await expect.poll(position).toBe(dawn)
  await page.getByRole('button', { name:'Next day' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 2 / 10 · Ready')
  expect(errors).toEqual([])
})

test('Mini line shows a point as soon as the first day is completed', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Generation options' }).click()
  await page.getByRole('button', { name: 'Mini line', exact: true }).click()
  await page.locator('.flower-legend').getByRole('button', { name: 'Population', exact: true }).click()

  const chart = page.locator('.ribbon-line')
  await expect(chart.locator('path')).toHaveAttribute('d', /^\s*M[^L]*$/)
  await expect(chart.locator('circle')).toHaveCount(1)
  await expect(chart.locator('circle')).toBeVisible()
  await expect(chart.locator('circle')).toHaveAttribute('cx', '50')

  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(chart.locator(':scope > circle')).toHaveCount(3)
  await expect(chart.locator(':scope > path')).toHaveAttribute('d', /M.*L.*L/)
  await expect(chart.locator('g circle')).toHaveCount(5)
})

test('Mini line points stay above their generation tiles when the window shrinks', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Generation options' }).click()
  await page.getByRole('button', { name: 'Mini line', exact: true }).click()

  const line = page.locator('.ribbon-line > path')
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 640, height: 750 },
    { width: 512, height: 480 },
  ]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => line.evaluate(path => {
      const screen = path.getScreenCTM()
      const endpoints = [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())]
      const tiles = [1, 3].map(day => document.querySelector(`.day-tile[data-day="${day}"]`).getBoundingClientRect())
      return Math.max(...tiles.map(({ left, width }, i) =>
        Math.abs(endpoints[i].matrixTransform(screen).x - (left + width / 2))))
    }), { message: `Chart alignment at ${viewport.width} × ${viewport.height}` }).toBeLessThan(1)
  }
})

test('graph predictions respect the visible range, saved controls and recorded-day actions', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await fixedDay(page)
    await page.getByRole('spinbutton', { name:'Food', exact:true }).fill('400')
  })
  await quickThrough(page, 6)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 6')
  await page.getByRole('button', { name:'Close', exact:true }).click()
  await page.getByRole('link', { name:'Trends', exact:true }).click()

  const population = page.getByRole('article', { name:'Population chart', exact:true })
  const chart = population.getByRole('img')
  const reading = population.getByRole('status')
  await page.getByRole('combobox', { name:'Range', exact:true }).selectOption('custom')
  await page.getByRole('spinbutton', { name:'From day' }).fill('2')
  await page.getByRole('spinbutton', { name:'To day' }).fill('3')
  await chart.press('End')
  await chart.press('ArrowRight')
  await expect(reading).toBeEmpty()
  await page.getByRole('spinbutton', { name:'To day' }).fill('4')
  await expect(page.getByText('Preparing predictions…')).toBeHidden()
  await chart.press('End')
  await chart.press('ArrowRight')
  await expect(reading).toContainText('Predicted · Day 5')
  await chart.press('Enter')
  await chart.press('Space')
  await expect(page.getByRole('button', { name:'Watch day', exact:true })).toHaveAccessibleDescription(/Day 4 · Pinned/)
  await expect(reading).toContainText('Predicted · Day 5')
  for (let i=0; i<4; i++) await chart.press('ArrowRight')
  await expect(reading).toContainText('Predicted · Day 9')

  const bounds = await chart.boundingBox()
  await page.mouse.move(bounds.x + bounds.width*.83, bounds.y + bounds.height*.5)
  await expect(reading).toContainText('Predicted · Day')
  await page.mouse.click(bounds.x + bounds.width*.83, bounds.y + bounds.height*.5)
  await expect(population).toBeVisible()

  await page.getByRole('button', { name:'Simulation Settings' }).click()
  await advancedSettings(page, 'Graph predictions')
  const cycles = page.getByRole('spinbutton', { name:'Cycles ahead' })
  await expect(cycles).toHaveValue('5')
  await cycles.fill('26')
  await expect(cycles).toHaveAttribute('aria-invalid','true')
  await cycles.fill('2')
  await cycles.press('Enter')
  const show = page.getByRole('checkbox', { name:'Show predictions' })
  await show.uncheck()
  await expect(cycles).toBeDisabled()
  await page.getByRole('button', { name:'Close settings' }).click()
  await chart.press('End')
  await chart.press('ArrowRight')
  await expect(reading).toBeEmpty()

  await page.reload()
  await page.getByRole('button', { name:'Simulation Settings' }).click()
  await advancedSettings(page, 'Graph predictions')
  await expect(show).not.toBeChecked()
  await expect(cycles).toHaveValue('2')
  await show.check()
  await page.getByRole('button', { name:'Close settings' }).click()
  await page.getByRole('link', { name:'Trends', exact:true }).click()
  await expect(page.getByText('Preparing predictions…')).toBeHidden()
  await chart.press('End')
  await chart.press('ArrowRight')
  await expect(reading).toContainText('Predicted · Day 7')
  await chart.press('ArrowRight')
  await chart.press('ArrowRight')
  await expect(reading).toContainText('Predicted · Day 8')

  for (const [button, name, start] of [
    ['Generation table','Generation statistics','Stat trends'],
    ['Advanced stats','Advanced stats',null],
  ]) {
    await page.getByRole('button', { name:button, exact:true }).click()
    const dialog = page.getByRole('dialog', { name })
    if (start) await dialog.getByRole('button', { name:start }).click()
    const graph = dialog.getByRole('img', { name:/by generation/ })
    await expect(dialog.getByText('Preparing predictions…')).toBeHidden()
    await graph.press('End')
    await graph.press('ArrowRight')
    await expect(dialog.locator('.prediction-reading')).toContainText('Predicted · Generation 7')
    await page.keyboard.press('Escape')
  }
  expect(errors).toEqual([])
})

test('Compare forecasts both runs from the end of their shared history', async ({ page }) => {
  await openSimulator(page)
  for (const [name, days, food] of [['Longer run', 5, '500'], ['Shorter run', 3, '350']]) {
    await startRun(page, '10', async () => {
      await fixedDay(page)
      await page.getByRole('spinbutton', { name:'Food', exact:true }).fill(food)
      await page.getByLabel('Run name').fill(name)
    })
    await quickThrough(page, days)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day '+days)
    await page.getByRole('button', { name:'Close', exact:true }).click()
  }
  await openRunLibrary(page)
  await page.getByRole('dialog', { name:'Run Library' }).locator('article').filter({ hasText:'Longer run' })
    .getByRole('button', { name:'Compare', exact:true }).click()
  const population = page.getByRole('article', { name:'Population chart', exact:true })
  const chart = population.getByRole('img')
  await expect(chart).toBeVisible()
  await expect(page.getByText('Preparing predictions…')).toBeHidden()
  await expect(page.getByText('Predictions couldn’t load')).toHaveCount(0)
  await chart.press('End')
  await chart.press('ArrowRight')
  await expect(population.getByRole('status')).toHaveText(/Predicted · Day 4 · Shorter run · Left\s+\d+ · Longer run · Right\s+\d+/)
  await population.getByRole('button', { name:'Shorter run · Left' }).click()
  await chart.press('End')
  await chart.press('ArrowRight')
  await expect(population.getByRole('status')).toHaveText(/Predicted · Day 4 · Longer run · Right\s+\d+/)
})

test('seeded previews match the recorded day, survive a worker retry and label extensions @pages', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage
    window.forecastStarts = []
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message.type === 'forecast') {
        window.forecastStarts.push({ start:message.start, target:message.target })
        if (window.forecastStarts.length === 1) {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data:{ type:'error' } })))
          return
        }
      }
      return send.call(this, message, ...rest)
    }
  })
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await fixedDay(page)
    await page.getByRole('spinbutton', { name:'Random seed' }).fill('118')
    await page.getByRole('spinbutton', { name:'Food', exact:true }).fill('500')
  })
  await quickThrough(page, 9)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 9')
  await page.getByRole('button', { name:'Close', exact:true }).click()
  await page.getByRole('link', { name:'Trends', exact:true }).click()
  await expect(page.getByText('Predictions couldn’t load')).toBeVisible()
  await page.getByRole('button', { name:'Retry predictions' }).click()
  await expect(page.getByText('Preparing predictions…')).toBeHidden()

  const population = page.getByRole('article', { name:'Population chart', exact:true })
  const chart = population.getByRole('img')
  const reading = population.getByRole('status')
  await page.getByText('Chart options', { exact:true }).click()
  await page.getByRole('combobox', { name:'Cohort', exact:true }).selectOption('dusk')
  await chart.press('End')
  await chart.press('ArrowRight')
  await expect(reading).toHaveText(/Predicted · Day 10 · Closing population\s+\d+/)
  const predicted = (await reading.textContent()).match(/Closing population\s+(\d+)/)[1]
  await chart.press('ArrowRight')
  await expect(reading).toContainText('Predicted · If extended · Day 11')
  await chart.press('Enter')
  await expect.poll(async () => (await savedManualProgress(page)).days.at(-1)).toBe(9)

  await page.getByRole('link', { name:'World', exact:true }).click()
  await page.getByRole('button', { name:'Generation options', exact:true }).click()
  await page.getByRole('button', { name:'Mini line', exact:true }).click()
  await page.getByRole('region', { name:'Current generation and timeline' }).getByRole('button', { name:'Population', exact:true }).click()
  await expect(page.locator('.ribbon-line g circle')).toHaveCount(5)
  await expect(page.getByRole('img', { name:/Predicted · If extended · Day 11 · Population/ })).toHaveCount(1)
  expect(await page.evaluate(() => window.forecastStarts)).toHaveLength(2)

  await quickThrough(page, 10)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 10')
  await page.getByRole('button', { name:'Close', exact:true }).click()
  await page.getByRole('link', { name:'Trends', exact:true }).click()
  await chart.press('End')
  await expect(page.locator('#pinned-day-details')).toContainText(predicted+' blobs at dusk')
  await expect.poll(() => page.evaluate(() => window.forecastStarts.at(-1))).toEqual({ start:14, target:15 })
  expect(errors).toEqual([])
})

test('the generation spreadsheet and stat trends update after each live generation @pages', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await fixedDay(page)
    await page.getByRole('spinbutton', { name:'Food', exact:true }).fill('100')
    await page.getByRole('button', { name:'Orange Off', exact:true }).click()
    await page.getByRole('checkbox', { name:'Enabled', exact:true }).check()
  })

  const openSheet = page.getByRole('button', { name:'View generation table' })
  const dialog = page.getByRole('dialog', { name:'Generation statistics' })
  const table = dialog.getByRole('table', { name:'Completed generations' })
  const rows = table.locator('tbody tr')
  const done = dialog.getByRole('button', { name:'Done', exact:true })
  await openSheet.click()
  await expect(table.getByRole('columnheader', { name:'Generation', exact:true })).toBeVisible()
  await expect(table.getByRole('columnheader', { name:/Average Speed/ })).toHaveCount(1)
  await expect(table.getByRole('columnheader', { name:'Deaths', exact:true })).toHaveCount(1)
  await expect(rows).toHaveCount(0)
  await done.click()

  const speed = page.getByRole('button', { name:'Viewing speed', exact:true })
  await speed.click()
  await page.getByRole('slider', { name:'Viewing speed multiplier' }).fill('12')
  await speed.click()
  await expect(page.getByRole('button', { name:'Play through generations' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name:'Play', exact:true }).click()
  await openSheet.click()

  const stat = dialog.getByRole('combobox', { name:'Stat', exact:true })
  const latest = dialog.locator('.generation-stat-latest')
  const selected = dialog.locator('.generation-stat-pin')
  const chart = dialog.getByRole('img', { name:/Opening population by generation/ })
  await table.getByRole('button', { name:'View Opening population trend', exact:true }).click()
  await expect(stat).toBeFocused()
  await expect(stat).toHaveValue('opening')
  await expect(chart).toBeVisible()
  await expect(latest).toHaveText(/^Latest · Generation 1\s+60$/)
  await expect(latest).toHaveText(/^Latest · Generation 2\s+\d+$/)
  await chart.press('Home')
  await expect(selected).toContainText(/Generation 1\s+60/)
  await dialog.getByRole('combobox', { name:'Species' }).selectOption('orange')
  await expect(selected).toContainText(/Generation 1\s+10/)
  await chart.press('ArrowRight')
  await expect(selected.getByRole('button', { name:'Replay generation 2' })).toBeVisible()

  await dialog.getByRole('button', { name:'Spreadsheet', exact:true }).click()
  const first = rows.first()
  await expect(first.getByRole('button', { name:'Replay generation 1' })).toBeVisible()
  await expect(rows.nth(1).getByRole('button', { name:'Replay generation 2' })).toBeVisible()
  await expect(first.getByRole('cell').first()).toHaveText('10')
  await first.getByRole('button', { name:'Replay generation 1' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 1 / 10 · Replay')
})

test('the generation spreadsheet and stat trends update during a background batch', async ({ page }) => {
  await installBatchHold(page)
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await page.evaluate(() => { window.batchTest.hold = true })
  await quickThrough(page, 4)
  await page.getByRole('button', { name:'Hide progress' }).click()
  await page.getByRole('link', { name:'Trends', exact:true }).click()
  await page.getByRole('button', { name:'Generation table', exact:true }).click()
  const dialog = page.getByRole('dialog', { name:'Generation statistics' })
  const table = dialog.getByRole('table', { name:'Completed generations' })
  const rows = table.locator('tbody tr')
  await expect(rows).toHaveCount(0)

  await dialog.getByRole('button', { name:'Stat trends', exact:true }).click()
  const stat = dialog.getByRole('combobox', { name:'Stat', exact:true })
  await expect(stat).toHaveValue('population')
  await stat.selectOption('speed')
  const chart = dialog.getByRole('img', { name:/Average Speed by generation/ })
  await expect(chart).toBeVisible()
  await expect(dialog.getByText('No completed days in this range')).toBeVisible()

  await page.evaluate(() => window.batchTest.release())
  const latest = dialog.locator('.generation-stat-latest')
  await expect(latest).toHaveText(/^Latest · Generation 4\s+\d+\.\d{2}$/)
  const latestSpeed = await latest.locator('strong').innerText()
  await chart.press('Home')
  await expect(dialog.getByRole('button', { name:'Replay generation 1' })).toBeVisible()
  await chart.press('End')
  await expect(dialog.getByRole('button', { name:'Replay generation 4' })).toBeVisible()

  await dialog.getByRole('button', { name:'Spreadsheet', exact:true }).click()
  await expect(rows).toHaveCount(4)
  await expect(rows.getByRole('rowheader')).toHaveText(['1','2','3','4'])
  const speedColumn = await table.getByRole('columnheader', { name:'Average Speed', exact:true }).evaluate(node => node.cellIndex)
  await expect(rows.last().locator('td').nth(speedColumn - 1)).toHaveText(latestSpeed)
  await expect(dialog.getByText('4 completed', { exact:true })).toBeVisible()
})

test('Advanced stats tracks consecutive live generations while an older reading stays pinned @pages', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await fixedDay(page)
    await page.getByRole('spinbutton', { name:'Food', exact:true }).fill('100')
  })
  const openStats = page.getByRole('button', { name:'Advanced stats', exact:true })
  const dialog = page.getByRole('dialog', { name:'Advanced stats' })
  const chart = dialog.getByRole('img', { name:/^Survival rate by generation/ })
  await openStats.click()
  await expect(dialog.getByRole('button', { name:'Survival & Growth' })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('combobox', { name:'Range', exact:true })).toHaveValue('all')
  await expect(dialog.getByText('No completed days in this range')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(openStats).toBeFocused()

  const speed = page.getByRole('button', { name:'Viewing speed', exact:true })
  await speed.click()
  await page.getByRole('slider', { name:'Viewing speed multiplier' }).fill('12')
  await speed.click()
  await page.getByRole('button', { name:'Play', exact:true }).click()
  await openStats.click()

  const latest = dialog.locator('.advanced-stats-latest')
  const readings = dialog.getByRole('region', { name:'Generation readings' })
  await expect(latest).toHaveText('Latest completed · Generation 1')
  await chart.press('Home')
  await expect(readings.locator('strong')).toHaveText(/^\d+\.\d{2}%$/)
  await expect(latest).toHaveText('Latest completed · Generation 2')
  await expect(readings.getByRole('heading', { name:'Generation 1', exact:true })).toBeVisible()
  await readings.getByRole('button', { name:'Latest', exact:true }).click()
  await expect(readings.getByRole('heading', { name:/^Generation (?:[2-9]|10)$/ })).toBeVisible()

  await chart.press('Home')
  await readings.getByRole('button', { name:'Replay generation 1', exact:true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 1 / 10 · Replay')
})

test('Advanced stats follows Quick Sim and updates trait, species, and generation filters @pages', async ({ page }) => {
  await installBatchHold(page)
  await openSimulator(page)
  await startRun(page, '35', async () => {
    await fixedDay(page)
    await page.getByRole('spinbutton', { name:'Food', exact:true }).fill('100')
    await page.getByRole('button', { name:'Orange Off', exact:true }).click()
    await page.getByRole('checkbox', { name:'Enabled', exact:true }).check()
  })
  await page.evaluate(() => { window.batchTest.hold = true })
  await quickThrough(page, 30)
  await page.getByRole('button', { name:'Hide progress' }).click()
  await page.getByRole('link', { name:'Trends', exact:true }).click()
  await page.getByRole('button', { name:'Advanced stats', exact:true }).click()
  const dialog = page.getByRole('dialog', { name:'Advanced stats' })
  const readings = dialog.getByRole('region', { name:'Generation readings' })
  const stat = dialog.getByRole('combobox', { name:'Stat', exact:true })
  const species = dialog.getByRole('combobox', { name:'Species', exact:true })
  const valueFor = label => readings.getByText(label, { exact:true }).locator('xpath=following-sibling::dd[1]')

  await dialog.getByRole('button', { name:'Trait Spread', exact:true }).click()
  await dialog.getByRole('combobox', { name:'Trait', exact:true }).selectOption('sense')
  await stat.selectOption('mean')
  const traitChart = dialog.getByRole('img', { name:/^Sense Range · Average by generation/ })
  await expect(traitChart).toBeVisible()
  await expect(dialog.getByText('No completed days in this range')).toBeVisible()
  await page.evaluate(() => window.batchTest.release())
  await expect(dialog.locator('.advanced-stats-latest')).toHaveText('Latest completed · Generation 30')

  await traitChart.press('Home')
  await expect(readings.getByRole('heading', { name:'Generation 1', exact:true })).toBeVisible()
  await expect(valueFor('Lower quartile (25%)')).toHaveText(/^\d+\.\d{2}$/)
  const range = dialog.getByRole('combobox', { name:'Range', exact:true })
  await range.selectOption('25')
  await expect(readings.getByRole('heading', { name:'Generation 30', exact:true })).toBeVisible()
  await traitChart.press('Home')
  await expect(readings.getByRole('heading', { name:'Generation 6', exact:true })).toBeVisible()

  await range.selectOption('100')
  await traitChart.press('Home')
  await dialog.getByRole('button', { name:'Survival & Growth', exact:true }).click()
  await expect(valueFor('Opening population')).toHaveText('60')
  await expect(valueFor('Starvation')).toHaveText(/^\d+$/)
  await species.selectOption('orange')
  await expect(valueFor('Opening population')).toHaveText('10')

  await dialog.getByRole('button', { name:'Food & Hunting', exact:true }).click()
  await stat.selectOption('fieldUse')
  await expect(readings.getByRole('heading', { name:'Generation 1', exact:true })).toBeVisible()
  await expect(valueFor('Plants spawned (whole field)')).toHaveText('100')
  const plantsLeft = Number(await valueFor('Plants left (whole field)').textContent())
  await expect(readings.locator('strong')).toHaveText((100 - plantsLeft).toFixed(2) + '%')
  await species.selectOption('all')
  await expect(readings.locator('strong')).toHaveText((100 - plantsLeft).toFixed(2) + '%')
  await stat.selectOption('huntsPerStarter')
  await expect(dialog.getByRole('img', { name:/^Successful hunts per starting creature by generation/ })).toBeVisible()
})

test('Mini line can plot Population and Age at Death', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const options = page.getByRole('button', { name: 'Generation options' })
  const legend = page.locator('.flower-legend')
  const population = legend.getByRole('button', { name: 'Population', exact: true })
  const deathAge = legend.getByRole('button', { name: 'Age at Death', exact: true })
  const line = page.locator('.ribbon-line > path')
  const table = page.getByRole('dialog', { name: 'Generation statistics' })

  await options.click()
  await page.getByRole('button', { name: 'Mini line', exact: true }).click()
  await population.click()
  await expect(table).toBeHidden()
  await expect(population).toHaveAttribute('aria-pressed', 'true')
  await expect(line).toHaveAttribute('stroke', '#EEEDD6')
  await expect(line).toHaveAttribute('d', /M.*L/)

  await page.setViewportSize({ width: 512, height: 480 })
  await deathAge.click()
  await expect(deathAge).toHaveAttribute('aria-pressed', 'true')
  await expect(population).toHaveAttribute('aria-pressed', 'false')
  await expect(line).toHaveAttribute('stroke', '#DDDAD0')
  await expect(line).toHaveAttribute('d', /M/)
  const exactValues = legend.getByRole('button', { name: 'Exact values', exact: true })
  await expect(exactValues).toBeInViewport({ ratio: 1 })
  await exactValues.click()
  await expect(table).toBeVisible()
  await table.getByRole('button', { name: 'Done', exact: true }).click()

  await options.click()
  await page.getByRole('button', { name: /Walkthrough flower/ }).click()
  await population.click()
  await expect(table).toBeVisible()
})

test('browser Back closes a focused Trends chart and restores World controls', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const worldUrl = page.url()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const trendsUrl = page.url()
  const focus = page.getByRole('button', { name: 'Focus Population', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Focused chart' })
  await focus.click()
  await expect(dialog).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(worldUrl)
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Quick Sim' })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()

  await page.goForward()
  await expect(page).toHaveURL(trendsUrl)
  await expect(dialog).toBeHidden()
  await focus.click()
  await expect(dialog).toBeVisible()
})

test('Trends marks the food rules used on each completed day of a branch', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await advancedSettings(page)
    await page.getByLabel('Food schedule').selectOption('step')
    await addFoodPoint(page, 3, 25)
    await addFoodPoint(page, 5, 45)
    await addFoodPoint(page, 8, 90)
  })
  await quickThrough(page, 5)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 5')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()
  const markers = page.locator('.trend-annotations span')
  await expect(markers).toHaveText([/Day 3 · 25 plants/, /Day 5 · 45 plants/])

  const runOptions = page.getByRole('button', { name: 'Run options' })
  await runOptions.click()
  await page.getByRole('button', { name: 'Branch here', exact: true }).click()
  await page.getByLabel('Branch after day').fill('4')
  await page.getByRole('button', { name: 'Edit branch rules' }).click()
  await advancedSettings(page)
  await page.getByLabel('Food schedule').selectOption('step')
  await addFoodPoint(page, 2, 70)
  await addFoodPoint(page, 5, 70)
  await advancedSettings(page, 'Field layout')
  const branchSettings = page.getByRole('dialog', { name:'Branch Settings' })
  await branchSettings.getByLabel('Food placement').selectOption('patches')
  await branchSettings.getByRole('spinbutton', { name:'Number of patches' }).fill('8')
  await branchSettings.getByLabel('Refuge width').selectOption('15')
  await expect(branchSettings.getByRole('status')).toHaveText('Day 5 · 70 plants at dawn')
  await expect(branchSettings.getByText(/Refuge covers 15%/)).toBeVisible()
  await branchSettings.getByRole('spinbutton', { name:'Preview day' }).fill('4')
  await expect(branchSettings.getByRole('status')).toHaveText('Day 4 · 25 plants at dawn (saved)')
  await expect(branchSettings.getByText(/Refuge covers 10%/)).toBeVisible()
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(runOptions).toHaveText('Day 5 / 10 · Ready')
  await quickThrough(page, 6)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 6')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await trends.click()
  await expect(markers).toHaveText([/Day 3 · 25 plants/, /Day 5 · Branch · 70 plants/])
  await page.reload()
  await expect(markers).toHaveText([/Day 3 · 25 plants/, /Day 5 · Branch · 70 plants/])

  await openRunLibrary(page)
  const library = page.getByRole('dialog', { name:'Run Library' })
  const archive = library.locator('article').filter({ hasText:'Browser test run · branch' })
  await archive.getByText('Actions', { exact:true }).click()
  const download = page.waitForEvent('download')
  await archive.getByRole('button', { name:'Export setup' }).click()
  const setupFile = await (await download).path()
  const exported = JSON.parse(await readFile(setupFile, 'utf8'))
  expect(exported.revisions.map(({ setup }) => [setup.foodPlacement, setup.refugePercent]))
    .toEqual([['scattered', 10], ['patches', 15]])
  await library.locator('input[type=file]').setInputFiles({
    name:'branch.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(exported)),
  })
  await expect(library).toHaveCount(0)
  await quickThrough(page, 6)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 6')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await trends.click()
  await expect(markers).toHaveText([/Day 3 · 25 plants/, /Day 5 · Branch · 70 plants/])
})

test('a food-only branch keeps the day length at the fork', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await quickThrough(page, 2)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const runOptions = page.getByRole('button', { name: 'Run options' })
  const branch = page.getByRole('button', { name: 'Branch here', exact: true })
  const create = page.getByRole('button', { name: 'Create branch', exact: true })
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })

  await runOptions.click()
  await branch.click()
  await page.getByLabel('Branch after day').fill('2')
  await page.getByRole('button', { name: 'Edit branch rules' }).click()
  await advancedSettings(page, 'Day length')
  await page.getByRole('spinbutton', { name: 'Seconds per day', exact: true }).fill('2')
  await create.click()
  await expect(runOptions).toHaveText('Day 3 / 10 · Ready')
  await expect(elapsed).toHaveAttribute('aria-valuemax', '2')
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await runOptions.click()
  await branch.click()
  await page.getByLabel('Branch after day').fill('2')
  await page.getByLabel('Plants per day').fill('70')
  await create.click()
  await expect(runOptions).toHaveText('Day 3 / 10 · Ready')
  await expect(elapsed).toHaveAttribute('aria-valuemax', '10')
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(page.getByRole('slider', { name: 'Replay time' })).toHaveAttribute('max', '10')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.locator('.trend-annotations span')).toHaveText([/Day 3 · Branch · 70 plants/])
})

test('a branch defaults to the plant supply recorded on the selected day', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await advancedSettings(page)
    await page.getByLabel('Food schedule').selectOption('step')
    await addFoodPoint(page, 3, 25)
    await addFoodPoint(page, 5, 70)
  })
  await quickThrough(page, 5)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 5')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const run = page.getByRole('button', { name: 'Run options' })
  const branch = page.getByRole('button', { name: 'Branch here', exact: true })
  const day = page.getByLabel('Branch after day')
  const plants = page.getByLabel('Plants per day')
  await run.click()
  await branch.click()
  await expect(day).toHaveValue('5')
  await expect(plants).toHaveValue('70')
  await day.fill('4')
  await expect(plants).toHaveValue('25')
  await plants.fill('85')
  await day.fill('2')
  await expect(plants).toHaveValue('85')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await run.click()
  await branch.click()
  await day.fill('4')
  await expect(plants).toHaveValue('25')
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(run).toHaveText('Day 5 / 10 · Ready')
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('checkbox', { name: 'HUD' }).check()
  await expect(page.locator('.world-hud')).toContainText('Plants left 25')
})

test('earlier completed days can be branched from the run limit', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const branch = page.getByRole('button', { name: 'Branch here', exact: true })
  const branchDay = page.getByLabel('Branch after day')

  await runOptions.click()
  await expect(branch).toBeDisabled()
  await runOptions.click()
  await quickThrough(page, 9)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 9')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(runOptions).toHaveText('Day 10 / 10 · Ready')
  await runOptions.click()
  await expect(branch).toBeEnabled()
  await branch.click()
  await expect(branchDay).toHaveValue('9')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await quickThrough(page, 10)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 10')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(runOptions).toHaveText('Day 10 / 10 · Replay')
  await runOptions.click()
  await branch.click()
  await expect(branchDay).toHaveAttribute('max', '9')
  await expect(branchDay).toHaveValue('9')
  await page.getByLabel('Plants per day').fill('70')
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(runOptions).toHaveText('Day 10 / 10 · Ready')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.getByText(/Browser test run · branch .* Through Day 9/)).toBeVisible()
})

async function startDelayedBranch(page) {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
}

async function openDayTwoBranch(page) {
  await page.getByRole('button', { name: 'Run options' }).click()
  await page.getByRole('button', { name: 'Branch here', exact: true }).click()
  await page.getByLabel('Branch after day').fill('2')
}

for (const exit of ['Cancel', 'Close settings', 'browser Back']) {
  test(`a pending branch is discarded on ${exit}`, async ({ page }) => {
    await startDelayedBranch(page)
    const sourceId = await page.evaluate(() => localStorage.getItem('evolution.active'))
    const trends = page.getByRole('link', { name: 'Trends', exact: true })
    if (exit === 'browser Back') {
      await trends.click()
      await page.getByRole('link', { name: 'World', exact: true }).click()
    }
    await openDayTwoBranch(page)
    if (exit === 'Close settings') await page.getByRole('button', { name: 'Edit branch rules' }).click()
    const submit = page.getByRole('button', { name: 'Create branch', exact: true })
    await submit.click()
    await expect(page.getByText('Preparing branch from Day 2…')).toBeVisible()
    await expect(submit).toBeDisabled()
    await expect.poll(() => page.evaluate(() => window.replayTest.jobs.has(2))).toBe(true)

    if (exit === 'browser Back') await page.goBack()
    else {
      await page.getByRole('button', { name: exit, exact: true }).click()
      await trends.click()
    }
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(trends).toHaveAttribute('aria-current', 'page')
    const trendsUrl = page.url()
    await finishReplay(page, 2)

    await expect(page).toHaveURL(trendsUrl)
    expect(await page.evaluate(() => localStorage.getItem('evolution.active'))).toBe(sourceId)
    await page.reload()
    await expect(trends).toHaveAttribute('aria-current', 'page')
    await openRunLibrary(page)
    const library = page.getByRole('dialog', { name: 'Run Library' })
    const source = library.locator('article').filter({ has: page.getByText('Browser test run', { exact: true }) })
    await expect(source).toContainText('Active')
    await expect(source).toContainText('Saved through Day 3')
    await expect(library.getByText('Browser test run · branch', { exact: true })).toHaveCount(0)
  })
}

test('a failed branch can be retried without duplicating the new run', async ({ page }) => {
  await startDelayedBranch(page)
  await openDayTwoBranch(page)
  const dialog = page.getByRole('dialog', { name: 'Branch here' })
  const submit = dialog.getByRole('button', { name: 'Create branch', exact: true })
  await submit.click()
  await expect(submit).toBeDisabled()
  await finishReplay(page, 2, 'fail')
  await expect(dialog.getByRole('alert')).toHaveText('Replay unavailable')
  await expect(page.getByLabel('Branch after day')).toHaveValue('2')
  await expect(submit).toBeEnabled()

  await submit.click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await finishReplay(page, 2)
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 3 / 10 · Ready')
  await expect.poll(() => savedManualProgress(page)).toEqual({ tick: null, days: [1, 2] })
  await openRunLibrary(page)
  const library = page.getByRole('dialog', { name: 'Run Library' })
  const branch = library.locator('article').filter({ has: page.getByText('Browser test run · branch', { exact: true }) })
  await expect(branch).toHaveCount(1)
  await expect(branch).toContainText('Active')
  await expect(branch).toContainText('Saved through Day 2')
})

test('Trends downloads the filtered days and checks that CSV bounds are whole days', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  const download = page.getByRole('button', { name: 'Download', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Download' })
  const confirmDownload = dialog.getByRole('button', { name: 'Download', exact: true })
  await trends.click()
  await download.click()
  await expect(confirmDownload).toBeDisabled()
  await dialog.getByRole('button', { name: 'Setup JSON' }).click()
  await expect(confirmDownload).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  await quickThrough(page, 5)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 5')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByLabel('Filter By Species').selectOption('blue')
  await page.getByRole('combobox', { name: /^Range/ }).selectOption('custom')
  await page.getByRole('spinbutton', { name: 'From day' }).fill('2')
  await page.getByRole('spinbutton', { name: 'To day' }).fill('3')
  await download.click()
  const from = dialog.getByLabel('From day')
  await expect(dialog.getByLabel('Scope')).toHaveValue('blue')
  await expect(from).toHaveValue('2')
  await expect(dialog.getByLabel('Through day')).toHaveValue('3')
  await from.fill('2.5')
  await expect(confirmDownload).toBeDisabled()
  await from.fill('2')
  await expect(dialog.getByText('2 data rows')).toBeVisible()

  const pendingDownload = page.waitForEvent('download')
  await confirmDownload.click()
  const file = await pendingDownload
  expect(file.suggestedFilename()).toBe('evolution-results.csv')
  const csv = await readFile(await file.path(), 'utf8')
  const [header, ...data] = csv.split('\r\n').map(line => line.split(',').map(cell => cell.replaceAll('"', '')))
  const dayIndex = header.indexOf('day'), scopeIndex = header.indexOf('scope')
  expect(data.map(row => [row[dayIndex], row[scopeIndex]])).toEqual([['2', 'blue'], ['3', 'blue']])
})

test('downloaded chart PNG keeps the chart readable on a light page', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByRole('button', { name: 'Focus Population', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Focused chart' })
  const chart = dialog.locator('canvas')
  await expect.poll(() => chart.evaluate(canvas => canvas.width)).toBeGreaterThan(0)
  const source = await chart.evaluate(canvas => ({ width: canvas.width, height: canvas.height }))
  const pendingDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download chart PNG', exact: true }).click()
  const file = await pendingDownload
  expect(file.suggestedFilename()).toBe('population.png')

  const png = await readFile(await file.path())
  const result = await page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    image.close()
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const hasLightMarks = pixels.some((value, index) =>
      index % 4 === 0 && value > 200 && pixels[index + 1] > 200 && pixels[index + 2] > 180)
    return {
      width: canvas.width,
      height: canvas.height,
      background: [...pixels.slice(0, 4)],
      hasLightMarks,
    }
  }, png.toString('base64'))
  expect(result).toEqual({ ...source, background: [36, 36, 36, 255], hasLightMarks: true })
})

test('Jump to chart reaches Overview with separate or combined scales while predictions finish @pages', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message.type === 'forecast') {
        window.finishJumpForecast = () => send.call(this, message, ...rest)
        return
      }
      return send.call(this, message, ...rest)
    }
  })
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()

  const jump = page.getByLabel('Jump to chart')
  const separate = page.getByRole('button', { name: 'Separate scales' })
  const combined = page.getByRole('button', { name: 'Combined scales' })
  const surface = page.locator('#main-surface')
  const overviewOffset = () => page.locator('.trends .overview').evaluate(section =>
    section.getBoundingClientRect().top - section.closest('#main-surface').getBoundingClientRect().top)

  await separate.click()
  await expect(combined).toBeVisible()
  await surface.evaluate(element => element.scrollTo(0, 0))
  await expect.poll(overviewOffset).toBeGreaterThan(100)
  const loading = page.getByText('Preparing predictions…')
  await expect(loading).toBeVisible()
  await expect.poll(() => page.evaluate(() => typeof window.finishJumpForecast)).toBe('function')
  await jump.selectOption({ label: 'Overview' })
  await page.evaluate(() => window.finishJumpForecast())
  await expect(loading).toBeHidden()
  await expect.poll(async () => Math.abs(await overviewOffset())).toBeLessThan(2)

  await combined.click()
  await expect(separate).toBeVisible()
  await surface.evaluate(element => element.scrollTo(0, 0))
  await expect.poll(overviewOffset).toBeGreaterThan(100)
  await jump.selectOption({ label: 'Overview' })
  await expect.poll(async () => Math.abs(await overviewOffset())).toBeLessThan(2)
})

test('Trends chart actions stay inside the selected day range', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 5)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 5')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()

  const chart = page.getByRole('img', { name: /^Population by generation/ })
  const range = page.getByRole('combobox', { name: 'Range', exact: true })
  const pin = page.getByText('Day 5 · Pinned', { exact: true })
  await chart.press('End')
  await expect(pin).toBeVisible()

  await range.selectOption('custom')
  await page.getByRole('spinbutton', { name: 'From day', exact: true }).fill('2')
  await page.getByRole('spinbutton', { name: 'To day', exact: true }).fill('3')
  await chart.press('Enter')
  await expect(pin).toHaveCount(0)
  await expect(trends).toHaveAttribute('aria-current', 'page')

  await range.selectOption('all')
  await expect(pin).toBeVisible()
  await range.selectOption('custom')
  const firstVisible = page.getByText('Day 2 · Pinned', { exact: true })
  await chart.press('ArrowRight')
  await expect(firstVisible).toBeVisible()
  await chart.press('ArrowRight')
  await expect(page.getByText('Day 3 · Pinned', { exact: true })).toBeVisible()
  await chart.press('ArrowLeft')
  await expect(firstVisible).toBeVisible()
  await chart.press('End')
  await expect(page.getByText('Day 3 · Pinned', { exact: true })).toBeVisible()
  await chart.press('Home')
  await expect(firstVisible).toBeVisible()
  await chart.press('Enter')
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 2 / 10 · Replay')
})

test('Find peak pins the highest population in the filtered chart and opens its replay @pages', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('100')
    await page.getByRole('button', { name: 'Orange Off', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Enabled', exact: true }).check()
  })
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const population = page.getByRole('article', { name: 'Population chart', exact: true })
  const peak = population.getByRole('button', { name: 'Find peak' })
  await expect(peak).toBeDisabled()

  await quickThrough(page, 10)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 10')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('combobox', { name: 'Range', exact: true }).selectOption('custom')
  await page.getByRole('spinbutton', { name: 'From day', exact: true }).fill('3')
  await page.getByRole('spinbutton', { name: 'To day', exact: true }).fill('8')
  await peak.click()
  const watch = page.getByRole('button', { name: 'Watch day', exact: true })
  await expect(watch).toHaveAccessibleDescription(/Day 5 · Pinned.*All species · 103 blobs at dawn/)

  await page.getByLabel('Filter By Species').selectOption('orange')
  await peak.press('Enter')
  await expect(watch).toHaveAccessibleDescription(/Day 8 · Pinned.*Orange · 67 blobs at dawn/)
  await expect(watch).toBeFocused()

  await page.getByText('Chart options', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Cohort', exact: true }).selectOption('dusk')
  await page.getByRole('button', { name: 'Focus Population', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Focused chart' })
  await dialog.getByRole('button', { name: 'Find peak' }).click()
  await expect(dialog).toBeHidden()
  await expect(watch).toHaveAccessibleDescription(/Day 7 · Pinned.*Orange · 67 blobs at dusk/)
  await expect(watch).toBeFocused()
  await watch.press('Enter')
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 7 / 10 · Replay')
})

test('Food and Births and Deaths can be hidden and restored by name', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const titles = ['Food', 'Births and Deaths']
  for (const title of titles) {
    await page.getByRole('button', { name: `Hide ${title}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
  }
  for (const title of titles) {
    await page.getByRole('button', { name: `+ ${title}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  }
})

test('Food Schedule previews draft ramp and step values and agrees with the replay @pages', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    const settings = page.getByRole('dialog', { name:'Simulation Settings' })
    const day = settings.getByRole('spinbutton', { name:'Preview day', exact:true })
    const result = settings.getByRole('status')
    const mode = settings.getByLabel('Food schedule')
    const food = settings.getByRole('spinbutton', { name:'Food', exact:true })
    await fixedDay(page, '5')
    await page.getByRole('button', { name: 'Basic', exact: true }).click()
    await food.fill('150')
    await advancedSettings(page)
    await day.fill('3')
    await expect(result).toHaveText('Day 3 · 150 plants at dawn')

    await mode.selectOption('ramp')
    await addFoodPoint(page, 9, 125)
    await addFoodPoint(page, 5, 201)
    await expect(result).toHaveText('Day 3 · 176 plants at dawn')
    for (const [preview, plants] of [[1,150],[5,201],[7,163],[10,125]]) {
      await day.fill(String(preview))
      await expect(result).toHaveText(`Day ${preview} · ${plants} plants at dawn`)
    }

    await day.fill('3')
    await mode.selectOption('step')
    await expect(result).toHaveText('Day 3 · 150 plants at dawn')
    await page.getByRole('button', { name: 'Basic', exact: true }).click()
    await food.fill('160')
    await advancedSettings(page)
    await expect(result).toHaveText('Day 3 · 160 plants at dawn')
    await day.fill('5')
    await expect(result).toHaveText('Day 5 · 201 plants at dawn')

    await day.fill('10.5')
    await expect(day).toHaveAttribute('aria-invalid', 'true')
    await expect(result).toHaveText('Enter a whole day from 1 to 10')
    await day.fill('3')
    const anchor = settings.locator('.schedule-row').nth(0).getByRole('spinbutton', { name:'Day', exact:true })
    await anchor.fill('5')
    await expect(result).toContainText('Use unique days')
    await anchor.fill('9')
    await page.getByRole('button', { name: 'Basic', exact: true }).click()
    await food.fill('150')
    await advancedSettings(page)
    await mode.selectOption('ramp')
    await day.press('Enter')
    await expect(result).toHaveText('Day 3 · 176 plants at dawn')
    await expect(settings).toBeVisible()
  })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name:'Watch last day' }).click()
  await expect(page.getByRole('slider', { name:'Replay time' })).toHaveValue('0')
  await page.getByRole('button', { name:'View options' }).click()
  await page.getByRole('checkbox', { name:'HUD', exact:true }).check()
  await expect(page.locator('.world-hud')).toContainText('Plants left 176')
})

test('food seasons agree on dawn counts in the preview, World, Quick Sim, and Trends @pages', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '15', async () => {
    await fixedDay(page, '5')
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('80')
    await advancedSettings(page, 'Food seasons')
    const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
    const enabled = settings.getByRole('checkbox', { name: 'Enable food seasons' })
    await expect(enabled).not.toBeChecked()
    await enabled.press('Space')
    const day = settings.getByRole('spinbutton', { name: 'Preview day', exact: true })
    for (const [preview, count, phase] of [[1,120,'Peak'], [3,80,'Falling'], [5,40,'Leanest'], [9,80,'Recovering'], [13,120,'Peak']]) {
      await day.fill(String(preview))
      await expect(settings.locator('#food-preview-result')).toHaveText(`Day ${preview} · ${count} plants at dawn`)
      await expect(settings.locator('.season-preview-reading')).toContainText(phase)
    }
    await day.fill('3')
    await expect(settings.getByText('Food cycle · Days 1–13')).toBeVisible()
  })

  const season = page.locator('.world-food-season')
  await expect(season).toHaveText('Food season · Peak · 120 plants at dawn')
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('checkbox', { name: 'HUD', exact: true }).check()
  await expect(page.locator('.world-hud')).toContainText('Plants left 120')
  await page.getByRole('button', { name: 'View options' }).click()
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(season).toHaveText('Food season · Falling · 80 plants at dawn')
  await expect(page.locator('.world-hud')).toContainText('Plants left 80')

  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const plot = page.getByRole('article', { name: 'Food chart' })
  const base = plot.getByRole('button', { name: 'Base schedule' })
  await expect(base).toHaveAttribute('aria-pressed', 'true')
  await base.click()
  await expect(base).toHaveAttribute('aria-pressed', 'false')
  const chart = plot.getByRole('img')
  await chart.press('End')
  await expect(plot.locator('.plot-day-description')).toHaveText('Day 3 · Falling · 100% of base supply')
  await expect(page.getByText('Preparing predictions…')).toBeHidden()
  await chart.press('ArrowRight')
  const predicted = plot.locator('.prediction-reading')
  await expect(predicted).toContainText('Predicted · Day 4')
  await expect(predicted).toContainText(/Food available\s+52/)
  await expect(predicted).toContainText('Falling · 64.64% of base supply')
})

test.describe('food seasons on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })

  test('preserve the draft when toggled off, focus invalid fields, and discard edits @pages', async ({ page }) => {
    await openSimulator(page)
    await page.getByRole('button', { name: 'Simulation Settings' }).tap()
    await advancedSettings(page, 'Food seasons')
    const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
    const enabled = settings.getByRole('checkbox', { name: 'Enable food seasons' })
    const peak = settings.getByRole('spinbutton', { name: 'First peak day in cycle' })
    await enabled.tap()
    await peak.fill('12')
    await settings.getByRole('spinbutton', { name: 'Generations from peak to leanest' }).fill('3')
    await expect(settings.getByText('Cycle length · 11 generations · Pick a first peak day from 1 to 11')).toBeVisible()
    await expect(peak).toHaveAttribute('aria-invalid', 'true')
    await expect(peak).toHaveValue('12')
    await enabled.tap()
    await expect(peak).toBeHidden()
    await enabled.tap()
    await expect(peak).toHaveValue('12')
    await settings.getByRole('button', { name: 'Evolve!' }).tap()
    await expect(peak).toBeFocused()
    await peak.fill('11')
    await expect(settings.locator('.season-plot')).toBeVisible()
    expect(await settings.evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(await settings.evaluate(el => el.clientWidth))
    await settings.getByRole('button', { name: 'Discard changes' }).tap()
    await settings.getByRole('button', { name: 'Discard draft' }).tap()
    await settings.getByRole('button', { name: 'Close settings' }).tap()
    await page.getByRole('button', { name: 'Simulation Settings' }).tap()
    await advancedSettings(page, 'Food seasons')
    await expect(enabled).not.toBeChecked()
  })
})

test('food seasons in a branch start after the fork and keep the saved dawn preview @pages', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await fixedDay(page, '5')
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('500')
  })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await openDayTwoBranch(page)
  await page.getByRole('button', { name: 'Edit branch rules' }).click()
  await advancedSettings(page, 'Food seasons')
  await page.getByRole('checkbox', { name: 'Enable food seasons' }).check()
  await page.getByRole('spinbutton', { name: 'First peak day in cycle' }).fill('3')
  const preview = page.getByRole('spinbutton', { name: 'Preview day', exact: true })
  const count = page.locator('#food-preview-result')
  await preview.fill('2')
  await expect(count).toHaveText('Day 2 · 500 plants at dawn (saved)')
  await expect(page.locator('.season-preview-reading')).toHaveCount(0)
  await preview.fill('3')
  await expect(count).toHaveText('Day 3 · 750 plants at dawn')
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  const season = page.locator('.world-food-season')
  await expect(season).toHaveText('Food season · Peak · 750 plants at dawn')
  await dayTile(page, 2).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 2 / 10 · Replay')
  await expect(season).toHaveCount(0)
})

test('Constant food settings can start after shortening a scheduled run', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await advancedSettings(page)
  const schedule = page.getByLabel('Food schedule')
  await schedule.selectOption('step')
  await addFoodPoint(page, 20, 75)
  await page.getByRole('button', { name: 'Basic', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Days to run' }).fill('10')
  await page.getByRole('button', { name: /^Watch live/ }).click()
  const evolve = page.getByRole('button', { name: 'Evolve!' })
  await evolve.click()
  await expect(page.locator('.settings-errors')).toContainText('Use unique days')
  await expect(schedule).toBeFocused()

  await schedule.selectOption('constant')
  await expect(page.locator('.schedule-row')).toHaveCount(0)
  await expect(page.locator('.settings-errors')).toHaveCount(0)
  await schedule.selectOption('step')
  await expect(page.locator('.schedule-row').getByLabel('Day', { exact: true })).toHaveValue('20')
  await schedule.selectOption('constant')
  await evolve.click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Ready')
})

test('Advanced Settings preview seeded patches and preserve the draft on a phone @pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 650 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await expect(page).toHaveTitle('Evolution Simulator')
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name:'Food', exact:true }).fill('400')
    await page.getByRole('button', { name:/^Advanced Settings/ }).press('Enter')
    await expect(page.getByRole('heading', { name:'Advanced Settings' })).toBeFocused()
    const dialog = page.getByRole('dialog', { name:'Simulation Settings' })
    await dialog.getByRole('button', { name:'Field layout', exact:true }).press('Enter')
    const habitat = dialog.getByRole('region', { name:'Field layout' })
    await expect(habitat.getByLabel('Food schedule')).toHaveCount(0)
    await habitat.getByLabel('Food placement').selectOption('patches')
    await habitat.getByRole('spinbutton', { name:'Number of patches' }).fill('8')
    await habitat.getByRole('spinbutton', { name:'Patch radius' }).fill('60')
    await habitat.getByLabel('Patch relocation').selectOption('interval')
    await habitat.getByRole('spinbutton', { name:'Generations between moves' }).fill('2')
    await habitat.getByLabel('Refuge width').selectOption('20')
    const preview = habitat.getByLabel('Preview day')
    await preview.fill('2')
    const map = habitat.locator('canvas')
    await expect(map).toBeVisible()
    const pixels = () => map.evaluate(canvas => canvas.toDataURL())
    const dayTwo = await pixels()
    await preview.fill('3')
    await expect.poll(pixels).not.toBe(dayTwo)

    const patchCount = habitat.getByRole('spinbutton', { name:'Number of patches' })
    await patchCount.fill('9')
    await advancedSettings(page, 'Plant supply')
    await dialog.getByRole('button', { name:'Evolve!' }).click()
    await expect(patchCount).toBeFocused()
    await patchCount.fill('8')

    await advancedSettings(page, 'Hunting')
    await dialog.getByRole('spinbutton', { name:'Minimum hunting size advantage' }).fill('50')
    const firstHunt = dialog.getByRole('spinbutton', { name:'First hunting day' })
    await firstHunt.fill('11')
    await dialog.getByRole('button', { name:'Basic', exact:true }).click()
    await dialog.getByRole('button', { name:'Evolve!' }).click()
    await expect(firstHunt).toBeFocused()
    await expect(firstHunt).toHaveAccessibleDescription('First hunting day must be a whole number from 1 to 10.')
    await firstHunt.fill('4')
    await advancedSettings(page, 'Plant supply')
    const supply = dialog.getByRole('region', { name:'Plant supply' })
    const supplyPreview = supply.getByLabel('Preview day')
    await expect(supply.getByLabel('Food placement')).toHaveCount(0)
    await expect(supplyPreview).toHaveValue('3')
    await expect(supply).toContainText('Day 3 · 400 plants at dawn')
    await expect(supply).toContainText('Refuge covers 20% from each edge · Hunting off')
    await supplyPreview.fill('4')
    await expect(supply).toContainText('Refuge covers 20% from each edge · Hunting active')
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  })
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name:'Watch last day' }).click()
  await expect(page.getByRole('slider', { name:'Replay time' })).toHaveValue('0')
  expect(errors).toEqual([])
})

test('aging settings inherit, restore drafts, and fit a phone @pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 650 })
  await openSimulator(page)
  await page.getByRole('button', { name:'Simulation Settings' }).click()
  await advancedSettings(page, 'Aging and lifespan')
  const dialog = page.getByRole('dialog', { name:'Simulation Settings' })
  const aging = dialog.getByRole('region', { name:'Aging and lifespan' })
  const species = aging.getByRole('combobox', { name:'Aging rules for' })
  const enabled = aging.getByRole('checkbox', { name:'Enable aging' })
  const custom = aging.getByRole('checkbox', { name:'Use custom settings' })
  const loss = aging.getByRole('spinbutton', { name:/^Travel speed lost/ })
  const preview = aging.getByRole('status')
  await expect(preview).toContainText('100% travel speed · 0% old-age risk')
  await enabled.check()
  await expect(preview).toContainText('80% travel speed · 20% old-age risk')
  await species.selectOption('orange')
  await expect(loss).toBeDisabled()
  await custom.check()
  await enabled.uncheck()
  await expect(preview).toContainText('100% travel speed · 0% old-age risk')
  await expect(loss).toBeDisabled()
  await enabled.check()
  await loss.fill('101')
  await species.selectOption({ label:'Field default' })
  await dialog.getByRole('button', { name:'Basic', exact:true }).click()
  await dialog.getByRole('button', { name:'Evolve!' }).click()
  await expect(species).toHaveValue('orange')
  await expect(loss).toBeFocused()
  await expect(loss).toHaveAccessibleDescription(/from 0 to 100/)
  await custom.uncheck()
  await expect(preview).toContainText('80% travel speed · 20% old-age risk')
  await dialog.getByRole('button', { name:'Discard changes', exact:true }).click()
  await dialog.getByRole('button', { name:'Discard draft', exact:true }).click()
  await expect(species.locator('option:checked')).toHaveText('Field default')
  await expect(enabled).not.toBeChecked()
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
})

test('foraging decisions preview responds to species and settings on a phone @pages', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width:375, height:650 })
  await openSimulator(page)
  await page.getByRole('button', { name:'Simulation Settings' }).click()
  const dialog = page.getByRole('dialog', { name:'Simulation Settings' })
  await dialog.getByRole('button', { name:'Advanced', exact:true }).press('Enter')
  await dialog.getByRole('button', { name:'Foraging decisions', exact:true }).press('Enter')
  await expect(dialog.getByRole('heading', { name:'Creature behavior' })).toBeFocused()
  const group = dialog.getByRole('region', { name:'Foraging decisions' })
  const species = group.getByRole('combobox', { name:'Foraging decisions for' })
  const mode = group.getByRole('combobox', { name:'Foraging rules' })
  const memory = group.getByRole('spinbutton', { name:'Plant memory (seconds)' })
  const chase = group.getByRole('spinbutton', { name:'Maximum prey pursuit (seconds)' })
  const custom = group.getByRole('checkbox', { name:'Use custom settings' })
  const situation = group.getByRole('combobox', { name:'Situation' })
  const result = group.getByRole('status')
  await expect(result).toContainText('Search for another meal')
  await species.selectOption('orange')
  await expect(memory).toBeDisabled()
  await custom.check()
  await expect(memory).toHaveValue('0.6')
  await memory.fill('1.4')
  await expect(result).toContainText('Pursue the remembered plant')
  await situation.selectOption('switch')
  await expect(result).toContainText('Keep the current meal')
  await group.getByRole('spinbutton', { name:'Time saved to switch meals (%)' }).fill('5')
  await expect(result).toContainText('Switch to the quicker meal')
  await situation.selectOption('return')
  await expect(result).toContainText('Go for another meal')
  await group.getByRole('spinbutton', { name:'Return safety margin (steps)' }).fill('8')
  await expect(result).toContainText('Return to the refuge')
  await situation.selectOption('pursuit')
  await expect(result).toContainText('Let the prey go')
  await chase.fill('1.2')
  await expect(result).toContainText('Pursue the prey')
  await chase.fill('0.25')
  await expect(result).toContainText('Enter valid foraging settings')
  await species.selectOption({ label:'Field default' })
  await dialog.getByRole('button', { name:'Basic', exact:true }).click()
  await dialog.getByRole('button', { name:'Evolve!' }).click()
  await expect(species).toHaveValue('orange')
  await expect(chase).toBeFocused()
  await expect(chase).toHaveAccessibleDescription('Use at most one decimal place.')
  await custom.uncheck()
  await expect(chase).toBeDisabled()
  await mode.selectOption('walkthrough')
  await expect(group.getByText(/Video experiment uses its own movement rules/)).toBeVisible()
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await dialog.getByRole('button', { name:'Discard changes', exact:true }).click()
  await dialog.getByRole('button', { name:'Discard draft', exact:true }).click()
  await expect(species.locator('option:checked')).toHaveText('Field default')
  await expect(mode).toHaveValue('standard')
  await expect(memory).toHaveValue('0.6')
  expect(errors).toEqual([])
})

test('foraging decisions match live play and follow replay scrubbing @pages', async ({ page }) => {
  await openSimulator(page)
  const setup = { ...starter(), seed:118, food:500, predation:false, days:10,
    endMode:'timed', duration:100, name:'Foraging test run', mode:'live' }
  Object.assign(setup.foragingDecisions, { plantMemory:1.4, switchSavings:5, returnMargin:8 })
  await openRunLibrary(page)
  await page.getByRole('dialog', { name:'Run Library' }).locator('input[type=file]').setInputFiles({
    name:'foraging.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(setup)),
  })
  await page.getByRole('button', { name:'Evolve!' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 1 / 10 · Ready')
  const details = page.getByRole('complementary', { name:'Creature details' })
  const chooseCreature = details.getByRole('combobox', { name:'Creature', exact:true })
  const decision = details.locator('.foraging-decision')
  const switched = 'Switched to a plant that saves 8.2% of the trip.'
  await page.getByRole('button', { name:'View options' }).click()
  await page.getByRole('button', { name:'Creatures', exact:true }).click()
  await chooseCreature.selectOption('1')
  await expect(decision).toContainText('Searching for a reachable meal')
  for (let tick = 1; tick <= 8; tick++) await stepTo(page, tick / 10)
  await expect(decision).toContainText(switched)

  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name:'Watch last day' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 1 / 10 · Replay')
  if (!await details.isVisible()) {
    await page.getByRole('button', { name:'View options' }).click()
    await page.getByRole('button', { name:'Creatures', exact:true }).click()
  }
  await chooseCreature.selectOption('1')
  const time = page.getByRole('slider', { name:'Replay time' })
  await time.fill('0.8')
  await expect(decision).toContainText(switched)
  await time.fill('1.2')
  await expect(decision).toContainText('Heading home with two food credits')
  await time.fill('1.6')
  await expect(decision).toContainText('Reached the refuge')
  await time.fill('0.8')
  await expect(decision).toContainText(switched)
  await time.fill('0')
  await expect(decision).toContainText('Searching for a reachable meal')
  await time.fill('10')
  await chooseCreature.selectOption('51')
  await expect(decision).toContainText('Born at dusk')
})

test('aging deaths match the forecast and appear in recorded stats and replay @pages', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await fixedDay(page)
    await page.getByRole('spinbutton', { name:'Food', exact:true }).fill('500')
    await page.getByRole('spinbutton', { name:'Random seed' }).fill('118')
    await advancedSettings(page, 'Hunting')
    await page.getByRole('checkbox', { name:'Predation', exact:true }).uncheck()
    await advancedSettings(page, 'Aging and lifespan')
    await page.getByRole('checkbox', { name:'Enable aging' }).check()
    await page.getByRole('spinbutton', { name:'Aging starts after age' }).fill('1')
    await page.getByRole('spinbutton', { name:'Extra old-age death risk per generation' }).fill('0')
    await page.getByRole('checkbox', { name:'Set a maximum lifespan' }).check()
    await page.getByRole('spinbutton', { name:'Maximum lifespan' }).fill('4')
    await expect(page.getByRole('region', { name:'Aging and lifespan' }).getByRole('status'))
      .toContainText('100% old-age risk (maximum lifespan reached)')
  })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name:'Close', exact:true }).click()
  await page.getByRole('link', { name:'Trends', exact:true }).click()
  await page.getByText('Chart options', { exact:true }).click()
  await page.getByRole('checkbox', { name:'Show death causes' }).check()
  const plot = page.getByRole('article', { name:'Births and Deaths chart', exact:true })
  const chart = plot.getByRole('img')
  const reading = plot.getByRole('status')
  await expect(page.getByText('Preparing predictions…')).toBeHidden()
  await chart.press('End')
  await chart.press('ArrowRight')
  await expect(reading).toContainText('Predicted · Day 4')
  await expect(reading).toContainText(/Old age\D+[1-9]\d*/)
  const predicted = (await reading.textContent()).match(/Old age\D+([1-9]\d*)/)[1]

  await quickThrough(page, 4)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 4')
  await page.getByRole('button', { name:'Close', exact:true }).click()
  await page.getByRole('button', { name:'Advanced stats', exact:true }).click()
  const advanced = page.getByRole('dialog', { name:'Advanced stats' })
  const results = advanced.getByRole('region', { name:'Generation readings' })
  await expect(results.getByRole('heading', { name:'Generation 4', exact:true })).toBeVisible()
  await expect(results.getByText('Old age', { exact:true }).locator('xpath=following-sibling::dd[1]')).toHaveText(predicted)
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name:'World', exact:true }).click()
  await dayTile(page, 4).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 4 / 10 · Replay')
  const time = page.getByRole('slider', { name:'Replay time' })
  await expect(time).toHaveValue('0')
  await page.getByRole('button', { name:'View options' }).click()
  await page.getByRole('button', { name:'Creatures', exact:true }).click()
  const details = page.getByRole('complementary', { name:'Creature details' })
  await details.getByRole('combobox', { name:'Creature', exact:true }).selectOption('1')
  await expect(details.getByText('Travel rate', { exact:true }).locator('xpath=following-sibling::dd[1]')).toHaveText('90.0 units/s')
  await time.press('End')
  await expect(time).toHaveValue('10')
  await expect(details.getByText('Dead · Old age', { exact:true })).toBeVisible()
  await expect(details.getByText('Age', { exact:true }).locator('xpath=following-sibling::dd[1]')).toHaveText('4 days')
  expect(errors).toEqual([])
})

test('Settings rejects invalid day lengths instead of rounding them', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
  await fixedDay(page)
  const seconds = settings.getByRole('spinbutton', { name: 'Seconds per day', exact: true })
  const evolve = settings.getByRole('button', { name: 'Evolve!' })
  await settings.getByRole('spinbutton', { name: 'Days to run' }).fill('10')
  await settings.getByRole('button', { name: /^Watch live/ }).click()
  await advancedSettings(page, 'Day length')

  for (const [value, error] of [
    ['10.04', 'Enter seconds in tenths.'],
    ['0.99', 'Seconds per day must be from 1 to 60.'],
    ['60.04', 'Seconds per day must be from 1 to 60.'],
  ]) {
    await seconds.fill(value)
    await advancedSettings(page, 'Hunting')
    await evolve.click()
    await expect(settings.getByRole('navigation', { name: 'Run & charts topics' })
      .getByRole('button', { name: 'Day length' })).toHaveAttribute('aria-pressed', 'true')
    await expect(seconds).toBeFocused()
    await expect(seconds).toHaveAccessibleDescription(error)
    await expect(seconds).toHaveValue(value)
  }

  await seconds.fill('10.3')
  await evolve.click()
  await expect(settings).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Ready')
  await expect(page.getByRole('progressbar', { name: 'Current day elapsed' })).toHaveAttribute('aria-valuemax', '10.3')
})

test('discarding a settings draft clears its species removal undo', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
  const orange = settings.getByRole('button', { name: /^Orange/ })
  const undo = settings.getByRole('button', { name: 'Undo', exact: true })
  const remove = settings.getByRole('button', { name: 'Remove', exact: true })

  await orange.click()
  await settings.getByText('Species actions', { exact: true }).click()
  await remove.click()
  await expect(orange).toHaveCount(0)
  await expect(undo).toBeVisible()
  await settings.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await settings.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await expect(orange).toHaveCount(1)
  await expect(undo).toHaveCount(0)

  await orange.click()
  await remove.click()
  await expect(orange).toHaveCount(0)
  await undo.click()
  await expect(orange).toHaveCount(1)
})

test('discarding edits to a duplicated run restores the duplicated setup', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByLabel('Run name').fill('Archive source')
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('321')
    await page.getByRole('spinbutton', { name: 'Random seed' }).fill('37')
  })
  await startRun(page)

  await openRunLibrary(page)
  const source = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Archive source' })
  await source.getByText('Actions', { exact: true }).click()
  await source.getByRole('button', { name: 'Duplicate', exact: true }).click()

  const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
  const name = settings.getByLabel('Run name')
  const food = settings.getByRole('spinbutton', { name: 'Food', exact: true })
  const discard = settings.getByRole('button', { name: 'Discard changes', exact: true })
  await expect(name).toHaveValue('Archive source copy')
  await expect(food).toHaveValue('321')
  await expect(discard).toHaveCount(0)
  await name.fill('Working title')
  await food.fill('444')

  await settings.getByRole('button', { name: 'Close settings' }).click()
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await expect(name).toHaveValue('Working title')
  await expect(food).toHaveValue('444')
  await advancedSettings(page, 'Movement and energy')
  const foraging = settings.getByRole('combobox', { name: 'Foraging rules' })
  await expect(foraging).toHaveCount(0)
  await settings.getByRole('navigation', { name: 'Creature behavior topics' })
    .getByRole('button', { name: 'Foraging decisions' }).click()
  await foraging.selectOption('walkthrough')
  await discard.click()
  await settings.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await expect(foraging).toHaveValue('standard')
  await settings.getByRole('button', { name: 'Basic', exact: true }).click()
  await expect(name).toHaveValue('Archive source copy')
  await expect(food).toHaveValue('321')
  await expect(settings.getByRole('spinbutton', { name: 'Random seed' })).toHaveValue('37')
  await expect(discard).toHaveCount(0)
})

test('mutation profiles follow the selected species and its trait switches', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await advancedSettings(page, 'Inheritance & mutation')
  const profile = page.getByLabel('Mutation profile')
  const size = page.getByRole('checkbox', { name: 'Allow size mutation' })
  const sense = page.getByRole('checkbox', { name: 'Allow sense mutation' })

  await profile.selectOption('speed')
  await expect(size).not.toBeChecked()
  await expect(sense).not.toBeChecked()
  await page.getByRole('button', { name: /^Orange/ }).click()
  await expect(profile).toHaveValue('all')
  await expect(size).toBeChecked()

  await profile.selectOption('locked')
  await expect(page.getByRole('checkbox', { name: 'Allow speed mutation' })).not.toBeChecked()
  await expect(size).not.toBeChecked()
  await expect(sense).not.toBeChecked()

  await page.getByRole('button', { name: 'Blue', exact: true }).click()
  await expect(profile).toHaveValue('speed')
  await size.check()
  await expect(profile).toHaveValue('')
  await sense.check()
  await expect(profile).toHaveValue('all')
  await page.getByRole('button', { name: /^Orange/ }).click()
  await expect(profile).toHaveValue('locked')
})

test('paired breeding settings show both parents in the saved replay @pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400')
    await page.getByRole('button', { name: /^Reproduction/ }).press('Enter')
    await expect(page.getByRole('heading', { name: 'Life cycle' })).toBeFocused()
    await page.getByLabel('Parent mode').selectOption('pair')
    const chance = page.getByRole('spinbutton', { name: 'Chance of a birth (%)' })
    await chance.fill('101')
    await advancedSettings(page, 'Inheritance & mutation')
    await page.getByRole('button', { name: 'Evolve!' }).click()
    await expect(chance).toBeFocused()
    await expect(chance).toHaveAccessibleDescription('Chance of a birth must be a whole number from 0 to 100.')
    await chance.fill('100')
    await page.getByRole('spinbutton', { name: 'Chance of twins (%)' }).fill('100')
    await advancedSettings(page, 'Inheritance & mutation')
    await page.getByRole('spinbutton', { name: 'Speed mutation chance (%)' }).fill('0')
    await expect(page.getByText('Parents with speeds 8 and 12 give their child a starting speed of 10. The child keeps that speed.')).toBeVisible()
    const dialog = page.getByRole('dialog', { name: 'Simulation Settings' })
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Replay')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Replay')
  await page.getByRole('button', { name: 'Playback actions' }).click()
  await page.getByRole('button', { name: 'Go to end' }).click()
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: 'Creatures', exact: true }).click()
  const details = page.getByRole('complementary', { name: 'Creature details' })
  const creature = details.getByRole('combobox', { name: 'Creature', exact: true })
  await creature.selectOption('51')
  const parents = details.getByText('Parents', { exact: true }).locator('xpath=following-sibling::dd[1]')
  await expect(parents).toHaveText(/^#\d+ and #\d+$/)
  const parentIds = (await parents.textContent()).match(/\d+/g)
  for (const id of parentIds) {
    await creature.selectOption(id)
    await details.getByRole('combobox', { name: 'Filter creature events' }).selectOption('birth')
    await expect(details.getByRole('button', { name: /Offspring #51/ })).toBeVisible()
    await expect(details.getByRole('button', { name: /Offspring #52/ })).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('Trends compares sight spread in the filtered days and opens each closing cohort', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
      if (kind === 'webgl2') return null
      return getContext.call(this, kind, ...options)
    }
    const { fillRect, fill } = CanvasRenderingContext2D.prototype
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (this.canvas.classList.contains('world-canvas') && this.fillStyle === '#242424') window.sightCircles = 0
      return fillRect.apply(this, args)
    }
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (this.canvas.classList.contains('world-canvas') && this.fillStyle === '#e4f5fe') window.sightCircles++
      return fill.apply(this, args)
    }
  })
  await openSimulator(page)
  await startRefugeFixture(page, historicalCohort)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByText('Chart options', { exact: true }).click()
  await page.getByLabel('Cohort').selectOption('dusk')
  await page.getByText('Chart options', { exact: true }).click()
  await page.getByLabel('Filter By Species').selectOption('blue')
  await page.getByRole('combobox', { name: 'Range', exact: true }).selectOption('custom')
  await page.getByLabel('From day').fill('2')
  await page.getByLabel('To day').fill('2')
  await page.getByText('Compare sight ranges', { exact: true }).click()
  await expect(page.getByText(/Choose at least two completed days/)).toBeVisible()
  await page.getByLabel('To day').fill('3')

  const world = page.locator('main.world')
  const clock = page.getByRole('slider', { name: 'Replay time' })
  for (const [day, label, count, spread] of [[2, 'Narrowest', 157, '0.54'], [3, 'Widest', 233, '0.62']]) {
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: label + ' spread · Day ' + day }) })
    await expect(card.getByText(String(count), { exact: true })).toBeVisible()
    await expect(card.getByText(spread, { exact: true })).toBeVisible()
    await card.getByRole('button', { name: 'Show Day ' + day + ' at dusk' }).click()
    await expect(page).toHaveURL(new RegExp('/s/' + day + '/viewer$'))
    await expect(world).toHaveClass(/is-overhead/)
    await expect(clock).toHaveValue(await clock.getAttribute('max'))
    await expect.poll(() => page.evaluate(() => window.sightCircles)).toBe(count)
    if (day === 3) {
      await page.getByRole('button', { name: 'View options' }).click()
      await page.getByRole('button', { name: 'Creatures', exact: true }).click()
      const creatures = page.getByRole('combobox', { name: 'Creature', exact: true })
      const blue = await creatures.getByRole('option', { name: / · Blue$/ }).first().getAttribute('value')
      await creatures.selectOption(blue)
      await page.getByRole('button', { name: 'Close creature details' }).click()
      await page.getByRole('button', { name: 'Layers', exact: true }).click()
      await page.getByRole('button', { name: 'More layer options' }).click()
      await page.getByRole('checkbox', { name: 'Selected creature only' }).check()
      await expect.poll(() => page.evaluate(() => window.sightCircles)).toBe(1)
    }
    await page.goBack()
    await expect(page.getByLabel('Filter By Species')).toHaveValue('blue')
    await expect(page.getByLabel('From day')).toHaveValue('2')
    await expect(card).toBeVisible()
  }
})

test('compact Trends plots fill the dawn spread and read the mean and SD together', async ({ page }) => {
  await page.addInitScript(() => {
    window.ageChart = { texts:[], fills:[] }
    const { fill, fillText } = CanvasRenderingContext2D.prototype
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (this.canvas.closest('#chart-age')) window.ageChart.fills.push(this.fillStyle)
      return fill.apply(this, args)
    }
    CanvasRenderingContext2D.prototype.fillText = function (label, ...args) {
      if (this.canvas.closest('#chart-age')) window.ageChart.texts.push(label)
      return fillText.call(this, label, ...args)
    }
  })
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 4)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 4')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.locator('.walkthrough-plots h2')).toHaveText(['Population', 'Age', 'Speed', 'Size', 'Sense Range'])
  const age = page.locator('#chart-age canvas')
  await expect.poll(() => page.evaluate(() => window.ageChart.fills)).toContain('rgba(253, 222, 59, 0.1)')
  await age.hover({ position:{ x:40, y:60 } })
  await expect.poll(() => page.evaluate(() => window.ageChart.texts)).toContain('Mean  0.00 ± 0.00')
  const day = page.locator('#chart-population canvas')
  await day.focus()
  await day.press('Home')
  await day.press('Space')
  await expect(page.getByText(/50 blobs at dawn/)).toBeVisible()
  await page.getByText('Chart options', { exact: true }).click()
  await page.getByLabel('Cohort').selectOption('dusk')
  await expect(page.getByText(/blobs at dusk/)).toBeVisible()
  await page.getByRole('combobox', { name:'Spread', exact:true }).selectOption('percentile')
  await expect(page.getByText('Dusk · Mean and percentiles')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Dawn · Mean ± SD')).toBeVisible()
  await age.hover({ position:{ x:40, y:60 } })
  await expect.poll(() => page.evaluate(() => window.ageChart.texts)).toContain('Mean  0.00 ± 0.00')
})

test('guided sight comparison opens the early and Day 648 cohorts without changing the active run', async ({ page }) => {
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 2)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const address = page.url()
  await page.getByRole('button', { name: 'Watch the sight example' }).click()
  await expect(page.getByRole('heading', { name: 'Sight across generations' })).toBeVisible()
  const stages = page.getByRole('group', { name: 'Sight comparison stages' })
  const early = stages.getByRole('button', { name: 'Day 1 · Early sight' })
  const later = stages.getByRole('button', { name: 'Day 648 · Later sight' })
  await expect(early).toHaveAttribute('aria-pressed', 'true', { timeout:40000 })
  await expect(page.getByText('Dawn sight · Mean 20.00 ± 0.00 · 50 blobs')).toBeVisible()
  await later.click()
  await expect(later).toHaveAttribute('aria-pressed', 'true')
  const sight = await page.getByText(/^Dawn sight · Mean/).textContent()
  const reading = sight.match(/Mean ([\d.]+) ± ([\d.]+) · (\d+) blobs/)
  expect(reading).not.toBeNull()
  expect(Number(reading[1])).toBeGreaterThan(20)
  expect(Number(reading[2])).toBeGreaterThan(0)
  expect(Number(reading[3])).toBeGreaterThan(1)
  const clock = page.getByRole('slider', { name: 'Example progress' })
  await expect(clock).toHaveValue('1.6')
  await page.getByRole('button', { name: 'Play example', exact:true }).click()
  await expect.poll(async () => Number(await clock.inputValue())).toBeGreaterThan(1.6)
  await page.getByRole('button', { name: 'Back to Trends' }).click()
  await expect(page).toHaveURL(address)
  await expect(page.getByText(/^Browser test run · Seed \d+ · Through Day 2$/)).toBeVisible()
})

test('Trait Space shows exact ages and newborn shares for both days and the selected species', async ({ page }) => {
  await openSimulator(page)
  await startRefugeFixture(page, historicalCohort)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  await page.getByLabel('Filter By Species').selectOption('blue')
  await page.getByRole('combobox', { name: 'Trait', exact: true }).selectOption('age')
  const compare = page.getByRole('spinbutton', { name: 'Compare day' })
  await compare.fill('2')
  await compare.press('Tab')

  const table = page.getByRole('table', { name: 'Living blobs by age' })
  await expect(table.getByRole('columnheader')).toHaveText(['Age (days)', 'Day 3', 'Day 2'])
  const cells = label => table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) }).getByRole('cell')
  await expect(cells('0')).toHaveText(['110', '73'])
  await expect(cells('3')).toHaveText(['32', '0'])
  await expect(cells('Living blobs')).toHaveText(['233', '157'])
  await expect(cells('Newborn share')).toHaveText(['47.2%', '46.5%'])
  await expect(page.getByRole('spinbutton', { name: 'Bins' })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Percentage' }).check()
  await expect(cells('0')).toHaveText(['47.2%', '46.5%'])
  await page.getByLabel('Filter By Species').selectOption('orange')
  await expect(cells('Living blobs')).toHaveText(['78', '40'])
  await compare.fill('0')
  await compare.press('Tab')
  await expect(cells('Living blobs')).toHaveText(['78'])
})

test('Trait Space keeps selections within the species filter and only loads whole days', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400')
    await page.getByRole('button', { name: /^Orange/ }).click()
    await page.getByLabel('Enabled', { exact: true }).check()
    await page.getByRole('spinbutton', { name: 'Sense Range', exact: true }).fill('20')
    await page.getByRole('spinbutton', { name: 'Energy', exact: true }).fill('1000')
  })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  await finishReplay(page, 3)

  const traitSpace = page.locator('.trait-space')
  const creature = traitSpace.getByRole('combobox', { name: /^Creature/ })
  const orange = await creature.locator('option').filter({ hasText: /^Orange #/ }).first().getAttribute('value')
  const species = page.getByLabel('Filter By Species')
  const watchCreature = traitSpace.getByRole('button', { name: 'Watch creature' })
  await creature.selectOption(orange)
  await species.selectOption('orange')
  await expect(creature).toHaveValue(orange)
  await expect(watchCreature).toBeVisible()
  await species.selectOption('blue')
  await expect(creature).toHaveValue('')
  await expect(watchCreature).toHaveCount(0)
  await species.selectOption('all')
  await expect(creature).toHaveValue('')

  const samples = day => traitSpace.getByText(new RegExp(`^Day ${day} · \\d+ samples`))
  const day = traitSpace.getByRole('spinbutton', { name: 'Day', exact: true })
  const compare = traitSpace.getByRole('spinbutton', { name: 'Compare day' })
  const bins = traitSpace.getByRole('spinbutton', { name: 'Bins' })
  const pendingDays = () => page.evaluate(() => [...window.replayTest.jobs.keys()])
  const before = await pendingDays()
  for (const [field, invalid, previous] of [[day, '1.5', '3'], [day, '', '3'], [compare, '2.5', '0'], [bins, '5.5', '20']]) {
    await field.fill(invalid)
    await field.press('Tab')
    await expect(field).toHaveValue(previous)
  }
  await expect(samples(3)).toBeVisible()
  expect(await pendingDays()).toEqual(before)

  await day.fill('2')
  await day.press('Tab')
  await expect(traitSpace.getByRole('status')).toHaveText('Loading Day 2…')
  await expect(traitSpace.getByLabel('Trait histogram')).toHaveCount(0)
  await finishReplay(page, 2)
  await expect(samples(2)).toBeVisible()
  await compare.fill('3')
  await compare.press('Tab')
  const comparisonBars = traitSpace.getByLabel('Trait histogram').locator('rect[fill="#F6AD73"]')
  await expect(comparisonBars.first()).toBeAttached()
  await compare.fill('0')
  await compare.press('Tab')
  await expect(comparisonBars).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Trait Space finds and highlights a creature by ID on the selected day @pages', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRefugeFixture(page, historicalCohort)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()

  const search = page.getByRole('searchbox', { name: 'Creature ID' })
  const result = page.locator('#trait-id-result')
  const creature = page.getByRole('combobox', { name: 'Creature', exact: true })
  const scatter = page.getByLabel('Trait scatter. Drag to rotate.')
  const dot = scatter.locator('circle').filter({ hasText: /^Blue #142$/ })
  await search.pressSequentially('#142')
  await expect(page.getByRole('status')).toHaveText('Loading Day 3…')
  await expect(result).toHaveText('')
  await finishReplay(page, 3)
  await expect(result).toHaveText('Selected Blue #142 on Day 3')
  await expect(creature).toHaveValue('142')
  await expect(dot).toHaveAttribute('stroke', '#FFFDFC')
  await expect(scatter.locator('circle').last()).toHaveText('Blue #142')

  const species = page.getByLabel('Filter By Species')
  await species.selectOption('orange')
  await expect(result).toHaveText('Creature #142 is hidden by the species filter on Day 3')
  await expect(creature).toHaveValue('')
  await species.selectOption('all')
  await expect(dot).toHaveAttribute('stroke', '#FFFDFC')

  const day = page.getByRole('spinbutton', { name: 'Day', exact: true })
  await day.fill('1')
  await day.press('Tab')
  await expect(result).toHaveText('')
  await finishReplay(page, 1)
  await expect(result).toHaveText('Creature #142 wasn’t found among the living creatures on Day 1')
  await expect(scatter.locator('circle[stroke="#FFFDFC"]')).toHaveCount(0)

  await day.fill('3')
  await day.press('Tab')
  await search.fill('142')
  await expect(result).toHaveText('Selected Blue #142 on Day 3')
  await search.fill('#142x')
  await expect(result).toHaveText('Enter a creature ID like #142')
  await expect(creature).toHaveValue('')
  await creature.selectOption({ index:1 })
  await expect(search).toHaveValue('')
  await expect(scatter.locator('circle[stroke="#FFFDFC"]')).toHaveCount(1)
})

test('Trait Space centers the mean over a histogram with one trait value', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400')
    await advancedSettings(page, 'Inheritance & mutation')
    await page.getByLabel('Allow sense mutation').uncheck()
    await page.getByRole('button', { name: 'Basic', exact: true }).click()
    await page.getByRole('button', { name: /^Orange/ }).click()
    await page.getByLabel('Enabled', { exact: true }).check()
    await page.getByRole('spinbutton', { name: 'Sense Range', exact: true }).fill('30')
    await page.getByRole('spinbutton', { name: 'Energy', exact: true }).fill('1000')
    await advancedSettings(page, 'Inheritance & mutation')
    await page.getByLabel('Allow sense mutation').uncheck()
  })
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const species = page.getByLabel('Filter By Species')
  await species.selectOption('blue')
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  const traitSpace = page.locator('.trait-space')
  await traitSpace.getByRole('combobox', { name: 'Trait', exact: true }).selectOption('sense')

  const histogram = traitSpace.getByLabel('Trait histogram')
  const mean = histogram.locator('line[stroke-dasharray]')
  const axisLabels = histogram.locator('text')
  await expect(histogram.locator('rect')).toHaveCount(1)
  await expect(mean).toHaveAttribute('x1', '380')
  await expect(mean).toHaveAttribute('x2', '380')
  await expect(axisLabels).toHaveText(['20.00'])
  await expect(axisLabels.first()).toHaveAttribute('x', '380')

  await species.selectOption('all')
  await expect(axisLabels).toHaveText(['20.00', '30.00'])
  const position = Number(await mean.getAttribute('x1'))
  expect(position).toBeGreaterThan(30)
  expect(position).toBeLessThan(730)
})

test('Trait Space can retry a failed day without changing the selected day', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400')
  })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  const species = page.getByLabel('Filter By Species')
  await species.selectOption('blue')
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()

  const traitSpace = page.locator('.trait-space')
  const day = traitSpace.getByRole('spinbutton', { name: 'Day', exact: true })
  const retry = traitSpace.getByRole('button', { name: 'Retry Day 3' })
  await finishReplay(page, 3, 'fail')
  const alert = traitSpace.getByRole('alert')
  await expect(alert).toHaveText('Could not load Day 3. Replay unavailable')
  await expect(day).toHaveValue('3')

  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(traitSpace.getByRole('status')).toHaveText('Loading Day 3…')
  await expect(retry).toHaveCount(0)
  await finishReplay(page, 3)
  await expect(traitSpace.getByText(/^Day 3 · \d+ samples/)).toBeVisible()
  await expect(traitSpace.getByLabel('Trait histogram')).toBeVisible()
  await expect(alert).toHaveCount(0)
  await expect(day).toHaveValue('3')
  await expect(species).toHaveValue('blue')
})

test('Trait Space retries a failed comparison without losing the primary day', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400')
  })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  await finishReplay(page, 3)

  const traitSpace = page.locator('.trait-space')
  const samples = traitSpace.getByText(/^Day 3 · \d+ samples/)
  const creature = traitSpace.getByRole('combobox', { name: /^Creature/ })
  await expect(samples).toBeVisible()
  await creature.selectOption({ index: 1 })
  const creatureId = await creature.inputValue()
  const compare = traitSpace.getByRole('spinbutton', { name: 'Compare day' })
  const comparisonBars = traitSpace.getByLabel('Trait histogram').locator('rect[fill="#F6AD73"]')
  await compare.fill('2')
  await compare.press('Tab')
  await finishReplay(page, 2, 'fail')
  await expect(traitSpace.getByText('Could not load comparison Day 2. Replay unavailable')).toBeVisible()
  await expect(samples).toBeVisible()
  await expect(comparisonBars).toHaveCount(0)

  const retry = traitSpace.getByRole('button', { name: 'Retry comparison Day 2' })
  await expect(retry).toBeEnabled({ timeout: 3000 })
  await retry.click()
  await expect(traitSpace.getByRole('status')).toHaveText('Loading comparison Day 2…')
  await expect(retry).toHaveCount(0)
  await finishReplay(page, 2)

  await expect(comparisonBars.first()).toBeAttached()
  await expect(traitSpace.getByRole('status')).toHaveCount(0)
  await expect(traitSpace.getByRole('alert')).toHaveCount(0)
  await expect(compare).toHaveValue('2')
  await expect(samples).toBeVisible()
  await expect(creature).toHaveValue(creatureId)
})

test('Run Library ranks exact seed matches before partial seeds and run names @pages', async ({ page }) => {
  await openSimulator(page)
  for (const [name, seed] of [['Control field','118'], ['Repeat field','118'], ['Nearby seed','2118'], ['118 notes','70']]) {
    await startRun(page, '10', async () => {
      await page.getByLabel('Run name').fill(name)
      await page.getByRole('spinbutton', { name: 'Random seed' }).fill(seed)
    })
  }
  await openRunLibrary(page)
  const library = page.getByRole('dialog', { name: 'Run Library' })
  const search = library.getByRole('searchbox', { name: 'Search runs by name or seed' })
  const names = library.locator('article strong')

  await search.pressSequentially('118')
  await expect(names).toHaveText(['Repeat field', 'Control field', '118 notes', 'Nearby seed'])
  await search.fill('  cOnTrOl  ')
  await expect(names).toHaveText(['Control field'])
  await search.fill('9999')
  await expect(library.getByText('No matching saved runs.')).toBeVisible()
  await search.fill('')
  await expect(names.first()).toHaveText('118 notes')
})

for (const [width, height] of [[320, 420], [1280, 900]]) {
  test(`Run Library actions fit at ${width} × ${height}${width === 320 ? ' @pages' : ''}`, async ({ page }) => {
    await openSimulator(page)
    await startRun(page, '10', () => page.getByLabel('Run name').fill('Archived field'))
    await startRun(page, '10', () => page.getByLabel('Run name').fill('Active field'))
    await page.setViewportSize({ width, height })
    await openRunLibrary(page)

    const library = page.getByRole('dialog', { name: 'Run Library' })
    const active = library.locator('article').filter({ hasText: '● Active' })
    const archive = library.locator('article').filter({ hasText: 'Archived field' })
    const activeToggle = active.getByRole('button', { name: 'Actions', exact: true })
    const archiveToggle = archive.getByRole('button', { name: 'Actions', exact: true })
    const activePanel = active.getByRole('group', { name: /^Actions for / })
    const archivePanel = archive.getByRole('group', { name: 'Actions for Archived field' })
    const verifyFit = async panel => {
      await expect(panel).toBeVisible()
      expect(await panel.evaluate(element => {
        const dialog = element.closest('dialog')
        const left = dialog.getBoundingClientRect().left + dialog.clientLeft
        const right = left + dialog.clientWidth
        const bounds = element.getBoundingClientRect()
        return dialog.scrollWidth === dialog.clientWidth && bounds.left >= left && bounds.right <= right &&
          [...element.querySelectorAll('button')].every(button => {
            const rect = button.getBoundingClientRect()
            return rect.left >= bounds.left && rect.right <= bounds.right && button.scrollWidth <= button.clientWidth
          })
      })).toBe(true)
    }

    await activeToggle.press('Enter')
    await expect(activeToggle).toBeFocused()
    await expect(activeToggle).toHaveAttribute('aria-expanded', 'true')
    await verifyFit(activePanel)
    await expect(activePanel.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    await activeToggle.press('Space')
    await expect(activeToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(activePanel).toBeHidden()
    await activeToggle.press('Space')
    await page.keyboard.press('Tab')
    await expect(activePanel.getByRole('button', { name: 'View results' })).toBeFocused()
    await activePanel.getByRole('button', { name: 'Rename', exact: true }).click()
    await active.getByLabel('Name', { exact: true }).fill('Renamed field')
    await active.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(active).toContainText('Renamed field')

    await archiveToggle.click()
    await expect(activeToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(activePanel).toBeHidden()
    await expect(archiveToggle).toHaveAttribute('aria-expanded', 'true')
    await verifyFit(archivePanel)
    await expect(archivePanel.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
    const pendingDownload = page.waitForEvent('download')
    await archivePanel.getByRole('button', { name: 'Export setup' }).click()
    const file = await pendingDownload
    expect(file.suggestedFilename()).toBe('evolution-setup.json')
    const exported = JSON.parse(await readFile(await file.path(), 'utf8'))
    expect(exported.setup).toMatchObject({ name: 'Archived field', days: 10 })
    expect(exported.revisions).toEqual([])
  })
}

test('renaming the active run keeps days whose saves are still pending', async ({ page }) => {
  await installSaveDelay(page)
  await openSimulator(page)
  await startRun(page)
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const closeDialog = page.getByRole('button', { name: 'Close dialog' })
  const library = page.getByRole('dialog', { name: 'Run Library' })

  await openRunLibrary(page)
  const active = library.locator('article').filter({ hasText: 'Browser test run' })
  await expect(active).toContainText('Saved through Day 0')
  await closeDialog.click()
  await page.evaluate(() => { window.saveTest.hold = true })
  await quickThrough(page, 3)
  await expect(page.getByRole('heading', { name: 'Simulation complete' })).toBeVisible()
  await expect(batchStatus(page, 'Completed through')).toHaveText('Day 3')
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 0')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await openRunLibrary(page)
  await active.getByText('Actions', { exact: true }).click()
  await active.getByRole('button', { name: 'Rename', exact: true }).click()
  await active.getByLabel('Name', { exact: true }).fill('Renamed field')
  await active.getByRole('button', { name: 'Save', exact: true }).click()
  await closeDialog.click()
  await expect(runOptions).toHaveAttribute('title', 'Renamed field')
  await expect(dayTile(page, 3)).toBeVisible()

  await releaseSaves(page)
  await openRunLibrary(page)
  await expect(library.locator('article').filter({ hasText: 'Renamed field' })).toContainText('Saved through Day 3')
  await page.reload()
  await expect(runOptions).toHaveAttribute('title', 'Renamed field')
  await expect(dayTile(page, 3)).toBeVisible()
})

test('resuming a run keeps completed days while saves are pending', async ({ page }) => {
  await installSaveDelay(page)
  await openSimulator(page)
  await startRun(page, '10', () => page.getByLabel('Run name').fill('Other run'))
  await startRun(page)
  const library = page.getByRole('dialog', { name: 'Run Library' })
  const original = library.locator('article').filter({ hasText: 'Browser test run' })
  const other = library.locator('article').filter({ hasText: 'Other run' })
  const runOptions = page.getByRole('button', { name: 'Run options' })
  await openRunLibrary(page)
  await expect(original).toContainText('Saved through Day 0')
  await expect(other).toContainText('Saved through Day 0')
  await page.getByRole('button', { name: 'Close dialog' }).click()

  await page.evaluate(() => { window.saveTest.hold = true })
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Completed through')).toHaveText('Day 3')
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 0')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await openRunLibrary(page)
  await other.getByRole('button', { name: 'Resume' }).click()
  await expect(runOptions).toHaveAttribute('title', 'Other run')
  await openRunLibrary(page)
  await original.getByRole('button', { name: 'Resume' }).click()
  await expect(runOptions).toHaveAttribute('title', 'Browser test run')
  await expect(runOptions).toHaveText('Day 4 / 10 · Ready')
  await expect(dayTile(page, 3)).toBeVisible()

  await quickThrough(page, 4)
  await expect(batchStatus(page, 'Completed in this batch')).toHaveText('1 of 1')
  await expect(batchStatus(page, 'Completed through')).toHaveText('Day 4')
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 0')
  await releaseSaves(page)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 4')
  await page.reload()
  await expect(dayTile(page, 3)).toBeVisible()
  await expect(dayTile(page, 4)).toBeVisible()
})

async function installBatchHold(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const batch = window.batchTest = { hold: false, release: null, stopping: false }
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (data.type === 'batch' && batch.hold) {
          batch.hold = false
          batch.release = () => {
            batch.release = null
            super.postMessage(data)
            if (batch.stopping) super.postMessage({ type: 'stop' })
          }
          return
        }
        if (data.type === 'stop' && batch.release) {
          batch.stopping = true
          return
        }
        return super.postMessage(data)
      }
    }
  })
}

test('switching runs saves the day Quick Sim was working on', async ({ page }) => {
  await installBatchHold(page)
  await openSimulator(page)
  await startRun(page, '10', () => page.getByLabel('Run name').fill('Other run'))
  await startRun(page)
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const library = page.getByRole('dialog', { name: 'Run Library' })
  const original = library.locator('article').filter({ hasText: 'Browser test run' })
  const other = library.locator('article').filter({ hasText: 'Other run' })
  await page.evaluate(() => { window.batchTest.hold = true })
  await quickThrough(page, 5)
  await page.getByRole('button', { name: 'Hide progress', exact: true }).click()

  await openRunLibrary(page)
  await other.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(runOptions).toHaveText('Day 1 / 10 · Stopping batch')
  await expect(runOptions).toHaveAttribute('title', 'Browser test run')
  expect(await page.evaluate(() => window.batchTest.stopping)).toBe(true)
  await page.evaluate(() => window.batchTest.release())
  await expect(runOptions).toHaveAttribute('title', 'Other run')

  await openRunLibrary(page)
  await expect(original).toContainText('Saved through Day 1')
  await original.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(runOptions).toHaveText('Day 2 / 10 · Ready')
  await expect(dayTile(page, 1)).toBeVisible()
  await expect(page).toHaveURL(/\/s\/2\/viewer$/)
  await page.reload()
  await expect(runOptions).toHaveText('Day 2 / 10 · Ready')
  await expect(dayTile(page, 1)).toBeVisible()
})

test('viewing the active run results keeps Quick Sim running', async ({ page }) => {
  await installBatchHold(page)
  await openSimulator(page)
  await startRun(page)
  const library = page.getByRole('dialog', { name: 'Run Library' })
  const active = library.locator('article').filter({ hasText: 'Browser test run' })
  await page.evaluate(() => { window.batchTest.hold = true })
  await quickThrough(page, 5)
  await page.getByRole('button', { name: 'Hide progress', exact: true }).click()

  await openRunLibrary(page)
  await active.getByText('Actions', { exact: true }).click()
  await active.getByRole('button', { name: 'View results' }).click()
  await expect(page).toHaveURL(/\/stats$/)
  await expect(page.getByText(/Browser test run .* Through Day 0 · Simulating/)).toBeVisible()
  expect(await page.evaluate(() => window.batchTest.stopping)).toBe(false)

  await page.getByRole('button', { name: 'Progress', exact: true }).click()
  await page.evaluate(() => window.batchTest.release())
  await expect(page.getByRole('heading', { name: 'Simulation complete' })).toBeVisible()
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 5')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText(/Browser test run .* Through Day 5/)).toBeVisible()
})

test('a copied setup link keeps the shared settings after reload', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('321')
    await page.getByRole('spinbutton', { name: 'Random seed' }).fill('118')
    await advancedSettings(page, 'Reproduction')
    await page.getByLabel('Parent mode').selectOption('pair')
    await page.getByRole('spinbutton', { name: 'Chance of twins (%)' }).fill('80')
    await advancedSettings(page, 'Inheritance & mutation')
    await page.getByLabel('Mutation pattern').selectOption('bounded')
    await page.getByRole('spinbutton', { name: 'Speed mutation chance (%)' }).fill('35')
    await page.getByRole('spinbutton', { name: 'σ Size', exact: true }).fill('1.00')
    await advancedSettings(page, 'Aging and lifespan')
    await page.getByRole('combobox', { name:'Aging rules for' }).selectOption('orange')
    await page.getByRole('checkbox', { name:'Use custom settings' }).check()
    await page.getByRole('combobox', { name:'Aging rules for' }).selectOption({ label:'Field default' })
    await page.getByRole('checkbox', { name:'Enable aging' }).check()
    await page.getByRole('spinbutton', { name:'Extra old-age death risk per generation' }).fill('2.5')
    await advancedSettings(page, 'Food seasons')
    await page.getByRole('checkbox', { name: 'Enable food seasons' }).check()
    await page.getByRole('spinbutton', { name: 'Peak supply (%)' }).fill('180')
  })
  await page.getByRole('button', { name: 'Run options' }).click()
  await page.getByRole('button', { name: 'Run Library' }).click()
  const run = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Browser test run' })
  await run.getByText('Actions', { exact: true }).click()
  await run.getByRole('button', { name: 'Copy setup link' }).click()
  await expect(page.getByText('Setup link copied. It opens a new experiment draft.')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toContain('#/setup/')
  const downloaded = page.waitForEvent('download')
  await run.getByRole('button', { name: 'Export setup' }).click()
  const exported = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'))
  expect(exported.setup.reproduction).toMatchObject({ parentMode: 'pair', twinChance: 80 })
  expect(exported.setup.species[0].inheritance).toMatchObject({ mutationPattern: 'bounded', mutationChance: { speed: 35 } })
  expect(exported.setup.aging).toMatchObject({ enabled:true, riskIncrease:2.5 })
  expect(exported.setup.species[1].aging).toMatchObject({ enabled:false, riskIncrease:5 })
  expect(exported.setup.foodSeasons).toMatchObject({ enabled: true, peak: 180 })

  const recipient = await browser.newPage()
  try {
    const settings = recipient.getByRole('dialog', { name: 'Simulation Settings' })
    const name = settings.getByLabel('Run name')
    const food = settings.getByRole('spinbutton', { name: 'Food', exact: true })
    await recipient.goto(link)
    await expect(name).toHaveValue('Browser test run')
    await expect(food).toHaveValue('321')

    await recipient.reload()
    await expect(name).toHaveValue('Browser test run')
    await expect(food).toHaveValue('321')
    await expect(settings.getByRole('spinbutton', { name: 'Random seed' })).toHaveValue('118')
    await advancedSettings(recipient, 'Reproduction')
    await expect(settings.getByLabel('Parent mode')).toHaveValue('pair')
    await expect(settings.getByRole('spinbutton', { name: 'Chance of twins (%)' })).toHaveValue('80')
    await advancedSettings(recipient, 'Inheritance & mutation')
    await expect(settings.getByRole('spinbutton', { name: 'σ Size', exact: true })).toHaveValue('1.00')
    await expect(settings.getByLabel('Mutation pattern')).toHaveValue('bounded')
    await expect(settings.getByRole('spinbutton', { name: 'Speed mutation chance (%)' })).toHaveValue('35')
    await advancedSettings(recipient, 'Aging and lifespan')
    const enabled = settings.getByRole('checkbox', { name:'Enable aging' })
    await expect(enabled).toBeChecked()
    await expect(settings.getByRole('spinbutton', { name:'Extra old-age death risk per generation' })).toHaveValue('2.5')
    await settings.getByRole('combobox', { name:'Aging rules for' }).selectOption('orange')
    await expect(settings.getByRole('checkbox', { name:'Use custom settings' })).toBeChecked()
    await expect(enabled).not.toBeChecked()
    await advancedSettings(recipient, 'Food seasons')
    await expect(settings.getByRole('checkbox', { name: 'Enable food seasons' })).toBeChecked()
    await expect(settings.getByRole('spinbutton', { name: 'Peak supply (%)' })).toHaveValue('180')
    await expect(recipient).toHaveURL(link)

    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(recipient).toHaveURL(/#\/r\/[^/]+\/s\/\d+\/viewer$/)
    await recipient.reload()
    await expect(recipient.getByRole('button', { name: 'Simulation Settings' })).toBeEnabled()
    await expect(settings).toHaveCount(0)

    await recipient.goto(link)
    await settings.getByRole('button', { name: 'Evolve!' }).click()
    await expect(recipient.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Ready')
    await expect(recipient).toHaveURL(/#\/r\/[^/]+\/s\/1\/viewer$/)

    await openRunLibrary(recipient)
    await recipient.getByRole('dialog', { name: 'Run Library' }).locator('input[type=file]').setInputFiles({
      name: 'evolution-setup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)),
    })
    await expect(food).toHaveValue('321')
    await advancedSettings(recipient, 'Reproduction')
    await expect(settings.getByLabel('Parent mode')).toHaveValue('pair')
    await expect(settings.getByRole('spinbutton', { name: 'Chance of twins (%)' })).toHaveValue('80')
    await advancedSettings(recipient, 'Inheritance & mutation')
    await expect(settings.getByRole('spinbutton', { name: 'Speed mutation chance (%)' })).toHaveValue('35')
    await advancedSettings(recipient, 'Food seasons')
    await expect(settings.getByRole('checkbox', { name: 'Enable food seasons' })).toBeChecked()
    await expect(settings.getByRole('spinbutton', { name: 'Peak supply (%)' })).toHaveValue('180')
  } finally {
    await recipient.close()
  }
})

test('foraging field defaults and explicit species overrides survive setup sharing and imports @pages', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await advancedSettings(page, 'Foraging decisions')
    const species = page.getByRole('combobox', { name:'Foraging decisions for' })
    const custom = page.getByRole('checkbox', { name:'Use custom settings' })
    await species.selectOption('orange')
    await custom.check()
    await species.selectOption('blue')
    await custom.check()
    await page.getByRole('spinbutton', { name:'Plant memory (seconds)' }).fill('2.9')
    await page.getByRole('spinbutton', { name:'Time saved to switch meals (%)' }).fill('95')
    await page.getByRole('spinbutton', { name:'Return safety margin (steps)' }).fill('20')
    await page.getByRole('spinbutton', { name:'Maximum prey pursuit (seconds)' }).fill('3.0')
    await species.selectOption({ label:'Field default' })
    await page.getByRole('spinbutton', { name:'Plant memory (seconds)' }).fill('1.4')
    await page.getByRole('spinbutton', { name:'Time saved to switch meals (%)' }).fill('0')
    await page.getByRole('spinbutton', { name:'Return safety margin (steps)' }).fill('0')
    await page.getByRole('spinbutton', { name:'Maximum prey pursuit (seconds)' }).fill('0.0')
  })
  await page.reload()
  await openRunLibrary(page)
  const run = page.getByRole('dialog', { name:'Run Library' }).locator('article').filter({ hasText:'Browser test run' })
  await run.getByText('Actions', { exact:true }).click()
  await run.getByRole('button', { name:'Copy setup link' }).click()
  await expect(page.getByText('Setup link copied. It opens a new experiment draft.')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const download = page.waitForEvent('download')
  await run.getByRole('button', { name:'Export setup' }).click()
  const contents = await readFile(await (await download).path())
  const { setup } = JSON.parse(contents)
  expect(setup.foragingDecisions).toEqual({ plantMemory:1.4, switchSavings:0, returnMargin:0, preyPursuit:0 })
  expect(setup.species[0].foragingDecisions).toEqual({ plantMemory:2.9, switchSavings:95, returnMargin:20, preyPursuit:3 })
  expect(setup.species[1].foragingDecisions.plantMemory).toBe(0.6)
  const recipient = await browser.newPage()
  try {
    await recipient.goto(link)
    await recipient.reload()
    const species = recipient.getByRole('combobox', { name:'Foraging decisions for' })
    const memory = recipient.getByRole('spinbutton', { name:'Plant memory (seconds)' })
    const pursuit = recipient.getByRole('spinbutton', { name:'Maximum prey pursuit (seconds)' })
    const custom = recipient.getByRole('checkbox', { name:'Use custom settings' })
    await advancedSettings(recipient, 'Foraging decisions')
    await expect(memory).toHaveValue('1.4')
    await expect(pursuit).toHaveValue('0.0')
    await species.selectOption('blue')
    await expect(custom).toBeChecked()
    await expect(memory).toHaveValue('2.9')
    await expect(pursuit).toHaveValue('3.0')
    await species.selectOption('orange')
    await expect(custom).toBeChecked()
    await expect(memory).toHaveValue('0.6')

    await recipient.getByRole('button', { name:'Close settings' }).click()
    await openRunLibrary(recipient)
    await recipient.getByRole('dialog', { name:'Run Library' }).locator('input[type=file]').setInputFiles({
      name:'foraging-setup.json', mimeType:'application/json', buffer:contents,
    })
    await advancedSettings(recipient, 'Foraging decisions')
    await expect(memory).toHaveValue('1.4')
    await species.selectOption('orange')
    await expect(custom).toBeChecked()
    await expect(memory).toHaveValue('0.6')
  } finally {
    await recipient.close()
  }
})

test('Watch creature follows a newborn at dusk or at the next recorded dawn', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('400'))
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  const close = page.getByRole('button', { name: 'Close', exact: true })
  await close.click()
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()
  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  const creatures = page.locator('.trait-space').getByRole('combobox', { name: /^Creature/ })
  // Day 1 starts with 50 founders, so #51 is the first newborn.
  await creatures.selectOption('51')
  const watchCreature = page.getByRole('button', { name: 'Watch creature' })
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const replayTime = page.getByRole('slider', { name: 'Replay time' })
  const current = page.getByRole('button', { name: /Current creature details.*#51/ })
  await watchCreature.click()
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  const end = Number(await replayTime.getAttribute('max'))
  await expect.poll(async () => Math.abs(Number(await replayTime.inputValue()) - end)).toBeLessThan(1e-8)
  await expect(current).toBeVisible()
  await current.click()
  await expect(page.getByRole('button', { name: /Born to #/ })).toBeVisible()

  await quickThrough(page, 2)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
  await close.click()
  await trends.click()
  await watchCreature.click()
  await expect(runOptions).toHaveText('Day 2 / 10 · Replay')
  await expect(replayTime).toHaveValue('0')
  await expect(current).toBeVisible()
})

test('a replay applies the predation threshold saved with its setup', async ({ page }) => {
  await openSimulator(page)
  const setup = { ...starter(), days: 10, mode: 'live', sameSpecies: false }
  Object.assign(setup.species[0], { energy: 1000, sense: 60 })
  Object.assign(setup.species[1], { enabled: true, count: 30, size: 12, energy: 1000, sense: 60 })

  for (const [version, threshold] of [[setup.version, 25], [LEGACY_RULE_VERSION, 20]]) {
    const species = version === LEGACY_RULE_VERSION
      ? setup.species.map(({ standardDeviation, ...s }) => ({ ...s, variance:{ speed:.25, size:.25, sense:.25 } }))
      : setup.species
    await openRunLibrary(page)
    await page.getByRole('dialog', { name: 'Run Library' }).locator('input[type=file]').setInputFiles({
      name: 'predation.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...setup, version, species })),
    })
    if (version === LEGACY_RULE_VERSION) {
      await advancedSettings(page, 'Inheritance & mutation')
      await expect(page.getByRole('spinbutton', { name: 'σ² Size', exact: true })).toHaveValue('0.25')
    }
    await advancedSettings(page, 'Hunting')
    if (version === LEGACY_RULE_VERSION) {
      await expect(page.getByText(`A hunter must be at least ${threshold}% larger than its prey.`)).toBeVisible()
    } else {
      await expect(page.getByRole('spinbutton', { name:'Minimum hunting size advantage' })).toHaveValue(String(threshold))
    }
    await page.getByRole('button', { name: 'Evolve!' }).click()
    await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Ready')

    await quickThrough(page, 1)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
    await page.getByRole('button', { name: 'Watch last day' }).click()
    await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Replay')
    await page.reload()

    const time = page.getByRole('slider', { name: 'Replay time' })
    await time.fill('0')
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('button', { name: 'Creatures', exact: true }).click()
    const details = page.getByRole('complementary', { name: 'Creature details' })
    await details.getByRole('combobox', { name: 'Creature', exact: true }).selectOption('51')
    await details.getByRole('combobox', { name: 'Filter creature events' }).selectOption('prey')
    await time.fill('0.2')
    if (version === LEGACY_RULE_VERSION) {
      await expect(details.getByRole('button', { name: /Hunted #7$/ })).toBeVisible()
    } else {
      await expect(details.getByText('No matching events at this point in the day.')).toBeVisible()
    }
  }
})

test('replay shows food credits without refills and refuge distance while returning', async ({ page }) => {
  await openSimulator(page)
  await startRefugeFixture(page)
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Replay')

  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: 'Creatures', exact: true }).click()
  const details = page.getByRole('complementary', { name: 'Creature details' })
  await details.getByRole('combobox', { name: 'Creature', exact: true }).selectOption('1')
  const time = page.getByRole('slider', { name: 'Replay time' })
  const distance = details.getByText(/^\d[\d,.]* units from the nearest refuge$/)
  await expect(distance).toHaveCount(0)

  const credits = details.getByText('Food credits', { exact: true }).locator('xpath=following-sibling::dd[1]')
  await time.fill('0.6')
  await expect(credits).toHaveText('0')
  await expect(details.getByText('440.0 / 500 energy')).toBeVisible()
  await time.fill('0.7')
  await expect(credits).toHaveText('1')
  await expect(details.getByText('430.0 / 500 energy')).toBeVisible()

  // Founder #1's center is at x=107.6 on the way to the left side of the gray border.
  await time.fill('1.1')
  await expect(details.getByText('Returning', { exact: true })).toBeVisible()
  await expect(distance).toHaveText('57.6 units from the nearest refuge')

  await time.fill('2')
  await expect(details.getByText('Home', { exact: true })).toBeVisible()
  await expect(distance).toHaveCount(0)
})

test('Creature Details copies the selected creature and day as plain text @pages', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await fixedDay(page, '5')
    await page.getByRole('spinbutton', { name:'Food', exact:true }).fill('400')
  })
  await page.getByRole('button', { name:'View options' }).click()
  await page.getByRole('button', { name:'Creatures', exact:true }).click()
  const details = page.getByRole('complementary', { name:'Creature details' })
  const creature = details.getByRole('combobox', { name:'Creature', exact:true })
  const copy = details.getByRole('button', { name:'Copy stats' })
  const status = details.getByRole('status')
  const readClipboard = () => page.evaluate(() => navigator.clipboard.readText())
  const statsText = async (day, id) => {
    const lines = ['ID: #'+id, 'Species: Blue', 'Day: '+day]
    for (const label of ['Speed', 'Size', 'Sense range']) {
      const stat = details.getByText(label, { exact:true }).locator('xpath=following-sibling::dd[1]')
      lines.push(label+': '+await stat.innerText())
    }
    return lines.join('\n')
  }

  await expect(copy).toHaveCount(0)
  await creature.selectOption('1')
  await copy.press('Enter')
  await expect(status).toHaveText('Stats copied')
  expect(await readClipboard()).toBe(await statsText(1, '1'))

  await quickThrough(page, 2)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
  await page.getByRole('button', { name:'Watch last day' }).click()
  await expect(page.getByRole('button', { name:'Run options' })).toHaveText('Day 2 / 10 · Replay')
  const nextId = await creature.locator('option').nth(2).getAttribute('value')
  await creature.selectOption(nextId)
  await expect(status).toBeEmpty()
  await copy.click()
  await expect(status).toHaveText('Stats copied')
  const replayStats = await statsText(2, nextId)
  expect(await readClipboard()).toBe(replayStats)

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => {
      throw new DOMException('Clipboard permission denied', 'NotAllowedError')
    } })
  })
  await copy.click()
  await expect(status).toHaveText('Clipboard unavailable. Copy the text below.')
  await expect(details.getByRole('textbox', { name:'Creature stats to copy' })).toHaveValue(replayStats)
  await creature.selectOption('')
  await expect(details.getByRole('textbox', { name:'Creature stats to copy' })).toHaveCount(0)
})

test('living trait adjustments survive a reload, Quick Sim, replay, and a branch @pages', async ({ page }) => {
  await openSimulator(page)
  await expect(page).toHaveTitle('Evolution Simulator')
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('500')
    await fixedDay(page, '10')
  })
  await stepTo(page, 0.1)
  await stepTo(page, 0.2)
  const actions = page.getByRole('button', { name: 'Playback actions' })
  const adjust = page.getByRole('button', { name: 'Adjust living traits' })
  await actions.click()
  await adjust.click()
  const dialog = page.getByRole('dialog', { name: 'Adjust living traits' })
  const apply = dialog.getByRole('button', { name: 'Apply adjustment' })
  const speed = dialog.getByRole('spinbutton', { name: 'Speed', exact: true })
  await expect(dialog.getByRole('combobox', { name: 'Group', exact: true })).toBeFocused()
  await expect(apply).toBeDisabled()
  await speed.fill('100.01')
  await expect(speed).toHaveAttribute('aria-invalid', 'true')
  await expect(apply).toBeDisabled()
  await speed.fill('2.5')
  await dialog.getByRole('spinbutton', { name: 'Size', exact: true }).fill('-1')
  await dialog.getByRole('spinbutton', { name: 'Sense range', exact: true }).fill('3')
  await expect(dialog.getByText('50 of 50 living blobs will change')).toBeVisible()
  await expect(dialog.getByText('10.00 → 12.50')).toBeVisible()
  await apply.click()
  await expect(dialog).toHaveCount(0)
  await expect(actions).toBeFocused()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Paused')
  await page.reload()
  await expect(page.getByRole('progressbar', { name: 'Current day elapsed' })).toHaveAttribute('aria-valuenow', '0.2')

  async function showFounder() {
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('button', { name: 'Creatures', exact: true }).click()
    await details.getByRole('combobox', { name: 'Creature', exact: true }).selectOption('1')
  }
  const details = page.getByRole('complementary', { name: 'Creature details' })
  const stat = label => details.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]')
  await showFounder()
  await expect(stat('Speed')).toHaveText('12.50')
  await expect(stat('Size')).toHaveText('9.00')
  await expect(stat('Sense range')).toHaveText('23.00')

  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const replay = page.getByRole('slider', { name: 'Replay time' })
  await replay.fill('0.15')
  await expect(stat('Speed')).toHaveText('10.00')
  await replay.fill('0.20')
  await expect(stat('Speed')).toHaveText('12.50')
  await expect(stat('Size')).toHaveText('9.00')
  const event = details.getByRole('button', { name: '0.20 s Traits adjusted' })
  await expect(event).toBeVisible()
  await replay.fill('0.40')
  await event.click()
  await expect(replay).toHaveValue('0.2')
  await replay.fill('0')
  await expect(stat('Speed')).toHaveText('10.00')
  await actions.click()
  await expect(adjust).toBeDisabled()
  await actions.click()

  await page.getByRole('button', { name: 'Run options' }).click()
  await page.getByRole('button', { name: 'Branch here', exact: true }).click()
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 2 / 10 · Ready')
  await page.getByRole('button', { name: 'Previous day' }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Replay')
  await showFounder()
  await replay.fill('0.20')
  await expect(stat('Speed')).toHaveText('12.50')
})

test('group trait adjustments affect only the chosen species and activity through reload and replay @pages', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('500')
    await page.getByRole('button', { name: 'Orange Off', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Enabled', exact: true }).check()
    await fixedDay(page)
  })
  await stepTo(page, 0.1)
  await stepTo(page, 0.2)
  await page.getByRole('button', { name: 'Playback actions' }).click()
  await page.getByRole('button', { name: 'Adjust living traits' }).click()
  const dialog = page.getByRole('dialog', { name: 'Adjust living traits' })
  const activity = dialog.getByRole('combobox', { name: 'Activity', exact: true })
  const apply = dialog.getByRole('button', { name: 'Apply adjustment' })
  await dialog.getByRole('combobox', { name: 'Group', exact: true }).selectOption({ label: 'Orange' })
  await activity.selectOption('home')
  await dialog.getByRole('spinbutton', { name: 'Speed', exact: true }).fill('2.5')
  await expect(dialog.getByText('No living blobs match this group.')).toBeVisible()
  await expect(apply).toBeDisabled()
  await activity.selectOption('active')
  await expect(dialog.getByText('10 of 10 matching blobs will change')).toBeVisible()
  await expect(dialog.getByText('10.00 → 12.50')).toBeVisible()
  await apply.click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('progressbar', { name: 'Current day elapsed' })).toHaveAttribute('aria-valuenow', '0.2')
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: 'Creatures', exact: true }).click()
  const details = page.getByRole('complementary', { name: 'Creature details' })
  const creature = details.getByRole('combobox', { name: 'Creature', exact: true })
  const speed = details.getByText('Speed', { exact: true }).locator('xpath=following-sibling::dd[1]')
  await creature.selectOption('1')
  await expect(speed).toHaveText('10.00')
  await creature.selectOption('51')
  await expect(speed).toHaveText('12.50')

  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const replay = page.getByRole('slider', { name: 'Replay time' })
  await replay.fill('0.15')
  await expect(speed).toHaveText('10.00')
  await replay.fill('0.20')
  await expect(speed).toHaveText('12.50')
  const event = details.getByRole('button', { name: '0.20 s Traits adjusted' })
  await expect(event).toBeVisible()
  await creature.selectOption('1')
  await expect(speed).toHaveText('10.00')
  await expect(event).toHaveCount(0)
})

test('custom trait adjustments keep multiple species and hand-picked blobs distinct in live play and replay @pages', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('500')
    for (const species of ['Orange', 'Pink']) {
      await page.getByRole('button', { name: species + ' Off', exact: true }).click()
      await page.getByRole('checkbox', { name: 'Enabled', exact: true }).check()
    }
    await fixedDay(page)
  })
  await stepTo(page, 0.1)
  await stepTo(page, 0.2)
  const actions = page.getByRole('button', { name: 'Playback actions' })
  const adjust = page.getByRole('button', { name: 'Adjust living traits' })
  const dialog = page.getByRole('dialog', { name: 'Adjust living traits' })
  const group = dialog.getByRole('combobox', { name: 'Group' })
  const apply = dialog.getByRole('button', { name: 'Apply adjustment' })
  await actions.click()
  await adjust.click()
  await group.selectOption('multiple')
  await dialog.getByRole('spinbutton', { name: 'Speed', exact: true }).fill('1')
  await expect(dialog.getByText('Choose at least one species.')).toBeVisible()
  await expect(apply).toBeDisabled()
  await dialog.getByRole('checkbox', { name: 'Blue', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'Orange', exact: true }).check()
  await expect(dialog.getByText('60 of 60 matching blobs will change')).toBeVisible()
  await apply.click()
  await expect(dialog).toHaveCount(0)

  await actions.click()
  await adjust.click()
  await group.selectOption('individuals')
  const search = dialog.getByRole('searchbox', { name: 'Find by ID or species' })
  const selectedOnly = dialog.getByRole('checkbox', { name: 'Selected only' })
  const blue = dialog.getByRole('checkbox', { name: /^#1 · Blue/ })
  const orange = dialog.getByRole('checkbox', { name: /^#51 · Orange/ })
  await search.fill('#51')
  await orange.check()
  await search.fill('blue')
  await blue.check()
  await selectedOnly.check()
  await expect(search).toHaveValue('')
  await expect(orange).toBeChecked()
  await expect(blue).toBeChecked()
  await expect(dialog.getByText('2 selected', { exact: true })).toBeVisible()
  await dialog.getByRole('spinbutton', { name: 'Size', exact: true }).fill('2')
  await expect(dialog.getByText('2 of 2 matching blobs will change')).toBeVisible()
  await search.press('Enter')
  await expect(dialog).toBeVisible()
  await apply.click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('progressbar', { name: 'Current day elapsed' })).toHaveAttribute('aria-valuenow', '0.2')
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: 'Creatures', exact: true }).click()
  const details = page.getByRole('complementary', { name: 'Creature details' })
  const creature = details.getByRole('combobox', { name: 'Creature', exact: true })
  const stat = label => details.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]')
  await creature.selectOption('61')
  await expect(stat('Speed')).toHaveText('9.00')
  await expect(stat('Size')).toHaveText('9.00')
  await creature.selectOption('2')
  await expect(stat('Speed')).toHaveText('11.00')
  await expect(stat('Size')).toHaveText('10.00')
  await creature.selectOption('51')
  await expect(stat('Speed')).toHaveText('11.00')
  await expect(stat('Size')).toHaveText('12.00')

  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const replay = page.getByRole('slider', { name: 'Replay time' })
  await replay.fill('0.15')
  await expect(stat('Speed')).toHaveText('10.00')
  await expect(stat('Size')).toHaveText('10.00')
  await replay.fill('0.20')
  await expect(stat('Speed')).toHaveText('11.00')
  await expect(stat('Size')).toHaveText('12.00')
  const event = details.getByRole('button', { name: '0.20 s Traits adjusted' })
  await expect(event).toHaveCount(2)
  await creature.selectOption('2')
  await expect(stat('Size')).toHaveText('10.00')
  await expect(event).toHaveCount(1)
  await creature.selectOption('61')
  await expect(event).toHaveCount(0)
})

test('living trait adjustments pause play and fit a phone with touch and keyboard @pages', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 620 }, isMobile: true, hasTouch: true })
  try {
    const page = await context.newPage()
    const problems = []
    page.on('pageerror', error => problems.push(error.message))
    await openSimulator(page)
    await startRun(page, '10', () => fixedDay(page, '20'))
    await page.getByRole('button', { name: 'Play', exact: true }).tap()
    const actions = page.getByRole('button', { name: 'Playback actions' })
    const dialog = page.getByRole('dialog', { name: 'Adjust living traits' })
    await actions.tap()
    await page.getByRole('button', { name: 'Adjust living traits' }).tap()
    const bounds = await dialog.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(375)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(620)
    const activity = dialog.getByRole('combobox', { name: 'Activity', exact: true })
    await activity.selectOption('active')
    await expect(dialog.getByText(/matching blobs will change/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Apply adjustment' })).toBeInViewport({ ratio: 1 })
    const group = dialog.getByRole('combobox', { name: 'Group', exact: true })
    await group.selectOption('individuals')
    const first = dialog.getByRole('checkbox', { name: /^#1 · Blue/ })
    await first.tap()
    await expect(first).toBeChecked()
    const speed = dialog.getByRole('spinbutton', { name: 'Speed', exact: true })
    await speed.fill('4')
    await expect(dialog.getByText('1 of 1 matching blobs will change')).toBeVisible()
    await speed.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(actions).toBeFocused()
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await actions.tap()
    await page.getByRole('button', { name: 'Adjust living traits' }).tap()
    await expect(group).toHaveValue('all')
    await expect(activity).toHaveValue('any')
    await expect(speed).toHaveValue('0')
    const sense = dialog.getByRole('spinbutton', { name: 'Sense range' })
    await sense.fill('-100')
    await expect(dialog.getByText('20.00 → 0.00')).toBeVisible()
    await sense.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(actions).toBeFocused()
    expect(problems).toEqual([])
  } finally {
    await context.close()
  }
})

test('creature details use the movement and energy rules for the day being watched', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    for (const [name, value] of [['Food', '400'], ['Size', '12'], ['Sense Range', '30'], ['Energy', '1000']]) {
      await page.getByRole('spinbutton', { name, exact: true }).fill(value)
    }
    await advancedSettings(page, 'Movement and energy')
    await page.getByRole('combobox', { name: /^Energy model/ }).selectOption('product')
  })
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const runOptions = page.getByRole('button', { name: 'Run options' })
  const details = page.getByRole('complementary', { name: 'Creature details' })
  const travel = details.getByText('Travel rate', { exact: true }).locator('xpath=following-sibling::dd[1]')
  const energy = details.getByText('Energy cost', { exact: true }).locator('xpath=following-sibling::dd[1]')
  const follow = page.getByRole('button', { name: 'Follow creature' })
  const founder = page.getByRole('button', { name: /Current creature details.*#1$/ })
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  await follow.click()
  await founder.click()
  await expect(travel).toHaveText('120.0 units/s')
  await expect(energy).toHaveText('259.2/s')

  await runOptions.click()
  await page.getByRole('button', { name: 'Branch here', exact: true }).click()
  await page.getByRole('button', { name: 'Edit branch rules' }).click()
  await advancedSettings(page, 'Movement and energy')
  await page.getByRole('combobox', { name: /^Stride/ }).selectOption('speed')
  await page.getByRole('combobox', { name: /^Energy model/ }).selectOption('additive')
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(runOptions).toHaveText('Day 2 / 10 · Ready')
  await follow.click()
  await founder.click()
  await expect(travel).toHaveText('100.0 units/s')
  await expect(energy).toHaveText('172.8/s')

  await page.getByRole('button', { name: 'Previous day', exact: true }).click()
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  await expect(travel).toHaveText('120.0 units/s')
  await expect(energy).toHaveText('259.2/s')
})

test('replay stops at the next live day and the saved results survive a reload', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => Number(await page.getByRole('progressbar', { name: 'Current day elapsed' }).getAttribute('aria-valuenow')))
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  const additional = page.getByRole('spinbutton', { name: 'Additional generations' })
  await expect(batchStatus(page, 'Next day to simulate')).toHaveText('Day 1')
  await additional.fill('0')
  await expect(page.getByText('Finish Day 1.', { exact: true })).toBeVisible()
  await additional.fill('1')
  await expect(page.getByText('Finish Day 1, then complete Day 2.', { exact: true })).toBeVisible()
  await additional.fill('2')
  await expect(page.getByText('Finish Day 1, then complete Days 2–3.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
  await expect(batchStatus(page, 'Completed through')).toHaveText('Day 3')
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const runOptions = page.getByRole('button', { name: 'Run options' })
  await expect(runOptions).toHaveText('Day 3 / 10 · Replay')
  await page.getByRole('button', { name: 'Previous day', exact: true }).click()
  await expect(runOptions).toHaveText('Day 2 / 10 · Replay')
  const nextDay = page.getByRole('button', { name: 'Next day', exact: true })
  await nextDay.click()
  await expect(runOptions).toHaveText('Day 3 / 10 · Replay')
  await nextDay.click()
  await expect(runOptions).toHaveText('Day 4 / 10 · Ready')
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Previous day', exact: true }).click()
  await expect(runOptions).toHaveText('Day 3 / 10 · Replay')
  await nextDay.click()
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.reload()
  await expect(page.getByText(/Browser test run .* Through Day 3/)).toBeVisible()
  await expect(page.locator('.trends canvas').first()).toBeVisible()
  await page.getByRole('link', { name: 'World', exact: true }).click()
  await quickThrough(page, 10)
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await expect(runOptions).toHaveText('Day 10 / 10 · Replay')
  await expect(nextDay).toBeDisabled()
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  await expect(batchStatus(page, 'Next day to simulate')).toHaveText('Run complete')
  await expect(page.getByRole('button', { name: 'Watch Day 10', exact: true })).toBeEnabled()
})

test('Quick Sim previews only new days when the live day has ended', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await page.getByRole('button', { name: 'Play through generations' }).click()
  const speed = page.getByRole('button', { name: 'Viewing speed', exact: true })
  await speed.click()
  await page.getByRole('slider', { name: 'Viewing speed multiplier' }).fill('12')
  await speed.click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Final')

  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Quick Sim' })
  const additional = dialog.getByRole('spinbutton', { name: 'Additional generations' })
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await expect(batchStatus(page, 'Next day to simulate')).toHaveText('Day 2')
  await additional.fill('2')
  await expect(dialog.getByText('Complete Days 2–3.', { exact: true })).toBeVisible()
  await additional.fill('1')
  await expect(dialog.getByText('Complete Day 2.', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Complete through day' }).click()
  const target = dialog.getByRole('spinbutton', { name: 'Target day' })
  await target.fill('1')
  await expect(dialog.getByText('Day 1 is ready to watch.', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Watch Day 1', exact: true })).toBeEnabled()
  await target.fill('2')
  await expect(dialog.getByText('Complete Day 2.', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Additional generations', exact: true }).click()
  await expect(additional).toHaveValue('1')
  await dialog.getByRole('button', { name: 'Simulate', exact: true }).click()
  await expect(batchStatus(page, 'Completed in this batch')).toHaveText('1 of 1')
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
})

test('manual live steps survive reload and worker retry', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (data.type === 'init') window.simulationWriter = this
        return super.postMessage(data)
      }
    }
  })
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  const run = page.getByRole('button', { name: 'Run options' })
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  for (let tick = 1; tick <= 3; tick++) await stepTo(page, tick / 10)
  await expect.poll(() => savedManualProgress(page)).toEqual({ tick: 3, days: [] })

  await page.reload()
  await expect(run).toHaveText('Day 1 / 10 · Paused')
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeCloseTo(0.3)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  await stepTo(page, 0.4)
  await expect.poll(() => savedManualProgress(page)).toEqual({ tick: 4, days: [] })

  await page.evaluate(() => window.simulationWriter.dispatchEvent(new Event('error')))
  await expect(page.getByRole('alert')).toContainText('resume the unfinished day from its last checkpoint')
  await page.getByRole('button', { name: 'Retry simulation' }).click()
  await expect(run).toHaveText('Day 1 / 10 · Paused')
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeCloseTo(0.4)
  await stepTo(page, 0.5)
})

test('a manual step ending the day saves only the completed result', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page, '1'))
  for (let tick = 1; tick <= 10; tick++) await stepTo(page, tick / 10)
  await expect.poll(() => savedManualProgress(page)).toEqual({ tick: null, days: [1] })
  await page.reload()
  await expect(dayTile(page, 1)).toHaveCount(1)
  await expect.poll(() => savedManualProgress(page)).toEqual({ tick: null, days: [1] })
})

test('playback actions disable advancing at dusk and work again on the next day', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await fixedDay(page, '1')
    await advancedSettings(page, 'Movement and energy')
    await expect(page.getByRole('combobox', { name: /^Energy model/ })).toHaveValue('walkthrough')
    await expect(page.getByText('10.002 energy per 0.1 s step for Blue')).toBeVisible()
  })
  const actions = page.getByRole('button', { name: 'Playback actions' })
  const finish = page.getByRole('button', { name: 'Finish Day', exact: true })
  const step = page.getByRole('button', { name: 'Step one tick', exact: true })
  const end = page.getByRole('button', { name: 'Go to end', exact: true })
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  const through = page.getByRole('button', { name: 'Play through generations' })
  await expect(through).toHaveAttribute('aria-pressed', 'true')
  await through.click()
  await page.getByRole('button', { name: 'Follow creature' }).click()
  await page.getByRole('button', { name: /Current creature details.*#1$/ }).click()
  const details = page.getByRole('complementary', { name: 'Creature details' })
  await expect(details.getByText('10.002 per step')).toBeVisible()

  await actions.click()
  await step.click()
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0.1')
  await expect(details.getByText('490.0 / 500 energy')).toBeVisible()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(elapsed).toHaveAttribute('aria-valuenow', '1')
  await actions.click()
  await expect(finish).toBeDisabled()
  await expect(step).toBeDisabled()

  await page.getByRole('button', { name: 'Next day', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 2 / 10 · Ready')
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0')
  await expect(step).toBeEnabled()
  await finish.click()

  const replay = page.getByRole('slider', { name: 'Replay time' })
  await expect(replay).toHaveValue('1')
  await actions.click()
  await expect(end).toBeDisabled()
  await expect(step).toBeDisabled()
  await replay.fill('0.5')
  await step.click()
  await expect(replay).toHaveValue('0.6')
  await actions.click()
  await end.click()
  await expect(replay).toHaveValue('1')
})

test('turning off Play Through cancels an automatic replay that is still loading', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 2)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await dayTile(page, 1).click()
  await finishReplay(page, 1)

  const runOptions = page.getByRole('button', { name: 'Run options' })
  const through = page.getByRole('button', { name: 'Play through generations' })
  const replayTime = page.getByRole('slider', { name: 'Replay time' })
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  await through.click()
  await expect(through).toHaveAttribute('aria-pressed', 'true')
  const end = await replayTime.getAttribute('max')
  await replayTime.fill(String(Number(end) - 0.1))
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByText('Building replay for Day 2…')).toBeVisible()

  await through.click()
  await expect(page.getByRole('button', { name: 'Replay day', exact: true })).toBeEnabled()
  await finishReplay(page, 2)
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  await expect.poll(async () => Math.abs(Number(await replayTime.inputValue()) - Number(end))).toBeLessThan(1e-8)
  await expect(through).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('button', { name: 'Next day', exact: true }).click()
  await expect(runOptions).toHaveText('Day 2 / 10 · Replay')
  await expect(replayTime).toHaveValue('0')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
})

test('canceling Quick Sim leaves a finished replay at dusk', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()

  const replayTime = page.getByRole('slider', { name: 'Replay time', includeHidden: true })
  const speed = page.getByRole('button', { name: 'Viewing speed', exact: true })
  const quick = page.getByRole('button', { name: 'Quick Sim', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Quick Sim' })
  const play = page.getByRole('button', { name: 'Play', exact: true })
  await speed.click()
  await page.getByRole('slider', { name: 'Viewing speed multiplier' }).fill('0')
  await speed.click()
  await replayTime.fill('9.5')
  await play.click()
  await quick.click()
  await expect(dialog).toBeVisible()
  await expect(replayTime).toHaveValue('10', { timeout: 10000 })

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Replay day', exact: true })).toBeEnabled()
  await expect(replayTime).toHaveValue('10')

  await page.getByRole('button', { name: 'Next day', exact: true }).click()
  await play.click()
  await quick.click()
  await expect(page.getByRole('button', { name: 'Play', exact: true, includeHidden: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
})

test('Quick Sim batch results open Trends to the completed days @pages', async ({ page }) => {
  await installBatchHold(page)
  await openSimulator(page)
  await startRun(page, '100')
  await quickThrough(page, 2)
  await expect(page.getByRole('dialog', { name: 'Simulation complete' })).toBeVisible()

  const results = page.getByRole('button', { name: 'View batch results' })
  const range = page.getByRole('combobox', { name: 'Range', exact: true })
  const from = page.getByRole('spinbutton', { name: 'From day' })
  const to = page.getByRole('spinbutton', { name: 'To day' })
  await results.press('Enter')
  await expect(page.getByRole('link', { name: 'Trends', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(range).toHaveValue('custom')
  await expect(from).toHaveValue('1')
  await expect(to).toHaveValue('2')
  await expect(page.locator('#main-surface')).toBeFocused()

  await page.getByRole('button', { name: 'Trait Space', exact: true }).click()
  await page.evaluate(() => { window.batchTest.hold = true })
  await quickThrough(page, 100)
  await expect(results).toHaveCount(0)
  await page.getByRole('button', { name: 'Stop after this day' }).click()
  await page.evaluate(() => window.batchTest.release())
  await expect(page.getByRole('dialog', { name: 'Simulation stopped' })).toBeVisible()
  const lastDay = Number((await batchStatus(page, 'Completed through').innerText()).replace('Day ', ''))
  expect(lastDay).toBeGreaterThanOrEqual(3)
  expect(lastDay).toBeLessThan(100)
  await results.click()
  await expect(page.getByRole('button', { name: 'Trends', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(range).toHaveValue('custom')
  await expect(from).toHaveValue('3')
  await expect(to).toHaveValue(String(lastDay))
  const population = page.getByRole('img', { name: /^Population by generation/ })
  await population.press('Home')
  await expect(page.getByText('Day 3 · Pinned', { exact:true })).toBeVisible()
  await population.press('End')
  await expect(page.getByText(`Day ${lastDay} · Pinned`, { exact:true })).toBeVisible()
})

test('stopping early reports the saved boundary and allows another batch', async ({ page }) => {
  await openSimulator(page)
  await startRun(page, '1000')
  await quickThrough(page, 1000)
  await page.getByRole('button', { name: 'Stop after this day' }).click()
  await expect(page.getByRole('heading', { name: 'Simulation stopped' })).toBeVisible()
  const reached = await batchStatus(page, 'Completed through').innerText()
  const lastDay = Number(reached.replace('Day ', ''))
  expect(lastDay).toBeGreaterThan(0)
  expect(lastDay).toBeLessThan(1000)
  await expect(batchStatus(page, 'Saved through')).toHaveText(reached)
  await expect(page.getByRole('button', { name: 'Watch last day' })).toBeEnabled()
  await quickThrough(page, lastDay + 1, 'New Quick Sim')
  await expect(page.getByRole('heading', { name: 'Simulation complete' })).toBeVisible()
  await expect(batchStatus(page, 'Saved through')).toHaveText(`Day ${lastDay + 1}`)
})

test('a stale replay cannot change the current day, page, or history', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await expect(page.getByRole('heading', { name: 'Simulation complete' })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await dayTile(page, 2).click()
  await expect(page.getByText('Building replay for Day 2…')).toBeVisible()
  await dayTile(page, 1).click()
  await finishReplay(page, 1)
  await finishReplay(page, 2)
  await expect(dayTile(page, 1)).toHaveAttribute('aria-current', 'true')
  await expect(page).toHaveURL(/\/s\/1\/viewer$/)

  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click()
  await page.getByRole('button', { name: 'Complete through day' }).click()
  await page.getByLabel('Target day').fill('3')
  await page.getByRole('button', { name: 'Watch Day 3' }).click()
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.click()
  await finishReplay(page, 3)
  await expect(trends).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/\/s\/1\/stats$/)
  await page.goBack()
  await expect(page.getByRole('link', { name: 'World', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.goForward()
  await expect(trends).toHaveAttribute('aria-current', 'page')
})

test('a failed replay keeps the current day and can be retried', async ({ page }) => {
  await delayReplays(page)
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await finishReplay(page, 3, 'fail')
  await expect(page.getByRole('alert')).toContainText('Could not open the replay for Day 3.')
  await expect(page).toHaveURL(/\/s\/4\/viewer$/)
  await page.getByRole('button', { name: 'Retry replay' }).click()
  await finishReplay(page, 3)
  await expect(page).toHaveURL(/\/s\/3\/viewer$/)
  await expect(dayTile(page, 3)).toHaveAttribute('aria-current', 'true')
})

test('an unresponsive replay times out and can be retried', async ({ page }) => {
  await delayReplays(page)
  await page.clock.install()
  await openSimulator(page)
  await startRun(page)
  await quickThrough(page, 3)
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const loading = page.getByText('Building replay for Day 3…')
  await expect(loading).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.replayTest.jobs.has(3))).toBe(true)

  await page.clock.fastForward(20_000)
  await page.evaluate(() => window.replayTest.jobs.get(3).progress())
  await page.clock.fastForward(15_000)
  await expect(loading).toBeVisible()

  await page.clock.fastForward(15_001)
  const retry = page.getByRole('button', { name: 'Retry replay' })
  await expect(retry).toBeEnabled()
  await expect(loading).toHaveCount(0)
  await expect(page).toHaveURL(/\/s\/4\/viewer$/)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()

  await page.evaluate(() => window.replayTest.jobs.delete(3))
  await retry.click()
  await finishReplay(page, 3)
  await expect(page).toHaveURL(/\/s\/3\/viewer$/)
  await expect(dayTile(page, 3)).toHaveAttribute('aria-current', 'true')
  await expect(retry).toHaveCount(0)
})

test('a stalled size-mutation experiment times out and can be run again', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let stalled
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (!stalled && data.type === 'init' && data.config.name.startsWith('Size mutation · ')) {
          stalled = this
          return
        }
        return super.postMessage(data)
      }
      terminate() {
        if (this === stalled) window.stalledPairWorkerTerminated = true
        super.terminate()
      }
    }
  })
  await openSimulator(page)
  await page.getByRole('link', { name: 'About', exact: true }).click()
  const startPair = page.getByRole('button', { name: 'Run both and compare' })
  await expect(startPair).toBeEnabled()
  await page.clock.install()
  await expect(page.getByRole('spinbutton', { name: 'Seed', exact: true })).toHaveValue('118')
  await page.getByRole('combobox', { name: 'Days per run' }).selectOption('100')
  await startPair.click()
  const progress = page.getByRole('progressbar', { name: 'Paired experiment progress' })
  await expect(progress).toBeVisible()
  await page.clock.fastForward(10_001)

  await expect(page.getByRole('status').filter({ hasText: 'The experiment took too long to start. Try again.' })).toBeVisible()
  await expect(progress).toHaveCount(0)
  expect(await page.evaluate(() => window.stalledPairWorkerTerminated)).toBe(true)
  await expect(page.getByRole('spinbutton', { name: 'Seed', exact: true })).toHaveValue('118')
  await expect(startPair).toBeEnabled()

  await startPair.click()
  await expect(page.getByRole('heading', { name: 'Compare runs', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Day 100 results' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play comparison' })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Left run' }).getByRole('heading')).toHaveText(/Wide \(1\.00\).*Seed 118/)
  await expect(page.getByRole('region', { name: 'Right run' }).getByRole('heading')).toHaveText(/Narrow \(0\.50\).*Seed 118/)
})

test('the 600-generation experiment lowers average size and replays real hunts @pages', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await page.getByRole('link', { name: 'About', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Days per run' })).toHaveValue('600')
  await page.getByRole('button', { name: 'Run both and compare' }).click()

  const sizes = page.getByRole('region', { name: 'Average size over 600 generations' })
  await expect(sizes).toBeVisible({ timeout: 30_000 })
  const cells = side => sizes.getByRole('row', { name: new RegExp('^' + side) }).getByRole('cell')
  await expect(cells('Left').first()).toHaveText('10.00')
  await expect(cells('Right').first()).toHaveText('10.00')
  const wide = Number(await cells('Left').nth(1).textContent())
  const narrow = Number(await cells('Right').nth(1).textContent())
  expect(wide).toBeLessThan(10)
  expect(narrow).toBeLessThan(wide)
  expect(narrow).toBeGreaterThan(6.5)
  expect(narrow).toBeLessThan(7.5)
  await expect(page.getByRole('heading', { name: 'Day 600 results' })).toBeVisible()
  const hunts = page.getByRole('row', { name: /^Successful hunts/ }).getByRole('cell')
  await expect(hunts.nth(0)).toHaveText(/^[1-9]\d*$/)
  await expect(hunts.nth(1)).toHaveText(/^[1-9]\d*$/)

  const watchLeft = page.getByRole('button', { name: /^Watch left hunt/ })
  const watchRight = page.getByRole('button', { name: /^Watch right hunt/ })
  await expect(watchLeft).toBeEnabled()
  await expect(watchRight).toBeEnabled()
  await watchLeft.click()
  await expect(page.getByRole('button', { name: 'Pause comparison' })).toBeEnabled()
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Shared day progress' }).inputValue())).toBeGreaterThan(0)

  await page.reload()
  await expect(sizes).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Day 600 results' })).toBeVisible()
  await expect(watchRight).toBeEnabled()
  expect(errors).toEqual([])
})

test('Compare keeps a cleared run selector empty when the page reloads', async ({ page }) => {
  await openSimulator(page)
  for (const name of ['Right archive', 'Left archive']) {
    await startRun(page, '10', () => page.getByLabel('Run name').fill(name))
    await quickThrough(page, 1)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
  }

  await openRunLibrary(page)
  const archivedRun = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Right archive' })
  await archivedRun.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Day 1 results' })).toBeVisible()

  const left = page.getByRole('combobox', { name: 'Left run', exact: true })
  const right = page.getByRole('combobox', { name: 'Right run', exact: true })
  const leftId = await left.inputValue()
  const rightId = await right.inputValue()
  const choose = page.getByText('Choose two different saved experiments.')
  for (const [cleared, kept, clearedId, keptId] of [
    [right, left, rightId, leftId],
    [left, right, leftId, rightId],
  ]) {
    await cleared.selectOption('')
    await expect(choose).toBeVisible()
    await page.reload()
    await expect(cleared).toHaveValue('')
    await expect(kept).toHaveValue(keptId)
    await expect(choose).toBeVisible()
    await cleared.selectOption(clearedId)
    await expect(page.getByRole('heading', { name: 'Day 1 results' })).toBeVisible()
  }
})

test('Compare opens runs with results and fits both playback percentages', async ({ page }) => {
  await openSimulator(page)
  for (const name of ['First recording', 'Second recording']) {
    await startRun(page, '10', () => page.getByLabel('Run name').fill(name))
    await quickThrough(page, 1)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
  }

  const openCompare = async () => {
    await page.getByRole('button', { name: 'Run options' }).click()
    await page.getByRole('button', { name: 'Compare runs', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Day 1 results' })).toBeVisible()
  }
  const left = page.getByRole('combobox', { name: 'Left run', exact: true })
  const right = page.getByRole('combobox', { name: 'Right run', exact: true })
  await openCompare()
  await expect(left.locator('option:checked')).toContainText('Second recording')
  await expect(right.locator('option:checked')).toContainText('First recording')

  await page.getByRole('link', { name: 'World', exact: true }).click()
  await startRun(page, '10', () => page.getByLabel('Run name').fill('Fresh run'))
  await openCompare()
  await expect(left.locator('option:checked')).toContainText('Second recording')
  await expect(right.locator('option:checked')).toContainText('First recording')

  const progress = page.getByRole('slider', { name: 'Shared day progress' })
  const percentages = page.locator('.comparison-clock output')
  await expect(progress).toBeEnabled()
  for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 480 }]) {
    await page.setViewportSize(viewport)
    await progress.fill('0')
    await expect(percentages).toHaveText('0% / 0%')
    const startingSize = await percentages.evaluate(el => [el.offsetWidth, el.offsetHeight])
    await progress.fill('1')
    await expect(percentages).toHaveText('100% / 100%')
    expect(await percentages.evaluate(el => [el.offsetWidth, el.offsetHeight])).toEqual(startingSize)
    expect(await percentages.evaluate(el => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const text = range.getBoundingClientRect()
      const output = el.getBoundingClientRect()
      return range.getClientRects().length === 1 && text.left >= output.left && text.right <= output.right
    })).toBe(true)
  }
})

test('Compare swaps the boards with their own days, camera angles, and playback positions @pages', async ({ page }) => {
  await openSimulator(page)
  for (const [name, days, seconds] of [['East archive', 3, '10'], ['West archive', 2, '5']]) {
    await startRun(page, '10', async () => {
      await fixedDay(page, seconds)
      await page.getByRole('spinbutton', { name:'Food', exact:true }).fill('400')
      await page.getByLabel('Run name').fill(name)
    })
    await quickThrough(page, days)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day '+days)
    await page.getByRole('button', { name:'Close', exact:true }).click()
  }
  await openRunLibrary(page)
  const east = page.getByRole('dialog', { name:'Run Library' }).locator('article').filter({ hasText:'East archive' })
  await east.getByRole('button', { name:'Compare', exact:true }).click()

  const side = name => {
    const board = page.getByRole('region', { name:name+' run' })
    return {
      canvas:board.locator('canvas.world-canvas'),
      heading:board.getByRole('heading'),
      run:page.getByRole('combobox', { name:name+' run', exact:true }).locator('option:checked'),
      day:page.getByRole('spinbutton', { name:name+' day', exact:true }),
      camera:page.getByRole('combobox', { name:name+' camera angle' }),
      progress:page.getByRole('slider', { name:name+' playback progress' }),
    }
  }
  const left = side('Left'), right = side('Right')
  await left.day.fill('2')
  await left.day.press('Tab')
  await right.day.fill('3')
  await right.day.press('Tab')
  await left.camera.selectOption('close')
  await right.camera.selectOption('overhead')
  const scope = page.getByRole('combobox', { name:'Species', exact:true })
  await scope.selectOption('blue')
  await left.progress.fill('0.4')
  await right.progress.fill('0.7')
  await expect(left.heading).toHaveText(/West archive.*Day 2.*2\.0 s/)
  await expect(right.heading).toHaveText(/East archive.*Day 3.*7\.0 s/)
  const westCanvas = await left.canvas.elementHandle()
  const eastCanvas = await right.canvas.elementHandle()

  const swap = page.getByRole('button', { name:'Swap sides' })
  await swap.press('Enter')
  await expect(swap).toBeFocused()
  await expect(left.run).toContainText('East archive')
  await expect(right.run).toContainText('West archive')
  await expect(left.day).toHaveValue('3')
  await expect(right.day).toHaveValue('2')
  await expect(left.camera).toHaveValue('overhead')
  await expect(right.camera).toHaveValue('close')
  await expect(left.progress).toHaveValue('0.7')
  await expect(right.progress).toHaveValue('0.4')
  await expect(scope).toHaveValue('blue')
  await expect(left.heading).toHaveText(/East archive.*Day 3.*7\.0 s/)
  await expect(right.heading).toHaveText(/West archive.*Day 2.*2\.0 s/)
  expect(await left.canvas.evaluate((canvas, previous) => canvas===previous, eastCanvas)).toBe(true)
  expect(await right.canvas.evaluate((canvas, previous) => canvas===previous, westCanvas)).toBe(true)
  await expect(page.getByRole('heading', { name:'Day 3 vs Day 2 results' })).toBeVisible()

  await page.setViewportSize({ width:390, height:740 })
  await page.getByRole('button', { name:'Play right board' }).click()
  await swap.click()
  await expect(page.getByRole('button', { name:'Pause left board' })).toBeEnabled()
  await expect(page.getByRole('button', { name:'Play right board' })).toBeEnabled()
  await expect.poll(async () => Number(await left.progress.inputValue())).toBeGreaterThan(0.4)
  await expect(right.progress).toHaveValue('0.7')
})

test('Compare keeps the working board visible and retries only the failed replay', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let failOnce = true
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (failOnce && data.type === 'replay' && data.setup.name === 'Right archive' && data.day === 2) {
          failOnce = false
          window.failComparisonReplay = () => this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'error', id: data.id, message: 'Replay unavailable' },
          }))
          return
        }
        return super.postMessage(data)
      }
    }
  })
  await openSimulator(page)
  for (const name of ['Right archive', 'Left archive']) {
    await startRun(page, '10', async () => {
      await fixedDay(page)
      await page.getByLabel('Run name').fill(name)
    })
    await quickThrough(page, 2)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
  }

  await dayTile(page, 1).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 1 / 10 · Replay')
  await openRunLibrary(page)
  const right = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Right archive' })
  await right.getByRole('button', { name: 'Compare', exact: true }).click()
  const play = page.getByRole('button', { name: 'Play comparison' })
  const progress = page.getByRole('slider', { name: 'Shared day progress' })
  const leftBoard = page.getByRole('region', { name: 'Left run' })
  const rightBoard = page.getByRole('region', { name: 'Right run' })
  const leftCanvas = leftBoard.locator('canvas.world-canvas')
  const rightCanvas = rightBoard.locator('canvas.world-canvas')
  const leftProgress = page.getByRole('slider', { name: 'Left playback progress' })
  const leftCamera = page.getByRole('combobox', { name: 'Left camera angle' })
  const rightControls = page.getByRole('region', { name: 'Right board controls' })
  const rightDay = rightControls.getByRole('spinbutton', { name: 'Right day' })
  await expect(page.getByRole('heading', { name: 'Day 1 results' })).toBeVisible()
  await expect(play).toBeEnabled()
  await expect(leftCanvas).toBeVisible()
  await expect(rightCanvas).toBeVisible()
  await page.getByRole('button', { name: 'Side by side', exact: true }).click()
  await leftCamera.selectOption('overhead')
  await leftProgress.fill('0.4')
  await expect(leftBoard.getByRole('heading')).toHaveText(/Day 1.*4\.0 s/)

  await rightDay.fill('2')
  await rightDay.press('Tab')
  await expect(page.getByRole('heading', { name: 'Day 1 vs Day 2 results' })).toBeVisible()
  await expect(rightControls.getByRole('status')).toHaveText('Loading Day 2…')
  await expect.poll(() => page.evaluate(() => typeof window.failComparisonReplay)).toBe('function')
  await expect(leftCanvas).toBeVisible()
  await expect(rightCanvas).toBeHidden()
  const leftControls = page.getByRole('region', { name:'Left board controls' })
  const swap = page.getByRole('button', { name:'Swap sides' })
  await swap.click()
  await expect(leftControls.getByRole('status')).toHaveText('Loading Day 2…')
  await expect(rightCanvas).toBeVisible()
  await expect(leftCanvas).toBeHidden()
  await page.evaluate(() => window.failComparisonReplay())
  await expect(leftControls.getByRole('alert')).toContainText('Could not open Day 2 on the left.')
  await swap.click()
  await expect(rightControls.getByRole('alert')).toContainText('Could not open Day 2 on the right.')
  await expect(leftCanvas).toBeVisible()
  await expect(leftBoard.getByRole('heading')).toHaveText(/Day 1.*4\.0 s/)
  await expect(rightCanvas).toBeHidden()
  await expect(rightControls.getByRole('button', { name: 'Play right board' })).toBeDisabled()
  await expect(play).toBeDisabled()
  await expect(progress).toBeDisabled()

  await page.getByRole('button', { name: 'Play left board' }).click()
  await expect.poll(async () => Number(await leftProgress.inputValue())).toBeGreaterThan(0.42)
  await page.getByRole('button', { name: 'Pause left board' }).click()
  await leftProgress.fill('0.4')

  await page.setViewportSize({ width: 390, height: 844 })
  await rightControls.getByRole('button', { name: 'Retry right replay' }).click()
  await expect(play).toBeEnabled()
  await expect(rightControls.getByRole('alert')).toHaveCount(0)
  await expect(rightDay).toHaveValue('2')
  await expect(leftCamera).toHaveValue('overhead')
  await expect(leftBoard.getByRole('heading')).toHaveText(/Day 1.*4\.0 s/)
  await expect(leftCanvas).toBeVisible()
  await expect(rightCanvas).toBeVisible()
  await progress.fill('0.5')
  await expect(leftBoard.getByRole('heading')).toHaveText(/Day 1.*5\.0 s/)
  await expect(rightBoard.getByRole('heading')).toHaveText(/Day 2.*5\.0 s/)
})

test('Compare keeps the shared day valid and Close view changes the board framing', async ({ page }) => {
  await page.setViewportSize({ width:1280, height:900 })
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(() => {
    localStorage.setItem('evolution.tour','1')
    const getContext=HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext=function(type,...args) {
      return type==='webgl2' ? null : getContext.call(this,type,...args)
    }
  })
  await openSimulator(page)
  for (const [name,day] of [['Long archive',5],['Short archive',2]]) {
    await startRun(page,'10',async()=>{
      await fixedDay(page,'1')
      await page.getByRole('spinbutton',{name:'Food',exact:true}).fill('500')
      await page.getByLabel('Run name').fill(name)
    })
    await quickThrough(page,day)
    await expect(batchStatus(page,'Saved through')).toHaveText('Day '+day)
    await page.getByRole('button',{name:'Close',exact:true}).click()
  }

  await openRunLibrary(page)
  const library=page.getByRole('dialog',{name:'Run Library'})
  await library.locator('article').filter({hasText:'Long archive'}).getByRole('button',{name:'Compare',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Compare runs',exact:true})).toBeVisible()

  const shared=page.getByRole('spinbutton',{name:'Set both days'})
  const leftDay=page.getByRole('spinbutton',{name:'Left day',exact:true})
  const rightDay=page.getByRole('spinbutton',{name:'Right day',exact:true})
  await expect(shared).toHaveAttribute('max','2')
  await expect(shared).toHaveValue('2')
  await page.getByRole('button',{name:'Previous comparison day'}).click()
  await expect(shared).toHaveValue('1')
  await page.getByRole('button',{name:'Next comparison day'}).click()
  await expect(shared).toHaveValue('2')
  await expect(leftDay).toHaveValue('2')
  await expect(rightDay).toHaveValue('2')
  await rightDay.fill('5')
  await rightDay.press('Tab')
  await expect(rightDay).toHaveValue('5')
  await expect(shared).toHaveValue('2')
  await page.reload()
  await expect(shared).toHaveValue('2')
  await expect(leftDay).toHaveValue('2')
  await expect(rightDay).toHaveValue('5')
  await page.getByRole('button',{name:'Previous comparison day'}).click()
  await expect(shared).toHaveValue('1')
  await expect(leftDay).toHaveValue('1')
  await expect(rightDay).toHaveValue('1')

  const camera=page.getByRole('combobox',{name:'Left camera angle'})
  const canvas=page.getByRole('region',{name:'Left run'}).locator('canvas.world-canvas')
  const pixels=()=>canvas.evaluate(element=>element.toDataURL())
  await page.waitForTimeout(100)
  const field=await pixels()
  await camera.selectOption('close')
  await expect.poll(pixels).not.toBe(field)
  await page.getByRole('button',{name:'Fit both boards'}).click()
  await expect(camera).toHaveValue('board')
  await expect.poll(pixels).toBe(field)
})

test('Age walkthrough keeps controls visible through failures, cancellation, and run changes', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({width:850,height:650})
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(() => {
    localStorage.setItem('evolution.tour','1')
    const NativeWorker=window.Worker
    window.ageDemoTest={mode:'fail',workers:[]}
    window.Worker=class extends NativeWorker {
      postMessage(data) {
        if(data.type==='init' && data.config.name.startsWith('Size mutation ·')) {
          if(window.ageDemoTest.mode==='fail') {
            window.ageDemoTest.mode='hold'
            queueMicrotask(()=>this.onmessage?.({data:{type:'error',message:'Forced age preparation failure'}}))
            return
          }
          if(window.ageDemoTest.mode==='hold') {
            window.ageDemoTest.workers.push(this)
            return
          }
        }
        return super.postMessage(data)
      }
    }
  })
  await openSimulator(page)
  await page.getByRole('link',{name:'Trends',exact:true}).click()
  await page.getByRole('button',{name:'Walk through age',exact:true}).click()

  const walkthrough=page.getByRole('region',{name:'Age walkthrough'})
  const alert=walkthrough.getByRole('alert')
  const cancel=walkthrough.getByRole('button',{name:'Cancel preparation'})
  const chartGrid=page.locator('.walkthrough-plots')
  await expect(alert).toContainText('Forced age preparation failure')
  await expect(page.getByText(/Age walkthrough · Reference preparation failed/)).toBeVisible()
  await expect(chartGrid).toHaveCount(0)
  await expect.poll(async()=>{
    const bounds=await walkthrough.boundingBox()
    return bounds && bounds.y>=0 && bounds.y+bounds.height<=650
  }).toBe(true)

  await walkthrough.getByRole('button',{name:'Retry'}).click()
  await expect(page.getByRole('progressbar',{name:'Age walkthrough preparation'})).toBeVisible()
  await expect(cancel).toBeVisible()
  await expect.poll(async()=>{
    const bounds=await cancel.boundingBox()
    return bounds && bounds.y>=0 && bounds.y+bounds.height<=650
  }).toBe(true)
  await cancel.click()
  await expect(alert).toContainText('Preparation canceled.')
  await expect(walkthrough.getByRole('button',{name:'Retry'})).toBeVisible()

  await page.evaluate(()=>{window.ageDemoTest.mode='run'})
  await walkthrough.getByRole('button',{name:'Retry'}).click()
  await expect(page.locator('.walkthrough-plots .spotlight-plot')).toBeVisible({timeout:60_000})
  await expect(page.getByText(/Age walkthrough · Size mutation · Wide.*Through Day 600/)).toBeVisible()
  const agePlot=page.locator('.walkthrough-plots .spotlight-plot')
  await expect.poll(async()=>{
    const bounds=await agePlot.boundingBox()
    return bounds && bounds.y>=0 && bounds.y+bounds.height<=650
  }).toBe(true)

  await page.evaluate(()=>{window.ageDemoTest.mode='hold'})
  await walkthrough.getByRole('button',{name:'Prepare short run · 100 days'}).click()
  await expect(page.getByRole('status').filter({hasText:'Preparing both 100-day runs'})).toBeVisible()
  await expect(walkthrough.getByText('LONG RUN · SEED 118')).toBeVisible()
  await expect(page.getByText(/Age walkthrough · Size mutation · Wide.*Through Day 600/)).toBeVisible()
  await expect(agePlot).toBeVisible()
  await cancel.click()
  await expect(alert).toContainText('Preparation canceled.')
  await expect(agePlot).toBeVisible()

  await page.evaluate(()=>{window.ageDemoTest.mode='run'})
  await walkthrough.getByRole('button',{name:'Retry'}).click()
  await expect(page.locator('.walkthrough-plots .spotlight-plot')).toBeVisible({timeout:60_000})
  await expect(walkthrough.getByText('SHORT RUN · SEED 118')).toBeVisible()
  await expect(page.getByText(/Age walkthrough · Size mutation · Wide.*Through Day 100/)).toBeVisible()
  await walkthrough.getByRole('button',{name:'Close age walkthrough'}).click()
  await expect(page.getByRole('button',{name:'Walk through age',exact:true})).toBeVisible()
  await expect(page.getByText(/Starter field · Seed .* Through Day/)).toBeVisible()
})

for (const failure of ['constructor', 'timeout']) {
  test(`retry recovers after a worker startup ${failure} failure`, async ({ page }) => {
    await page.addInitScript(failure => {
      const NativeWorker = window.Worker
      let failFirst = true
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          if (failure === 'constructor' && failFirst) {
            failFirst = false
            throw new Error('Worker unavailable')
          }
          super(...args)
        }
        postMessage(data) {
          if (failure === 'timeout' && failFirst && data.type === 'init') {
            failFirst = false
            window.workerWaiting = true
            return
          }
          return super.postMessage(data)
        }
      }
    }, failure)
    if (failure === 'timeout') await page.clock.install()
    await openSimulator(page)
    if (failure === 'timeout') {
      await page.waitForFunction(() => window.workerWaiting)
      await page.clock.fastForward(10001)
    }
    const retry = page.getByRole('button', { name: 'Retry simulation' })
    await expect(retry).toBeEnabled()
    await retry.click()
    await expect(retry).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Simulation Settings' })).toBeEnabled()
    await expect(dayTile(page, 1)).toBeVisible()
  })
}

test('retry after a crash in full screen keeps completed days and restarts uncheckpointed playback', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (data.type === 'init') window.simulationWriter = this
        if (data.type === 'checkpoint') return
        return super.postMessage(data)
      }
    }
  })
  await openSimulator(page)
  await startRun(page, '10', () => fixedDay(page))
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const view = page.getByRole('button', { name: 'View options' })
  await view.click()
  await page.getByRole('button', { name: 'Full screen', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('world'))).toBe(true)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const elapsed = page.getByRole('progressbar', { name: 'Current day elapsed' })
  await expect.poll(async () => Number(await elapsed.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  await page.evaluate(() => {
    window.failedWriter = window.simulationWriter
    window.failedWriter.dispatchEvent(new Event('error'))
  })
  await expect(page.getByRole('alert')).toContainText('The unfinished day will restart')
  const retry = page.getByRole('button', { name: 'Retry simulation' })
  await retry.click({ timeout: 5000 })
  await expect(retry).toHaveCount(0)
  await view.click()
  await page.getByRole('button', { name: 'Exit full screen' }).click()
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 4 / 10 · Ready')
  await expect(elapsed).toHaveAttribute('aria-valuenow', '0')
  await page.evaluate(() => window.failedWriter.dispatchEvent(new MessageEvent('message', {
    data: { type: 'frame', frame: { day: 9, time: 0, duration: 10, blobs: [], plants: [], events: [] } },
  })))
  await expect(page.getByRole('button', { name: 'Run options' })).toHaveText('Day 4 / 10 · Ready')
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.getByText(/Browser test run .* Through Day 3/)).toBeVisible()
})

test('starting territories validate and keep field inheritance editable on a phone @pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 650 })
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await page.getByRole('button', { name: 'Advanced', exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Starting territories', exact: true }).press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Simulation Settings' })
  const group = dialog.getByRole('region', { name: 'Starting territories' })
  const enabled = group.getByRole('checkbox', { name: 'Use starting territories' })
  const placement = group.getByRole('combobox', { name: 'Placement for' })
  const width = group.getByRole('spinbutton', { name: 'Band width (%)' })
  const top = group.getByRole('checkbox', { name: 'Top', exact: true })
  const custom = group.getByRole('checkbox', { name: 'Use custom settings' })
  await expect(enabled).not.toBeChecked()
  await enabled.press('Space')
  await expect(group.getByRole('status')).toHaveText('Day 1 at dawn · 50 blobs')
  await expect(group.getByRole('combobox', { name: 'Apply territories' })).toHaveValue('opening')
  await width.fill('30')
  await placement.selectOption('blue')
  await expect(width).toBeDisabled()
  await custom.press('Space')
  await expect(width).toHaveValue('30')
  await width.fill('4')
  await expect(group.getByRole('status')).toContainText('Check the territory')
  await dialog.getByRole('button', { name: 'Evolve!' }).click()
  await expect(width).toBeFocused()
  await width.fill('25')
  for (const edge of ['Top', 'Right', 'Bottom', 'Left']) {
    await group.getByRole('checkbox', { name: edge, exact: true }).uncheck()
  }
  await dialog.getByRole('button', { name: 'Evolve!' }).click()
  await expect(top).toBeFocused()
  await expect(dialog.getByRole('alert')).toContainText('Choose at least one starting edge')
  await top.press('Space')
  await expect(group.locator('[data-species="blue"]')).toContainText('Top 50 · Right 0 · Bottom 0 · Left 0')
  await custom.uncheck()
  await expect(width).toBeDisabled()
  await expect(width).toHaveValue('30')
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await dialog.getByRole('button', { name: 'Discard changes' }).click()
  await dialog.getByRole('button', { name: 'Discard draft' }).click()
  await expect(enabled).not.toBeChecked()
  await enabled.press('Space')
  await expect(width).toHaveValue('100')
})

test('starting territories match preview, live dawn, Quick Sim, replay, and a revised fork @pages', async ({ page }) => {
  await page.addInitScript(() => {
    const evidence = window.territoryEvidence = { preview: [], live: {}, replay: {} }
    const subscribed = new WeakSet()
    const post = Worker.prototype.postMessage
    const positions = blobs => blobs.map(blob => [blob.x, blob.y])
    Worker.prototype.postMessage = function (...args) {
      if (!subscribed.has(this)) {
        subscribed.add(this)
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'frame' && data.frame.time === 0) evidence.live[data.frame.day] = positions(data.frame.blobs)
          if (data.type === 'track') evidence.replay[data.track.day] = positions(data.track.opening)
        })
      }
      return post.apply(this, args)
    }
    const ctx = CanvasRenderingContext2D.prototype
    const fillRect = ctx.fillRect, arc = ctx.arc, stroke = ctx.stroke
    const preview = context => context.canvas.matches('.territory-map canvas')
    let lastPoint
    ctx.fillRect = function (...args) {
      if (preview(this) && args[0] === 0 && args[1] === 0) evidence.preview = []
      return fillRect.apply(this, args)
    }
    ctx.arc = function (...args) {
      if (preview(this)) lastPoint = args.slice(0, 2)
      return arc.apply(this, args)
    }
    ctx.stroke = function (...args) {
      if (preview(this)) evidence.preview.push(lastPoint)
      return stroke.apply(this, args)
    }
  })
  await openSimulator(page)
  const graph = page.getByRole('region', { name: 'Starting territories' })
  const edges = name => graph.getByRole('checkbox', { name, exact: true })
  const preview = () => page.evaluate(() => window.territoryEvidence.preview)
  const dawn = day => page.evaluate(day => window.territoryEvidence.live[day], day)
  const runOptions = page.getByRole('button', { name: 'Run options' })
  let opening
  await startRun(page, '10', async () => {
    await page.getByRole('spinbutton', { name: 'Random seed' }).fill('118')
    await page.getByRole('spinbutton', { name: 'Food', exact: true }).fill('500')
    await advancedSettings(page, 'Starting territories')
    await graph.getByRole('checkbox', { name: 'Use starting territories' }).check()
    for (const edge of ['Top', 'Right', 'Bottom']) await edges(edge).uncheck()
    await graph.getByRole('spinbutton', { name: 'Band width (%)' }).fill('35')
    await expect(graph.locator('[data-species="blue"]')).toContainText('Left 50')
    opening = await preview()
    expect(opening).toHaveLength(50)
  })
  await expect.poll(() => dawn(1)).toEqual(opening)

  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await dayTile(page, 1).click()
  await expect(runOptions).toHaveText('Day 1 / 10 · Replay')
  await expect.poll(() => page.evaluate(() => window.territoryEvidence.replay[1])).toEqual(opening)

  await openDayTwoBranch(page)
  await page.getByRole('button', { name: 'Edit branch rules' }).click()
  await advancedSettings(page, 'Starting territories')
  await expect(graph.getByRole('status')).toContainText('Day 3 at dawn')
  const originalThird = await preview()
  expect(originalThird.length).toBeGreaterThan(0)
  expect(originalThird.some(([x]) => x > 50)).toBe(true)
  await edges('Bottom').check()
  await edges('Left').uncheck()
  const revisedThird = await preview()
  expect(revisedThird).toHaveLength(originalThird.length)
  expect(revisedThird.every(([, y]) => y > 450)).toBe(true)
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(runOptions).toHaveText('Day 3 / 10 · Ready')
  await expect.poll(() => dawn(3)).toEqual(revisedThird)
  await quickThrough(page, 3)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await dayTile(page, 3).click()
  await expect.poll(() => page.evaluate(() => window.territoryEvidence.replay[3])).toEqual(revisedThird)
})

test('starting territories survive a saved run, compact link, and setup export @pages', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openSimulator(page)
  const region = page.getByRole('region', { name: 'Starting territories' })
  await startRun(page, '10', async () => {
    await advancedSettings(page, 'Starting territories')
    await region.getByRole('checkbox', { name: 'Use starting territories' }).check()
    await region.getByRole('combobox', { name: 'Apply territories' }).selectOption('daily')
    const scope = region.getByRole('combobox', { name: 'Placement for' })
    await scope.selectOption('blue')
    await region.getByRole('checkbox', { name: 'Use custom settings' }).check()
    await scope.selectOption({ label: 'Field default' })
    await region.getByRole('checkbox', { name: 'Top', exact: true }).uncheck()
    await region.getByRole('spinbutton', { name: 'Band center (%)' }).fill('75')
  })
  await page.reload()
  await openRunLibrary(page)
  const run = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Browser test run' })
  await run.getByText('Actions', { exact: true }).click()
  await run.getByRole('button', { name: 'Copy setup link' }).click()
  await expect(page.getByText('Setup link copied. It opens a new experiment draft.')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const download = page.waitForEvent('download')
  await run.getByRole('button', { name: 'Export setup' }).click()
  const contents = await readFile(await (await download).path())
  const { setup } = JSON.parse(contents)
  expect(setup.territories).toEqual({ enabled: true, timing: 'daily', edges: ['right', 'bottom', 'left'], center: 75, width: 100 })
  expect(setup.species[0].territory).toEqual({ edges: ['top', 'right', 'bottom', 'left'], center: 50, width: 100 })
  expect(setup.species[1].territory).toBeUndefined()

  const recipient = await browser.newPage()
  try {
    const controls = recipient.getByRole('region', { name: 'Starting territories' })
    async function checkTerritories() {
      await advancedSettings(recipient, 'Starting territories')
      const scope = controls.getByRole('combobox', { name: 'Placement for' })
      const top = controls.getByRole('checkbox', { name: 'Top', exact: true })
      const center = controls.getByRole('spinbutton', { name: 'Band center (%)' })
      const custom = controls.getByRole('checkbox', { name: 'Use custom settings' })
      await expect(controls.getByRole('combobox', { name: 'Apply territories' })).toHaveValue('daily')
      await expect(center).toHaveValue('75')
      await expect(top).not.toBeChecked()
      await scope.selectOption('blue')
      await expect(custom).toBeChecked()
      await expect(top).toBeChecked()
      await expect(center).toHaveValue('50')
      await scope.selectOption('orange')
      await expect(custom).not.toBeChecked()
      await expect(center).toBeDisabled()
      await expect(center).toHaveValue('75')
    }
    await recipient.goto(link)
    await checkTerritories()
    await recipient.getByRole('button', { name: 'Close settings' }).click()
    await openRunLibrary(recipient)
    await recipient.getByRole('dialog', { name: 'Run Library' }).locator('input[type=file]').setInputFiles({
      name: 'territory-setup.json', mimeType: 'application/json', buffer: contents,
    })
    await checkTerritories()
  } finally {
    await recipient.close()
  }
})

test('advanced rules can be turned off, shared, and restored with their values @pages', async ({ page, context, browser }) => {
  await page.setViewportSize({ width: 390, height: 740 })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await advancedSettings(page, 'Movement and energy')
    const reward = page.getByRole('spinbutton', { name: 'Plant reward' })
    const refill = page.getByRole('checkbox', { name: 'Refill energy after meals' })
    await reward.fill('30')
    await refill.press('Space')
    await expect(reward).toBeDisabled()
    await expect(reward).toHaveValue('30')

    await advancedSettings(page, 'Reproduction')
    const reproduction = page.getByRole('checkbox', { name: 'Allow reproduction' })
    const parentMode = page.getByRole('combobox', { name: 'Parent mode' })
    const mutationChance = page.getByRole('spinbutton', { name: 'Speed mutation chance (%)' })
    await parentMode.selectOption('pair')
    await advancedSettings(page, 'Inheritance & mutation')
    await mutationChance.fill('35')
    await page.getByRole('combobox', { name: 'Mutation profile' }).selectOption('locked')
    await expect(mutationChance).toBeDisabled()
    await advancedSettings(page, 'Reproduction')
    await reproduction.uncheck()
    await expect(parentMode).toHaveCount(0)
    await advancedSettings(page, 'Inheritance & mutation')
    await expect(page.getByRole('combobox', { name: 'Mutation profile' })).toBeDisabled()
    await expect(page.getByText('Turn on reproduction to edit mutation settings.')).toBeVisible()

    await advancedSettings(page, 'Foraging decisions')
    const memory = page.getByRole('spinbutton', { name: 'Plant memory (seconds)' })
    const preview = page.getByRole('region', { name: 'Foraging decisions' }).getByRole('status')
    const custom = page.getByRole('checkbox', { name: 'Use custom foraging decisions' })
    await memory.fill('1.4')
    await expect(preview).toContainText('Pursue the remembered plant')
    await custom.uncheck()
    await expect(memory).toBeDisabled()
    await expect(preview).toContainText('Search for another meal')

    await advancedSettings(page, 'Aging and lifespan')
    await page.getByRole('checkbox', { name: 'Enable aging' }).check()
    const cap = page.getByRole('checkbox', { name: 'Set a maximum lifespan' })
    const limit = page.getByRole('spinbutton', { name: 'Maximum lifespan' })
    await cap.check()
    await limit.fill('27')
    await cap.uncheck()
    await expect(limit).toHaveCount(0)
  })
  await openRunLibrary(page)
  const run = page.getByRole('dialog', { name: 'Run Library' }).locator('article').filter({ hasText: 'Browser test run' })
  await run.getByText('Actions', { exact: true }).click()
  await run.getByRole('button', { name: 'Copy setup link' }).click()
  await expect(page.getByText('Setup link copied. It opens a new experiment draft.')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const recipient = await browser.newPage()
  try {
    await recipient.goto(link)
    await advancedSettings(recipient, 'Movement and energy')
    const refill = recipient.getByRole('checkbox', { name: 'Refill energy after meals' })
    await expect(refill).not.toBeChecked()
    await refill.check()
    await expect(recipient.getByRole('spinbutton', { name: 'Plant reward' })).toHaveValue('30')

    await advancedSettings(recipient, 'Reproduction')
    const reproduction = recipient.getByRole('checkbox', { name: 'Allow reproduction' })
    await expect(reproduction).not.toBeChecked()
    await reproduction.check()
    await expect(recipient.getByRole('combobox', { name: 'Parent mode' })).toHaveValue('pair')
    await advancedSettings(recipient, 'Inheritance & mutation')
    const mutation = recipient.getByRole('checkbox', { name: 'Allow speed mutation' })
    await expect(mutation).not.toBeChecked()
    await mutation.check()
    await expect(recipient.getByRole('spinbutton', { name: 'Speed mutation chance (%)' })).toHaveValue('35')

    await advancedSettings(recipient, 'Foraging decisions')
    const custom = recipient.getByRole('checkbox', { name: 'Use custom foraging decisions' })
    await expect(custom).not.toBeChecked()
    await custom.check()
    await expect(recipient.getByRole('spinbutton', { name: 'Plant memory (seconds)' })).toHaveValue('1.4')

    await advancedSettings(recipient, 'Aging and lifespan')
    const cap = recipient.getByRole('checkbox', { name: 'Set a maximum lifespan' })
    await expect(cap).not.toBeChecked()
    await cap.check()
    await expect(recipient.getByRole('spinbutton', { name: 'Maximum lifespan' })).toHaveValue('27')
  } finally {
    await recipient.close()
  }
  expect(errors).toEqual([])
})

test('advanced errors follow the draft when a rule is corrected or turned off @pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 650 })
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Simulation Settings' })
  const evolve = dialog.getByRole('button', { name: 'Evolve!' })
  const errors = dialog.locator('.settings-errors')

  await advancedSettings(page, 'Hunting')
  const predation = dialog.getByRole('checkbox', { name: 'Predation', exact: true })
  await predation.check()
  const huntingDay = dialog.getByRole('spinbutton', { name: 'First hunting day' })
  await huntingDay.fill('0')
  await evolve.click()
  await expect(huntingDay).toBeFocused()
  await huntingDay.fill('-1')
  await expect(errors).toContainText('First hunting day')
  await predation.uncheck()
  await expect(errors).toHaveCount(0)

  await advancedSettings(page, 'Field layout')
  const placement = dialog.getByRole('combobox', { name: 'Food placement' })
  await placement.selectOption('patches')
  const patches = dialog.getByRole('spinbutton', { name: 'Number of patches' })
  await patches.fill('9')
  await evolve.click()
  await expect(patches).toBeFocused()
  await placement.selectOption('scattered')
  await expect(errors).toHaveCount(0)

  await advancedSettings(page, 'Day length')
  const endMode = dialog.getByRole('combobox', { name: 'End each day' })
  await endMode.selectOption('timed')
  const seconds = dialog.getByRole('spinbutton', { name: 'Seconds per day' })
  await seconds.fill('0.5')
  await evolve.click()
  await expect(seconds).toBeFocused()
  await endMode.selectOption('settled')
  await expect(errors).toHaveCount(0)

  await advancedSettings(page, 'Starting territories')
  await dialog.getByRole('checkbox', { name: 'Use starting territories' }).check()
  const width = dialog.getByRole('spinbutton', { name: 'Band width (%)' })
  await width.fill('4')
  await evolve.click()
  await expect(width).toHaveAttribute('aria-invalid', 'true')
  await width.fill('3')
  await expect(width).toHaveAttribute('aria-invalid', 'true')
  await width.fill('25')
  await expect(errors).toHaveCount(0)
})

test('advanced previews keep their selections and flag invalid inputs @pages', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Simulation Settings' })
  await advancedSettings(page, 'Aging and lifespan')
  const age = dialog.getByRole('spinbutton', { name: 'Preview age' })
  const onset = dialog.getByRole('spinbutton', { name: 'Aging starts after age' })
  const agingResult = dialog.getByRole('region', { name: 'Aging and lifespan' }).getByRole('status')
  await dialog.getByRole('checkbox', { name: 'Enable aging' }).check()
  await age.fill('12')
  await age.press('Enter')
  await expect(dialog).toBeVisible()
  await onset.fill('4.5')
  await expect(agingResult).toContainText('use valid aging settings')
  await onset.fill('4')
  await expect(agingResult).toContainText('Age 12')

  await advancedSettings(page, 'Foraging decisions')
  const situation = dialog.getByRole('combobox', { name: 'Situation' })
  await situation.selectOption('switch')
  await advancedSettings(page, 'Aging and lifespan')
  await expect(age).toHaveValue('12')
  await advancedSettings(page, 'Foraging decisions')
  await expect(situation).toHaveValue('switch')
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await expect(situation).toHaveValue('memory')
  await advancedSettings(page, 'Aging and lifespan')
  await expect(age).toHaveValue('8')
})

test('advanced validation opens the full dotted species ID and clears a removed override @pages', async ({ page }) => {
  await openSimulator(page)
  const setup = starter()
  setup.species[1].id = 'blue.lab'
  await openRunLibrary(page)
  await page.getByRole('dialog', { name: 'Run Library' }).locator('input[type=file]').setInputFiles({
    name: 'dotted-species.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(setup)),
  })
  const dialog = page.getByRole('dialog', { name: 'Simulation Settings' })
  await advancedSettings(page, 'Foraging decisions')
  const species = dialog.getByRole('combobox', { name: 'Foraging decisions for' })
  const custom = dialog.getByRole('checkbox', { name: 'Use custom settings' })
  const memory = dialog.getByRole('spinbutton', { name: 'Plant memory (seconds)' })
  await species.selectOption('blue.lab')
  await custom.check()
  await memory.fill('3.1')
  await species.selectOption('blue')
  await dialog.getByRole('button', { name: 'Evolve!' }).click()
  await expect(species).toHaveValue('blue.lab')
  await expect(memory).toBeFocused()
  await expect(dialog.locator('.settings-errors')).toContainText('Plant memory')
  await custom.uncheck()
  await expect(dialog.locator('.settings-errors')).toHaveCount(0)
  await expect(memory).toBeDisabled()
})

test('advanced plant schedule allocates whole unused days and explains when full @pages', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await page.getByRole('spinbutton', { name: 'Days to run' }).fill('10')
  await advancedSettings(page, 'Plant supply')
  await page.getByLabel('Food schedule').selectOption('step')
  const add = page.getByRole('button', { name: 'Add point' })
  const days = page.locator('.schedule-row').getByLabel('Day', { exact: true })
  await add.click()
  await days.first().fill('2.5')
  await add.click()
  await expect(days.nth(1)).toHaveValue('2')
  await days.first().fill('3')
  for (let day = 4; day <= 10; day++) await add.click()
  await expect(days).toHaveCount(9)
  await expect(add).toBeDisabled()
  await expect(add).toHaveAccessibleDescription('Every available day already has a schedule point.')
  await page.getByRole('button', { name: 'Remove schedule point' }).first().click()
  await expect(add).toBeEnabled()
  await add.click()
  await expect(days.last()).toHaveValue('3')
})

test('advanced forecast length only saves a valid finished edit @pages', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await advancedSettings(page, 'Graph predictions')
  const cycles = page.getByRole('spinbutton', { name: 'Cycles ahead' })
  await expect(cycles).toHaveValue('5')
  await cycles.fill('')
  await cycles.pressSequentially('26')
  await expect(cycles).toHaveAttribute('aria-invalid', 'true')
  await cycles.press('Tab')
  await expect(cycles).toHaveValue('5')
  await cycles.fill('12')
  await cycles.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Simulation Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  await advancedSettings(page, 'Graph predictions')
  await expect(cycles).toHaveValue('12')
})

test('advanced zero mutation chance disables unused controls without losing their values @pages', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Simulation Settings' })
  await advancedSettings(page, 'Inheritance & mutation')
  const chance = dialog.getByRole('spinbutton', { name: 'Speed mutation chance (%)' })
  const spread = dialog.getByRole('spinbutton', { name: 'σ Speed', exact: true })
  const pattern = dialog.getByRole('combobox', { name: 'Mutation pattern' })
  await dialog.getByRole('combobox', { name: 'Mutation profile' }).selectOption('speed')
  await spread.fill('11')
  await expect(dialog.getByText('Enter valid speed mutation settings to preview the offspring.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Evolve!' }).click()
  await expect(spread).toBeFocused()
  await chance.fill('0')
  await expect(dialog.locator('.settings-errors')).toHaveCount(0)
  await expect(spread).toBeDisabled()
  await expect(pattern).toBeDisabled()
  await expect(chance).toBeEnabled()
  await expect(dialog.getByText(/The child keeps that speed/)).toBeVisible()
  await chance.fill('100')
  await expect(spread).toBeEnabled()
  await expect(spread).toHaveValue('11.00')
})

test('advanced zero birth chance keeps unused reproduction and mutation settings editable later @pages', async ({ page }) => {
  await openSimulator(page)
  await page.getByRole('button', { name: 'Simulation Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Simulation Settings' })
  await advancedSettings(page, 'Reproduction')
  const chance = dialog.getByRole('spinbutton', { name: 'Chance of a birth (%)' })
  const twins = dialog.getByRole('spinbutton', { name: 'Chance of twins (%)' })
  const evolve = dialog.getByRole('button', { name: 'Evolve!' })
  const errors = dialog.locator('.settings-errors')
  await twins.fill('101')
  await evolve.click()
  await expect(twins).toBeFocused()
  await chance.fill('0')
  await expect(twins).toBeDisabled()
  await expect(errors).toHaveCount(0)
  await advancedSettings(page, 'Inheritance & mutation')
  await expect(dialog.getByRole('combobox', { name: 'Mutation profile' })).toBeDisabled()
  await advancedSettings(page, 'Reproduction')
  await chance.fill('1')
  await expect(twins).toBeEnabled()
  await expect(twins).toHaveValue('101')
  await evolve.click()
  await expect(errors).toContainText('Chance of twins')
})

test('species editor introduces, splits, and renames blobs at the paused tick @pages', async ({ page, context }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openSimulator(page)
  await startRun(page, '10', async () => {
    await fixedDay(page, '10')
    const newSpecies = page.getByRole('button', { name: 'New species', exact: true })
    await newSpecies.click()
    await page.getByRole('button', { name: 'Wide sight' }).click()
    await expect(page.getByRole('spinbutton', { name: 'Sense Range' })).toHaveValue('40')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Species 4', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Blue copy')
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Spruce')
    const founders = page.getByRole('spinbutton', { name: 'Founders' })
    await expect(founders).toHaveValue('50')
    await founders.fill('10')
    await page.getByRole('button', { name: 'Add to setup' }).click()
    await expect(page.getByRole('button', { name: 'Spruce', exact: true })).toBeVisible()
  })
  await stepTo(page, 0.1)
  await stepTo(page, 0.2)
  const speciesButton = page.getByRole('button', { name: 'Species', exact: true })
  const editor = page.getByRole('dialog', { name: 'Species', exact: true })
  const apply = editor.getByRole('button', { name: 'Apply changes' })
  const name = editor.getByRole('textbox', { name: 'Name', exact: true })
  await speciesButton.click()
  await name.fill('Mint')
  const count = editor.getByRole('spinbutton', { name: 'Blobs to introduce' })
  await count.fill('0')
  await expect(apply).toBeDisabled()
  await count.fill('1')
  await editor.getByRole('button', { name: 'Fast', exact: true }).click()
  await expect(editor.getByText('1 blob · Day 1 at 0.20 s')).toBeVisible()
  await expect(editor.locator('.trait-preview summary')).toHaveText('#61')
  await apply.click()
  await expect(editor.getByRole('status')).toHaveText(/Introduced 1 blob in Mint/)
  await editor.getByRole('button', { name: 'Make another change' }).click()
  await editor.getByRole('button', { name: 'Split living blobs' }).click()
  await name.fill('Teal')
  await editor.getByLabel('Pick blobs').selectOption('ids')
  await editor.getByLabel('Find by ID').fill('#1')
  await editor.getByRole('checkbox', { name: /^#1 Active$/ }).check()
  await apply.click()
  await expect(editor.getByRole('status')).toHaveText(/Moved 1 blob in Teal/)
  await stepAfterClosing()
  await speciesButton.click()
  await editor.getByRole('button', { name: 'Edit species' }).click()
  await editor.getByLabel('Species to edit').selectOption({ label: 'Teal · 1 living' })
  await name.fill('Jade')
  await editor.getByLabel('Change type').selectOption('set')
  await editor.getByRole('checkbox', { name: 'Speed', exact: true }).check()
  await editor.getByLabel('Speed value').fill('12')
  await apply.click()
  await expect(editor.getByRole('status')).toHaveText(/Updated Jade/)
  await editor.getByRole('button', { name: 'Done' }).click()
  await expect(speciesButton).toBeFocused()
  await page.reload()

  const details = page.getByRole('complementary', { name: 'Creature details' })
  const creature = details.getByRole('combobox', { name: 'Creature', exact: true })
  await selectFounder()
  await expect(details.getByText('Jade · #1', { exact: true })).toBeVisible()
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  const replay = page.getByRole('slider', { name: 'Replay time' })
  await replay.fill('0.1')
  await expect(details.getByText('Blue · #1', { exact: true })).toBeVisible()
  await expect(creature.getByRole('option', { name: /#61/ })).toHaveCount(0)
  await replay.fill('0.2')
  await expect(details.getByText('Teal · #1', { exact: true })).toBeVisible()
  await expect(creature.getByRole('option', { name: '#61 · Mint' })).toHaveCount(1)
  await expect(details.getByRole('button', { name: '0.20 s Moved to Teal' })).toBeVisible()
  await replay.fill('0.3')
  await expect(details.getByText('Jade · #1', { exact: true })).toBeVisible()
  await expect(details.getByText('Speed', { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('12.00')

  await openRunLibrary(page)
  const library = page.getByRole('dialog', { name: 'Run Library' })
  const original = library.locator('article').filter({ hasText: 'Browser test run' })
  await original.getByRole('button', { name: 'Actions', exact: true }).click()
  await original.getByRole('button', { name: 'Copy setup link' }).click()
  await expect(library.getByText('Setup link copied. It opens a new experiment draft.')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const shared = setupFromLink(new URL(link).hash)
  expect(shared.species.find(item => item.name === 'Spruce').count).toBe(10)
  expect(shared.species.map(item => item.name)).not.toContain('Mint')
  await page.keyboard.press('Escape')

  const options = page.getByRole('button', { name: 'Run options' })
  await options.click()
  await page.getByRole('button', { name: 'Branch here', exact: true }).click()
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()
  await expect(options).toHaveText('Day 2 / 10 · Ready')
  await page.getByRole('button', { name: 'Previous day' }).click()
  await selectFounder()
  await replay.fill('0.3')
  await expect(details.getByText('Jade · #1', { exact: true })).toBeVisible()

  await openRunLibrary(page)
  const branch = library.locator('article').filter({ hasText: 'Browser test run · branch' })
  await branch.getByRole('button', { name: 'Actions', exact: true }).click()
  const download = page.waitForEvent('download')
  await branch.getByRole('button', { name: 'Export setup' }).click()
  const buffer = await readFile(await (await download).path())
  const exported = JSON.parse(buffer)
  expect(exported.speciesActions.map(({ kind, tick }) => [kind, tick])).toEqual([['introduce', 2], ['split', 2], ['edit', 3]])
  const invalid = { ...exported, speciesActions: [{ ...exported.speciesActions[0], tick: 0, creatureIds: [900] }] }
  await library.locator('input[type=file]').setInputFiles({
    name: 'invalid-species-branch.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)),
  })
  await expect(library.getByRole('alert')).toHaveText('This file contains incompatible run history.')
  await expect(options).toHaveText('Day 1 / 10 · Replay')
  await library.locator('input[type=file]').setInputFiles({ name: 'species-branch.json', mimeType: 'application/json', buffer })
  await expect(options).toHaveText('Day 1 / 10 · Ready')
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Watch last day' }).click()
  await selectFounder()
  await replay.fill('0.3')
  await expect(details.getByText('Jade · #1', { exact: true })).toBeVisible()
  expect(errors).toEqual([])

  async function selectFounder() {
    if (!await creature.isVisible()) {
      await page.getByRole('button', { name: 'View options' }).click()
      await page.getByRole('button', { name: 'Creatures', exact: true }).click()
    }
    await creature.selectOption('1')
  }

  async function stepAfterClosing() {
    await editor.getByRole('button', { name: 'Done' }).click()
    await stepTo(page, 0.3)
  }
})

test('species editor fits a phone and can return to live after a replay @pages', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 620 }, isMobile: true, hasTouch: true })
  try {
    const page = await context.newPage()
    await openSimulator(page)
    await startRun(page, '10', () => fixedDay(page, '10'))
    const button = page.getByRole('button', { name: 'Species', exact: true })
    const editor = page.getByRole('dialog', { name: 'Species', exact: true })
    await button.tap()
    const bounds = await editor.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(375)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(620)
    const clippedInputs = await editor.locator('.species-starting-fields .number-shell').evaluateAll(shells =>
      shells.flatMap(shell => {
        const outer = shell.getBoundingClientRect()
        return [...shell.children].filter(child => {
          const inner = child.getBoundingClientRect()
          return inner.right > outer.right + 1 || inner.bottom > outer.bottom + 1
        }).map(child => child.tagName)
      })
    )
    expect(clippedInputs).toEqual([])
    await editor.getByRole('button', { name: 'Sturdy' }).tap()
    await expect(editor.getByRole('spinbutton', { name: 'Size', exact: true })).toHaveValue('16')
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(button).toBeFocused()
    await quickThrough(page, 1)
    await page.getByRole('button', { name: 'Watch last day' }).click()
    await button.tap()
    await expect(editor.getByRole('button', { name: 'Apply changes' })).toHaveCount(0)
    await editor.getByRole('button', { name: 'Back to Live' }).tap()
    await expect(editor.getByRole('button', { name: 'Apply changes' })).toBeEnabled()
    await editor.getByRole('button', { name: 'Apply changes' }).tap()
    await expect(editor.getByRole('status')).toHaveText(/Introduced 10 blobs/)
  } finally {
    await context.close()
  }
})

for (const [screen, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
]) {
  test(`species food web preview, paused edits and meal counts work on ${screen} @pages`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize(viewport)
    await openSimulator(page)
    await expect(page).toHaveTitle(/Evolution Simulator/)

    await startRun(page, '10', async () => {
      await fixedDay(page)
      await page.getByRole('button', { name: 'Orange Off', exact: true }).click()
      await page.getByRole('checkbox', { name: 'Enabled', exact: true }).check()
      await advancedSettings(page, 'Species food web')
      const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
      const enable = settings.getByRole('switch', { name: 'Enable species food web' })
      await enable.focus()
      await enable.press('Space')
      await expect(enable).toBeChecked()
      await settings.getByLabel('Eating species').selectOption('orange')
      await settings.getByLabel('Eats plants').uncheck()
      await settings.getByLabel('Can hunt').selectOption('none')
      await expect(settings.getByText('Orange has no food sources', { exact: false })).toBeVisible()
      await settings.getByLabel('Can hunt').selectOption('selected')
      await settings.getByRole('checkbox', { name: 'Blue', exact: true }).check()
      await settings.getByLabel('Food source').selectOption('blue')
      await settings.getByLabel('Hunter size').fill('15')
      await settings.getByLabel('Prey size').fill('12')
      await expect(settings.getByText('This hunt is allowed if the hunter catches the prey.')).toBeVisible()
      await settings.getByLabel('Hunter size').fill('14.99')
      await expect(settings.getByText('The hunter is below the required size advantage.')).toBeVisible()
      await settings.getByLabel('Generation', { exact: true }).fill('0')
      await expect(settings.getByText('Enter a generation within the run limit.')).toBeVisible()
      await settings.getByLabel('Generation', { exact: true }).fill('1')
      const screenshots = process.env.FOOD_WEB_SCREENSHOTS
      if (screenshots) {
        await settings.getByText('The hunter is below the required size advantage.').scrollIntoViewIfNeeded()
        await page.screenshot({ path: screenshots + '/food-web-' + screen + '.png' })
      }
    })

    await stepTo(page, 0.1)
    const species = page.getByRole('button', { name: 'Species', exact: true })
    const editor = page.getByRole('dialog', { name: 'Species', exact: true })
    const edit = editor.getByRole('button', { name: 'Edit food web' })
    await species.click()
    await edit.click()
    await expect(editor.getByText('Generation 1 · Step 1')).toBeVisible()
    const enable = editor.getByRole('switch', { name: 'Enable species food web' })
    await enable.uncheck()
    await editor.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(species).toBeFocused()
    await species.click()
    await edit.click()
    await expect(enable).toBeChecked()
    await enable.uncheck()
    await editor.getByRole('button', { name: 'Apply changes' }).click()
    await expect(editor.getByRole('status').filter({ hasText: 'Updated the species food web' })).toBeVisible()
    await editor.getByRole('button', { name: 'Done' }).click()
    await page.reload()
    await species.click()
    await edit.click()
    await expect(enable).not.toBeChecked()
    await editor.getByRole('button', { name: 'Discard', exact: true }).click()

    await quickThrough(page, 2)
    await expect(batchStatus(page, 'Saved through')).toHaveText('Day 2')
    await page.getByRole('button', { name: 'Watch last day' }).click()
    await dayTile(page, 1).click()
    const replay = page.getByRole('slider', { name: 'Replay time' })
    await replay.fill('0')
    await species.click()
    await expect(enable).toBeChecked()
    await expect(enable).toBeDisabled()
    await editor.getByRole('button', { name: 'Close' }).click()
    await replay.fill('0.1')
    await species.click()
    await expect(enable).not.toBeChecked()
    await editor.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('link', { name: 'Trends', exact: true }).click()
    await page.getByRole('button', { name: 'Advanced stats', exact: true }).click()
    const stats = page.getByRole('dialog', { name: 'Advanced stats' })
    await stats.getByRole('button', { name: 'Food & Hunting' }).click()
    const table = stats.getByRole('table', { name: 'Generation 2' })
    await expect(table).toBeVisible()
    await stats.getByRole('combobox', { name: 'Generation', exact: true }).selectOption('1')
    const first = stats.getByRole('table', { name: 'Generation 1' })
    await expect(first.getByRole('rowheader', { name: 'Blue' })).toBeVisible()
    await stats.getByRole('combobox', { name: 'Species', exact: true }).selectOption('orange')
    await expect(first.getByRole('rowheader')).toHaveText('Orange')

    if (screen === 'desktop') {
      await page.keyboard.press('Escape')
      const options = page.getByRole('button', { name: 'Run options' })
      await options.click()
      await page.getByRole('button', { name: 'Branch here', exact: true }).click()
      await page.getByLabel('Branch after day').fill('1')
      await page.getByRole('button', { name: 'Edit branch rules' }).click()
      await advancedSettings(page, 'Species food web')
      const settings = page.getByRole('dialog', { name: 'Branch Settings' })
      const branchEnable = settings.getByRole('switch', { name: 'Enable species food web' })
      await expect(branchEnable).not.toBeChecked()
      await branchEnable.check()
      await settings.getByRole('combobox', { name: 'Eating species' }).selectOption('orange')
      await expect(settings.getByRole('checkbox', { name: 'Blue', exact: true })).toBeChecked()
      await settings.getByRole('button', { name: 'Create branch' }).click()
      await expect(options).toHaveText('Day 2 / 10 · Ready')
      await page.getByRole('link', { name: 'World', exact: true }).click()
      await species.click()
      await edit.click()
      await expect(enable).toBeChecked()
    }
    expect(errors).toEqual([])
  })
}

test('historical meal tables keep known totals and can recover prey counts from replay @pages', async ({ page }) => {
  await page.addInitScript(() => {
    const WorkerConstructor = window.Worker
    window.failHistoricalMealReplay = false
    window.Worker = class extends WorkerConstructor {
      postMessage(data, ...args) {
        if (window.failHistoricalMealReplay && data.type === 'replay') {
          window.failHistoricalMealReplay = false
          queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
            data: { id: data.id, type: 'error', message: 'Replay unavailable for test' },
          })))
          return
        }
        super.postMessage(data, ...args)
      }
    }
  })
  await openSimulator(page)
  await startRefugeFixture(page, setup => {
    Object.assign(setup, { food: 150, endMode: 'timed', duration: 100 })
    Object.assign(setup.species[0], { size: 12, sense: 100, energy: 1000 })
    Object.assign(setup.species[1], { enabled: true, size: 7, sense: 50, energy: 1000 })
  })
  await quickThrough(page, 1)
  await expect(batchStatus(page, 'Saved through')).toHaveText('Day 1')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced stats', exact: true }).click()
  const stats = page.getByRole('dialog', { name: 'Advanced stats' })
  await page.evaluate(() => { window.failHistoricalMealReplay = true })
  await stats.getByRole('button', { name: 'Food & Hunting' }).click()
  const blue = stats.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Blue', exact: true }) })
  const unavailable = stats.getByText('Prey breakdown unavailable for this generation.')
  await expect(unavailable).toBeVisible()
  await expect(blue.getByRole('cell')).toHaveText([/^\d+$/, '—', '—', '10', /^\d+$/])
  await stats.getByRole('button', { name: 'Try again' }).click()
  await expect(blue.getByRole('cell')).toHaveText([/^\d+$/, '0', '10', '10', /^\d+$/])
  await expect(unavailable).toBeHidden()
})
