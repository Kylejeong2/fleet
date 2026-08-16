import { expect, test, type Page } from '@playwright/test'

const askFleet = async (page: Page, count = '6') => {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await page.getByLabel('Research question').fill(
    'Compare the strongest approaches to reliable browser agent infrastructure.',
  )
  await page.getByLabel('Number of agents').selectOption(count)
  await page.getByRole('button', { name: 'Launch fleet' }).click()
  await expect(page.getByRole('dialog', { name: 'Research fleet' })).toBeVisible()
}

test('offers stable agent-count presets with twelve selected by default', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
  expect((await page.request.get('/favicon.svg')).ok()).toBe(true)
  const agentCount = page.getByLabel('Number of agents')
  await expect(agentCount).toHaveValue('12')
  await expect(agentCount.locator('option')).toHaveText([
    '1 agent',
    '3 agents',
    '6 agents',
    '12 agents',
    '25 agents',
    '50 agents',
    '100 agents',
  ])
  await agentCount.selectOption('50')
  await expect(agentCount).toHaveValue('50')
})

test('runs research and exposes the real fleet trace', async ({ page }) => {
  await askFleet(page)
  const dialog = page.getByRole('dialog', { name: 'Research fleet' })
  await expect(
    page.getByRole('button', { name: 'Close research fleet' }),
  ).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true)
  await expect(dialog.getByRole('button', { name: /Frame scout/ })).toBeVisible()
  await dialog.getByRole('button', { name: /Frame scout/ }).click()
  await expect(dialog.getByText('Current objective')).toBeVisible()
  const search = dialog.getByRole('button', { name: /^Search/ }).first()
  await expect(search).toHaveAttribute('aria-expanded', 'false')
  await search.click()
  await expect(search).toHaveAttribute('aria-expanded', 'true')
  await expect(dialog.locator('.tool-event pre').first()).toContainText('https://example.com')
  await page.getByRole('button', { name: 'Close research fleet' }).click()
  await expect(page.getByRole('dialog', { name: 'Research fleet' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'View fleet' })).toBeFocused()
  await page.getByRole('button', { name: 'View fleet' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Research fleet' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'View fleet' })).toBeFocused()
  await expect(page.getByText('Research complete')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.answer-text')).toContainText('Fleet investigated')
})

test('keeps the mobile fleet inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await askFleet(page, '3')
  const overflow = await page.evaluate(() => ({
    document:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dialog:
      document.querySelector<HTMLElement>('.fleet-dialog')!.scrollWidth -
      window.innerWidth,
  }))
  expect(overflow.document).toBeLessThanOrEqual(0)
  expect(overflow.dialog).toBeLessThanOrEqual(0)
  await expect(page.getByRole('dialog', { name: 'Research fleet' })).toBeVisible()
})

test('animates active robot rigs with Motion', async ({ page }) => {
  await askFleet(page, '50')
  const rig = page.locator('.agent-card.running .bot-rig').first()
  await expect(rig).toBeVisible()
  const before = await rig.evaluate((element) => getComputedStyle(element).transform)
  await page.waitForTimeout(120)
  const after = await rig.evaluate((element) => getComputedStyle(element).transform)
  expect(after).not.toBe(before)
})

test('honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await askFleet(page, '3')
  const robot = page.locator('.bot').first()
  await expect(robot).toHaveAttribute('data-reduced-motion', 'true')
  const rig = robot.locator('.bot-rig')
  const before = await rig.evaluate((element) => getComputedStyle(element).transform)
  await page.waitForTimeout(250)
  const after = await rig.evaluate((element) => getComputedStyle(element).transform)
  expect(after).toBe(before)
})
