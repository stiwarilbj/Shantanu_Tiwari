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
})
