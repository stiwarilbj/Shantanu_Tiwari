import { expect, test } from '@playwright/test'

test.skip(!process.env.PAGES_URL, 'Requires the Project Lab Pages build')

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('evolution.tour', 'seen'))
  await page.goto('')
  await expect(page.getByRole('button', { name: 'Simulation Settings' })).toBeEnabled()
})

test('the simulator fills the viewport below the shared navbar @pages', async ({ page }) => {
  await expect(page).toHaveTitle('Evolution Simulator | Project Lab')
  const navbar = page.getByRole('navigation', { name: 'Main navigation' })
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
  const navbar = page.getByRole('navigation', { name: 'Main navigation' })
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

test('simulator popups close on Escape without stealing focus from other controls @pages', async ({ page }) => {
  const run = page.getByRole('button', { name: 'Run options' })
  await run.press('Enter')
  await expect(run).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Run Library', exact: true }).press('Escape')
  await expect(run).toBeFocused()
  await expect(run).toHaveAttribute('aria-expanded', 'false')

  await run.press('Enter')
  const trends = page.getByRole('link', { name: 'Trends', exact: true })
  await trends.focus()
  await expect(run).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Escape')
  await expect(trends).toBeFocused()

  const view = page.getByRole('button', { name: 'View options' })
  await view.press('Enter')
  await page.getByRole('button', { name: 'Fit board' }).press('Escape')
  await expect(view).toHaveAttribute('aria-expanded', 'false')
  await expect(view).toBeFocused()
})

test('staged comparison opens three recorded scenes and keeps the shared navbar usable @pages', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('link', { name: 'About', exact: true }).click()
  await page.getByRole('combobox', { name: 'Days per run' }).selectOption('100')
  await page.getByRole('button', { name: 'Run both and compare' }).click()
  await page.getByRole('button', { name: /Stage video moments/ }).click()
  const play = page.getByRole('button', { name: 'Play video sequence' })
  const stop = page.getByRole('button', { name: 'Stop video sequence' })
  const stage = page.locator('.cinematic-sequence')
  const navbar = page.getByRole('navigation', { name: 'Main navigation' })
  const wordmark = navbar.getByRole('link', { name: 'Project Lab' })

  for (const [width, height] of [[1280, 850], [768, 600], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await play.click()
    await expect(stop).toBeFocused()
    await expect(page.getByRole('navigation', { name: 'Evolution Simulator navigation' })).toBeHidden()
    await expect(stage.getByRole('button', { name: 'Play sequence', exact: true })).toBeVisible()
    const bounds = await stage.evaluate(element => {
      const frame = element.getBoundingClientRect()
      const nav = document.querySelector('[data-site-navbar]').getBoundingClientRect()
      const lanes = [...element.querySelectorAll('.sequence-boards > section')]
      const [first, second] = lanes.map(lane => lane.getBoundingClientRect())
      return { top: frame.top, navBottom: nav.bottom, bottom: frame.bottom,
        stacked: second.top >= first.bottom, secondVisible: second.bottom <= frame.bottom }
    })
    expect(bounds.top).toBeCloseTo(bounds.navBottom)
    expect(bounds.bottom).toBe(height)
    expect(bounds.stacked).toBe(width <= 560)
    expect(bounds.secondVisible).toBe(true)
    await wordmark.click({ trial: true })

    const wide = stage.getByRole('region', { name: 'Wide mutation Day 6' })
    const narrow52 = stage.getByRole('region', { name: 'Narrow mutation Day 52' })
    await expect(wide).toHaveClass(/sequence-active/)
    await expect(narrow52).toContainText('Field view')
    await stage.getByRole('button', { name: 'Catch prey 0.100 s' }).click()
    await expect(stage.getByRole('slider', { name: 'Scene progress' })).toHaveAttribute('aria-valuetext', '0.100 s of 0.900 s')
    await expect(stage.locator('.sequence-subject')).toContainText('1 food credit')
    await stage.getByRole('button', { name: 'Day 52 Plant foraging' }).click()
    await expect(narrow52).toHaveClass(/sequence-active/)
    await expect(wide).toContainText('0.900 s')
    await expect(stage.locator('.sequence-totals')).toContainText(/\d+ plants \d+ hunts/)
    const plant = stage.getByRole('button', { name: /^Eat a plant \d+\.\d{3} s$/ })
    const plantTime = await plant.locator('span').innerText()
    await plant.press('Enter')
    await expect(narrow52).toContainText('Close view')
    await expect(narrow52).toContainText(plantTime)
    await expect(stage.locator('.sequence-subject')).toContainText('1 food credit')
    await stage.getByRole('button', { name: /^Reach refuge/ }).click()
    await expect(stage.locator('.sequence-subject')).toContainText('At refuge')
    const chapter77 = stage.getByRole('button', { name: /^Day 77/ })
    await chapter77.click()
    await expect(chapter77).toHaveAttribute('aria-current', 'step')
    const narrow77 = stage.getByRole('region', { name: 'Narrow mutation Day 77' })
    await expect(narrow77).toContainText('Field view')
    if ((await chapter77.innerText()).includes('Field view')) {
      await expect(stage.getByRole('status')).toContainText('no recorded hunt')
      await expect(stage.getByRole('button', { name: /^Catch prey/ })).toHaveCount(0)
    }
    const meal = stage.getByRole('button', { name: /^(Catch prey|Eat a plant)/ })
    const mealTime = await meal.locator('span').innerText()
    await meal.click()
    await expect(narrow77).toContainText(mealTime)
    await expect(stage.getByRole('slider', { name: 'Scene progress' })).toHaveAttribute('aria-valuetext', new RegExp('^' + mealTime))
    await page.keyboard.press('Escape')
    await expect(stage).toHaveCount(0)
    await expect(play).toBeFocused()
    await expect(page.getByRole('spinbutton', { name: 'Right day' })).toHaveValue('52')
  }

  await play.click()
  await stage.getByRole('button', { name: 'Compare Day 52' }).click()
  await expect(page.getByRole('heading', { name: 'Day 52 results' })).toBeFocused()
  await expect(page.getByRole('spinbutton', { name: 'Left day' })).toHaveValue('52')

  await play.click()
  await stage.getByRole('button', { name: 'Size trends' }).click()
  await expect(page.getByRole('article', { name: 'Average Size chart' })).toBeFocused()

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await play.click()
  await expect(stage.getByRole('button', { name: 'Pause sequence' })).toBeVisible()
  await expect(stage.getByRole('button', { name: /^Day 52/ })).toHaveAttribute('aria-current', 'step', { timeout: 12000 })
  await stage.getByRole('button', { name: /^Day 77/ }).click()
  await stage.getByRole('slider').press('End')
  await stage.getByRole('button', { name: 'Play sequence', exact: true }).click()
  await stage.getByRole('button', { name: 'Replay sequence' }).click()
  await expect(stage.getByRole('button', { name: /^Day 6/ })).toHaveAttribute('aria-current', 'step')
})

test.describe('short touch viewports', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 320, height: 420 } })

  test('the site menu leaves enough room for the tabletop and controls @pages', async ({ page }) => {
    const navbar = page.getByRole('navigation', { name: 'Main navigation' })
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
    await layers.tap()
    const dimensions = await page.locator('.layer-panel').evaluate(panel => ({
      top: panel.getBoundingClientRect().top,
      bottom: panel.getBoundingClientRect().bottom,
      toolbarBottom: document.querySelector('.run-status').getBoundingClientRect().bottom,
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
    await expect(back).toBeFocused()
    await expect(layers).toHaveAttribute('aria-expanded', 'true')
    await back.press('Escape')
    await expect(layers).toHaveAttribute('aria-expanded', 'false')
    await expect(layers).toBeFocused()
  })
})
