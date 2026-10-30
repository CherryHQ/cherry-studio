import { rm } from 'node:fs/promises'

import { _electron as electron, type Locator } from '@playwright/test'

import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
      timeout: 60000
    })
    try {
      await use(electronApp)
    } finally {
      try {
        await electronApp.close()
      } finally {
        await rm(profile, { recursive: true, force: true })
      }
    }
  }
})

test('whole-assistant drags show one insertion line within the hovered group and reorder', async ({
  mainWindow
}, testInfo) => {
  test.setTimeout(120_000)
  const shell = mainWindow.locator('[data-ui~="app.shell"]')
  const onboarding = mainWindow.locator('[data-onboarding-language-select]')
  await expect(shell.or(onboarding).filter({ visible: true }).first()).toBeVisible({ timeout: 60000 })
  const previous = await mainWindow.evaluate(async () => ({
    language: await window.api.preference.get('app.language'),
    onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
    displayMode: await window.api.preference.get('topic.tab.display_mode'),
    sortType: await window.api.preference.get('assistant.tab.sort_type'),
    privacyVersion: await window.api.preference.get('app.privacy.policy_version')
  }))

  try {
    await mainWindow.evaluate(async (privacyVersion) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('topic.tab.display_mode', 'assistant')
      await window.api.preference.set('assistant.tab.sort_type', 'tags')
      await window.api.preference.set('app.privacy.policy_version', privacyVersion)
    }, LATEST_PRIVACY_POLICY_VERSION)
    await mainWindow.evaluate(async () => {
      const create = async (path: string, body: Record<string, string>) => {
        const response = await window.api.dataApi.request({ id: crypto.randomUUID(), method: 'POST', path, body })
        const entity = response.data as { id?: string } | undefined
        if (response.status !== 201 || typeof entity?.id !== 'string') {
          throw new Error(`Seed ${path} failed: ${JSON.stringify(response)}`)
        }
        return entity.id
      }
      const groupX = await create('/groups', { entityType: 'assistant', name: 'Group X' })
      const groupY = await create('/groups', { entityType: 'assistant', name: 'Group Y' })
      for (const letter of ['A', 'B', 'C', 'D']) {
        await create('/assistants', {
          name: `Assistant ${letter}`,
          groupId: letter === 'D' ? groupY : groupX
        })
      }
    })
    await mainWindow.reload()
    await expect(shell.first()).toBeVisible({ timeout: 60000 })
    const acceptPrivacy = mainWindow.getByRole('button', { name: 'Accept and Continue', exact: true })
    if (await acceptPrivacy.isVisible()) await acceptPrivacy.click()
    await selectSidebarApp(mainWindow, 'Chat')

    const list = mainWindow.locator('[data-ui~="chat.topic-list"]:visible')
    await expect(list).toHaveCount(1)
    const namedButton = (name: string) => list.getByRole('button', { name, exact: true }).and(list.locator('button'))
    const header = (letter: string) => namedButton(`Assistant ${letter}`)
    const sectionX = namedButton('Group X')
    const sectionY = namedButton('Group Y')
    await expect(sectionX).toBeVisible()
    await expect(sectionY).toBeVisible()
    await expect(sectionX).toHaveAttribute('aria-expanded', 'true')
    await expect(sectionY).toHaveAttribute('aria-expanded', 'true')
    for (const letter of ['A', 'B', 'C', 'D']) {
      await expect(header(letter)).toBeVisible()
    }
    const orderedHeaders = list
      .getByRole('button', { name: /^(Group [XY]|Assistant [ABCD])$/ })
      .and(list.locator('button'))
      .getByText(/^(Group [XY]|Assistant [ABCD])$/, { exact: true })
    const expectOrder = async (letters: string[]) => {
      await expect(orderedHeaders).toHaveText([
        'Group X',
        ...letters.map((letter) => `Assistant ${letter}`),
        'Group Y',
        'Assistant D'
      ])
    }
    const indicators = mainWindow.locator('[data-drop-indicator]')
    await expectOrder(['A', 'B', 'C'])
    await expect(indicators).toHaveCount(0)

    const dragTo = async (source: Locator, target: Locator) => {
      const sourceBox = await source.boundingBox()
      const targetBox = await target.boundingBox()
      if (!sourceBox || !targetBox) throw new Error('Drag headers must have visible bounding boxes')
      const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }
      const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 }
      await mainWindow.mouse.move(start.x, start.y)
      await mainWindow.mouse.down()
      await mainWindow.mouse.move(start.x + 10, start.y)
      for (let step = 1; step <= 15; step++) {
        await mainWindow.mouse.move(
          start.x + 10 + ((end.x - start.x - 10) * step) / 15,
          start.y + ((end.y - start.y) * step) / 15
        )
        // Give the pointer sensor and collision measurement a frame between real input events.
        await mainWindow.waitForTimeout(20)
      }
    }
    const expectLineBetween = async (above: Locator, below: Locator) => {
      const box = await indicators.boundingBox()
      const aboveBox = await above.boundingBox()
      const belowBox = await below.boundingBox()
      if (!box || !aboveBox || !belowBox) throw new Error('indicator and headers must be laid out')
      expect(box.y).toBeGreaterThan(aboveBox.y + aboveBox.height - 2)
      expect(box.y + box.height).toBeLessThan(belowBox.y + 2)
    }
    const screenshot = async (filename: string) => {
      const output = testInfo.outputPath(filename)
      await mainWindow.bringToFront()
      await mainWindow.waitForTimeout(250)
      await mainWindow.screenshot({ path: output })
      await testInfo.attach(filename, { path: output, contentType: 'image/png' })
    }

    try {
      await dragTo(header('A'), header('B'))
      await expect(indicators).toHaveCount(1)
      await expect(indicators).toHaveAttribute('data-drop-indicator', 'after')
      await expect(indicators).toBeVisible()
      await expectLineBetween(header('B'), header('C'))
      await screenshot('topic-list-inner-drag-after.png')
    } finally {
      await mainWindow.mouse.up()
    }
    await expect(indicators).toHaveCount(0)
    await expectOrder(['B', 'A', 'C'])

    try {
      await dragTo(header('C'), header('B'))
      await expect(indicators).toHaveCount(1)
      await expect(indicators).toHaveAttribute('data-drop-indicator', 'before')
      await expect(indicators).toBeVisible()
      await expectLineBetween(namedButton('Group X'), header('B'))
      await screenshot('topic-list-inner-drag-before.png')
    } finally {
      await mainWindow.mouse.up()
    }
    await expect(indicators).toHaveCount(0)
    await expectOrder(['C', 'B', 'A'])
  } finally {
    await mainWindow.evaluate(async (values) => {
      await window.api.preference.set('app.language', values.language)
      await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
      await window.api.preference.set('topic.tab.display_mode', values.displayMode)
      await window.api.preference.set('assistant.tab.sort_type', values.sortType)
      await window.api.preference.set('app.privacy.policy_version', values.privacyVersion)
    }, previous)
  }
})
