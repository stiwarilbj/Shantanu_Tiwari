import { expect, test } from '@playwright/test'

test.skip(!process.env.PAGES_URL, 'Requires the Project Lab Pages build')

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('evolution.tour', 'seen'))
  await page.goto('')
  await expect(page.getByRole('button', { name: 'Simulation Settings' })).toBeEnabled()
})

test('the keyboard skip link clears the shared navbar and the project links back to Experiments @pages', async ({ page }) => {
  await expect(page).toHaveTitle('Evolution Simulator | Project Lab')
  await expect(page.getByRole('heading', { name: 'Evolution Simulator', exact: true })).toBeVisible()

  const breadcrumb = page.locator('.project-lab-heading').getByRole('link', { name: 'Experiments' })
  const skipLink = page.getByRole('link', { name: 'Skip to content' })
  await breadcrumb.focus()
  await page.keyboard.press('Tab')
  await expect(skipLink).toBeFocused()
  expect(await skipLink.evaluate(link => {
    const rect = link.getBoundingClientRect()
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === link
  })).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-surface')).toBeFocused()

  await breadcrumb.click()
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
    expect(layout.tabletopTop).toBeGreaterThan(layout.panelBottom)
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
