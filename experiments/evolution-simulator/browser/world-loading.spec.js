import { expect, test } from '@playwright/test'

const worldModule = /\/World-[^/]+\.js$/
const boardModules = /\/(?:World|Board|three-core|three-renderer)-[^/]+\.js$/

for (const [route, label] of [['stats', 'Trends'], ['about', 'About']]) {
  test(`a direct ${label} link downloads and mounts World on its first visit`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('evolution.tour', 'seen'))
    const downloads = []
    page.on('request', request => {
      const { pathname } = new URL(request.url())
      if (boardModules.test(pathname)) downloads.push(pathname)
    })
    await page.goto(`./#/r/new/s/1/${route}`)
    const content = route === 'stats' ? page.getByRole('button', { name: 'Generation table' }) :
      page.getByRole('heading', { name: 'Evolution Simulator', exact: true })
    await expect(content).toBeVisible()
    await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page')
    const board = page.locator('.world canvas')
    await expect(board).toHaveCount(0)
    expect(downloads).toEqual([])

    let releaseWorld
    const holdWorld = new Promise(resolve => { releaseWorld = resolve })
    await page.route(worldModule, async requestRoute => {
      await holdWorld
      await requestRoute.continue()
    })
    try {
      const entry = page.getByRole('link', { name: 'World', exact: true })
      await Promise.all([page.waitForRequest(worldModule), entry.click()])
      await expect(content).toBeVisible()
      await expect(board).toHaveCount(0)
    } finally {
      releaseWorld()
    }
    await expect(board).toBeVisible()
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
    expect(downloads.filter(pathname => worldModule.test(pathname))).toHaveLength(1)
  })
}
