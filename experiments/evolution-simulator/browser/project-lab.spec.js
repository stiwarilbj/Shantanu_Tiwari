import { expect, test } from '@playwright/test'

test.skip(!process.env.PAGES_URL, 'Requires the Project Lab Pages build')

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('evolution.tour', 'seen'))
  await page.goto('')
  await expect(page.getByRole('button', { name: 'Simulation Settings' })).toBeEnabled()
})

test('the simulator fills the viewport below the shared navbar @pages', async ({ page }) => {
  await expect(page).toHaveTitle('Evolution Simulator')
  const navbar = page.getByRole('navigation', { name: 'Main navigation', exact: true })
  const app = page.locator('#app')
  await expect(navbar).toBeVisible()

  for (const [width, height] of [[1440, 900], [768, 530], [390, 844], [320, 420], [740, 380], [740, 320]]) {
    await page.setViewportSize({ width, height })
    await expect.poll(() => app.evaluate(element => {
      const { left, right, top, bottom } = element.getBoundingClientRect()
      const navbarBottom = document.querySelector('[data-site-navbar]').getBoundingClientRect().bottom
      return {
        left,
        right,
        gap: top - navbarBottom,
        bottom,
        horizontalScroll: document.documentElement.scrollWidth - innerWidth,
        verticalScroll: document.documentElement.scrollHeight - innerHeight,
        corners: [0, innerWidth - 1].every(x =>
          [Math.ceil(navbarBottom), innerHeight - 1].every(y => element.contains(document.elementFromPoint(x, y)))
        ),
      }
    })).toEqual({ left: 0, right: width, gap: 0, bottom: height, horizontalScroll: 0, verticalScroll: 0, corners: true })
  }

  const stats = page.getByRole('heading', { name: 'Current Generation Stats' })
  await stats.scrollIntoViewIfNeeded()
  await expect(stats).toBeInViewport({ ratio: 0.95 })
  expect(await page.locator('#main-surface').evaluate(surface => surface.scrollTop)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('the keyboard skip link clears the shared navbar and Experiments stays reachable @pages', async ({ page }) => {
  const navbar = page.getByRole('navigation', { name: 'Main navigation', exact: true })
  const skipLink = page.getByRole('link', { name: 'Skip to content' })
  await navbar.getByRole('link', { name: 'Old Projects', exact: true }).press('ArrowDown')
  await expect(navbar.getByRole('link', { name: 'Filler for Old Projects' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(skipLink).toBeFocused()
  expect(await skipLink.evaluate(link => {
    const rect = link.getBoundingClientRect()
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === link
  })).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-surface')).toBeFocused()

  await navbar.getByRole('link', { name: 'Experiments', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Experiments', exact: true })).toBeVisible()
})

test('simulator popups remain keyboard accessible below the shared navbar @pages', async ({ page }) => {
  const run = page.getByRole('button', { name: 'Run options' })
  await run.press('Enter')
  await expect(run).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Run Library', exact: true }).press('Escape')
  await expect(run).toBeFocused()
  await expect(run).toHaveAttribute('aria-expanded', 'false')

  const view = page.getByRole('button', { name: 'View options' })
  await view.press('Enter')
  await page.getByRole('button', { name: 'Fit board' }).press('Enter')
  await expect(view).toHaveAttribute('aria-expanded', 'false')
})

test('the video sequence fills the simulator without covering the shared navbar @pages', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('link', { name: 'About', exact: true }).click()
  await page.getByRole('combobox', { name: 'Days per run' }).selectOption('100')
  await page.getByRole('button', { name: 'Run both and compare' }).click()
  await page.getByRole('heading', { name: 'Compare runs' }).waitFor()
  await page.setViewportSize({ width: 320, height: 420 })
  for (const name of ['Left run', 'Right run']) {
    const picker = page.getByRole('combobox', { name, exact: true })
    const box = await picker.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
  }
  await page.getByRole('button', { name: /Stage video moments/ }).click()
  const play = page.getByRole('button', { name: 'Play video sequence' })
  const stop = page.getByRole('button', { name: 'Stop video sequence' })
  const stage = page.locator('.cinematic-sequence')
  const navbar = page.getByRole('navigation', { name: 'Main navigation', exact: true })
  const wordmark = navbar.getByRole('link', { name: 'Project Lab' })

  for (const [width, height] of [[1280, 850], [768, 600], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await play.click()
    await expect(stop).toBeFocused()
    const stageBox = await stage.boundingBox()
    const navBox = await navbar.boundingBox()
    expect(stageBox.y).toBeCloseTo(navBox.y + navBox.height)
    expect(stageBox.y + stageBox.height).toBeCloseTo(height)
    await expect(stage.getByRole('region', { name: 'Left run' })).toContainText('Day 6')
    await expect(stage.getByRole('region', { name: 'Right run' })).toContainText('Day 77')
    await wordmark.click({ trial: true })
    await page.keyboard.press('Escape')
    await expect(stage).toHaveCount(0)
    await expect(play).toBeFocused()
  }
})

test.describe('short touch viewports', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 320, height: 420 } })

  test('the site menu leaves enough room for the tabletop and controls @pages', async ({ page }) => {
    const navbar = page.getByRole('navigation', { name: 'Main navigation', exact: true })
    const menu = navbar.getByRole('button', { name: 'Menu', exact: true })
    await menu.tap()
    const project = navbar.getByRole('link', { name: 'Evolution Simulator' })
    await expect(project).toBeInViewport()

    const layout = await page.locator('[data-site-navbar]').evaluate(header => ({
      panelBottom: header.querySelector('#nav-links').getBoundingClientRect().bottom,
      tabletopTop: document.querySelector('#app').getBoundingClientRect().top,
      stageHeight: document.querySelector('.stage').getBoundingClientRect().height,
      fullWidth: document.documentElement.scrollWidth,
    }))
    expect(layout.tabletopTop).toBeCloseTo(layout.panelBottom)
    expect(layout.stageHeight).toBeGreaterThan(150)
    expect(layout.fullWidth).toBe(320)

    await menu.tap()
    await expect(project).toBeHidden()
    await page.getByRole('button', { name: 'View options' }).tap()
    await expect(page.getByRole('button', { name: /^Overhead/ })).toBeVisible()
  })

  test('layer options stay in the tabletop and can be reached on a short screen @pages', async ({ page }) => {
    const layers = page.getByRole('button', { name: 'Layers', exact: true })
    for (const [width, height] of [[320, 420], [390, 520]]) {
      await page.setViewportSize({ width, height })
      await layers.tap()
      const dimensions = await page.locator('.layer-panel').evaluate(panel => ({
        top: panel.getBoundingClientRect().top,
        bottom: panel.getBoundingClientRect().bottom,
        toolbarBottom: document.querySelector('.run-center').getBoundingClientRect().bottom,
        playbackTop: panel.closest('.stage').querySelector('.player-actions').getBoundingClientRect().top,
        visibleHeight: panel.clientHeight,
        scrollHeight: panel.scrollHeight,
      }))
      expect(dimensions.top).toBeGreaterThanOrEqual(dimensions.toolbarBottom)
      expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.playbackTop)
      expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.visibleHeight)
      await expect(page.getByRole('button', { name: 'Sense range', exact: true })).toBeInViewport({ ratio: 0.8 })

      await page.getByRole('button', { name: 'More layer options' }).tap()
      const back = page.getByRole('button', { name: 'Back to layers' })
      await expect(back).toBeInViewport()
      await back.tap()
      await expect(layers).toHaveAttribute('aria-expanded', 'true')
      await layers.tap()
    }
  })

  test('a long run name leaves room for every run action and the seed stays editable @pages', async ({ page }) => {
    await page.getByRole('button', { name: 'Simulation Settings' }).tap()
    const seed = page.getByRole('spinbutton', { name: 'Random seed' })
    await seed.scrollIntoViewIfNeeded()
    expect(await seed.evaluate(input => {
      const field = input.getBoundingClientRect()
      const shell = input.closest('.number-shell').getBoundingClientRect()
      return field.left >= shell.left && field.right <= shell.right
    })).toBe(true)
    await seed.tap()
    await seed.fill('42')
    const name = 'W'.repeat(60)
    await page.getByRole('textbox', { name: 'Run name' }).fill(name)
    await page.getByRole('button', { name: 'Evolve!', exact: true }).tap()

    const run = page.getByRole('button', { name: 'Run options' })
    await expect(run).toHaveAttribute('title', name)
    await run.tap()
    const menu = page.locator('.run-menu')
    await expect(menu).toContainText('Seed 42')
    const box = await menu.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
    expect(box.y + box.height).toBeLessThanOrEqual(420)
    await menu.getByRole('button', { name: 'Show tour' }).tap()
    await expect(page.getByRole('dialog', { name: 'Explore the tabletop' })).toBeVisible()
  })

  test('settings fields scroll clear of the title and Evolve button @pages', async ({ page }) => {
    for (const [width, height] of [[320, 420], [740, 320]]) {
      await page.setViewportSize({ width, height })
      await page.getByRole('button', { name: 'Simulation Settings' }).tap()
      const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
      const fields = settings.locator('.settings-fields')
      const close = settings.getByRole('button', { name: 'Close settings' })
      const evolve = settings.getByRole('button', { name: 'Evolve!', exact: true })
      const initial = await fields.boundingBox()
      const closeBox = await close.boundingBox()
      expect(initial.y).toBeGreaterThanOrEqual(closeBox.y + closeBox.height)
      expect(initial.y + initial.height).toBeLessThanOrEqual((await evolve.boundingBox()).y)

      const mutation = settings.getByRole('checkbox', { name: 'Allow size mutation' })
      const checked = await mutation.isChecked()
      await mutation.tap()
      await expect(mutation).toHaveJSProperty('checked', !checked)

      const days = settings.getByRole('spinbutton', { name: 'Days to run' })
      await days.fill('1')
      await evolve.tap()
      const errors = settings.getByRole('alert')
      await expect(errors).toContainText('Days')
      await expect(errors).toBeInViewport({ ratio: 1 })
      await expect(days).toBeFocused()
      await expect(days).toBeInViewport({ ratio: 1 })
      await expect(close).toBeInViewport({ ratio: 1 })
      await expect(evolve).toBeInViewport({ ratio: 1 })
      await close.tap()
      await expect(settings).toBeHidden()
    }
  })

  test('following a creature leaves its controls and playback reachable on a phone @pages', async ({ page }) => {
    await page.getByRole('button', { name: 'Follow creature' }).tap()
    const follow = page.locator('.creature-flower')
    const sense = follow.getByRole('button', { name: 'Sense focus' })
    await sense.tap()
    await expect(sense).toHaveAttribute('aria-pressed', 'true')

    const panelBox = await follow.boundingBox()
    const playbackBox = await page.locator('.player-actions').boundingBox()
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(playbackBox.y)

    await follow.getByRole('button', { name: /^Current creature details/ }).tap()
    const details = page.getByRole('complementary', { name: 'Creature details' })
    await expect(follow).toBeHidden()
    const picker = details.getByRole('combobox', { name: 'Creature', exact: true })
    await expect(picker).toBeInViewport({ ratio: 1 })
    await picker.selectOption({ index: 2 })
    await expect(details.getByRole('progressbar', { name: 'Remaining energy' })).toBeAttached()
    await details.getByRole('button', { name: 'Close creature details' }).tap()
    await expect(follow).toBeVisible()
    await page.getByRole('button', { name: 'Quick Sim', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: 'Quick Sim' })).toBeVisible()
  })
})

test('playback actions stay below the run controls in a short split screen @pages', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 320 })
  await page.getByRole('button', { name: 'Playback actions' }).click()
  const menu = page.locator('.player-menu')
  const [menuBox, controlsBox, playbackBox] = await Promise.all(
    [menu, page.locator('.run-center'), page.locator('.player-actions')].map(locator => locator.boundingBox())
  )
  expect(menuBox.y).toBeGreaterThanOrEqual(controlsBox.y + controlsBox.height)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(playbackBox.y)
  await menu.getByRole('button', { name: 'Go to frontier' }).click()
  await expect(menu).toBeHidden()
})

test('playback readouts stay clear of the transport and scrubber @pages', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
      return kind === 'webgl2' ? null : getContext.call(this, kind, ...options)
    }
  })
  await page.reload()
  const clock = page.locator('.time-label')
  const canvasNote = page.getByText('Canvas view', { exact: true })
  await expect(canvasNote).toBeVisible()
  await page.getByRole('button', { name: /^Day 1, population/ }).click()
  const scrubber = page.getByRole('slider', { name: 'Replay time' })
  await scrubber.press('Home')
  await expect(scrubber).toHaveValue('0')
  await expect(clock).toBeVisible()

  for (const [width, height] of [[390, 844], [740, 320], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    await scrubber.press('End')
    await expect(scrubber).toHaveValue(await scrubber.getAttribute('max'))
    const [clockBox, canvasBox, player, actions] = await Promise.all(
      [clock, canvasNote, page.locator('.player'), page.locator('.player-actions')].map(locator => locator.boundingBox())
    )
    expect(Math.min(clockBox.y, canvasBox.y)).toBeGreaterThanOrEqual(Math.max(player.y + player.height, actions.y + actions.height))
    expect(clockBox.x + clockBox.width).toBeLessThan(canvasBox.x)
  }
})

test('settings remain reachable when validation fills a very short dialog @pages', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 234 })
  await page.getByRole('button', { name: 'Simulation Settings' }).press('Enter')
  const settings = page.getByRole('dialog', { name: 'Simulation Settings' })
  for (const name of ['Days to run', 'Random seed', 'Speed', 'Size', 'Energy']) {
    await settings.getByRole('spinbutton', { name, exact: true }).fill('0')
  }
  const evolve = settings.getByRole('button', { name: 'Evolve!', exact: true })
  await evolve.click()
  await expect(settings.getByRole('alert')).toContainText('Days')
  await settings.getByRole('button', { name: 'Discard changes' }).click()
  await settings.evaluate(dialog => { dialog.scrollTop = dialog.scrollHeight })
  await expect(evolve).toBeInViewport({ ratio: 1 })
  await evolve.click({ trial: true })
  await settings.getByRole('button', { name: 'Keep editing' }).click()
  const days = settings.getByRole('spinbutton', { name: 'Days to run', exact: true })
  await days.click()
  await expect(days).toBeFocused()
  await expect(days).toBeInViewport({ ratio: 1 })
  await settings.getByRole('button', { name: 'Close settings' }).click()
  await expect(settings).toBeHidden()
})

test('creature and generation panels clear the run controls in a short split screen @pages', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 320 })
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: 'Creatures', exact: true }).click()
  const details = page.getByRole('complementary', { name: 'Creature details' })
  const runBox = await page.locator('.run-center').boundingBox()
  expect((await details.boundingBox()).y).toBeGreaterThanOrEqual(runBox.y + runBox.height)
  await details.getByRole('button', { name: 'Close creature details' }).click()

  const options = page.getByRole('button', { name: 'Generation options' })
  await options.click()
  const menu = page.locator('.ribbon-menu')
  expect((await menu.boundingBox()).y).toBeGreaterThanOrEqual(runBox.y + runBox.height)
  await menu.getByRole('button', { name: 'Mini line' }).click()
  await expect(page.locator('.ribbon-line')).toBeVisible()

  const day = page.getByRole('button', { name: /^Day 1, population/ })
  await day.click({ button: 'right' })
  const readings = page.getByRole('region', { name: 'Day 1 readings' })
  expect((await readings.boundingBox()).y).toBeGreaterThanOrEqual(runBox.y + runBox.height)
  const close = readings.getByRole('button', { name: 'Close' })
  await expect(close).toBeInViewport({ ratio: 1 })
  await close.click()
  await expect(day).toBeFocused()

  await page.setViewportSize({ width: 320, height: 320 })
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: 'Full screen', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.matches('.world'))).toBe(true)
  await options.click()
  await expect(menu).toBeInViewport({ ratio: 1 })
  await menu.getByRole('button', { name: 'Walkthrough flower' }).click()
  await expect(menu).toBeHidden()
})
