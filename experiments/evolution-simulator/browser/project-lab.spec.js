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
    await expect(back).toBeInViewport()
    await back.tap()
    await expect(layers).toHaveAttribute('aria-expanded', 'true')
  })
})
