import { rm } from 'node:fs/promises'

import { _electron as electron, type Locator, type Page } from '@playwright/test'

import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, runElectronApp, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot },
      timeout: 60000
    })
    try {
      await runElectronApp(electronApp)
    } finally {
      await electronApp.close()
      await rm(profileRoot, { recursive: true, force: true, maxRetries: 3 })
    }
  }
})

test.setTimeout(180_000)

const CHAIN_LENGTH = 60
const SIDE_BRANCH_LENGTH = 8

async function readViewport(flow: Locator) {
  return flow.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    return { zoom: matrix.a, x: matrix.e, y: matrix.f }
  })
}

async function expectActiveCentered(page: Page, flow: Locator, activeId: string) {
  await page.mouse.move(2, 2)
  await expect(flow.locator(`[data-active="true"][data-message-id="${activeId}"]`)).toBeVisible()
  const activeNode = flow.locator(`.react-flow__node[data-id="${activeId}"]`)
  await expect
    .poll(async () => {
      const canvas = await flow.boundingBox()
      const node = await activeNode.boundingBox()
      if (!canvas || !node) return false
      const viewport = await readViewport(flow)
      return (
        node.width > 0 &&
        node.height > 0 &&
        node.x >= canvas.x - 2 &&
        node.y >= canvas.y - 2 &&
        node.x + node.width <= canvas.x + canvas.width + 2 &&
        node.y + node.height <= canvas.y + canvas.height + 2 &&
        Math.abs(node.x + node.width / 2 - canvas.x - canvas.width / 2) <= 2 &&
        Math.abs(node.y + node.height / 2 - canvas.y - canvas.height / 2) <= 2 &&
        Math.abs(viewport.zoom - 0.85) <= 1e-6
      )
    })
    .toBe(true)
}

async function moveToBlankPane(page: Page, flow: Locator) {
  await page.mouse.move(2, 2)
  const point = await flow.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const overlays = [
      ...element.querySelectorAll(
        '.react-flow__minimap, .react-flow__controls, [data-testid="topic-message-flow-legend"]'
      )
    ].map((overlay) => overlay.getBoundingClientRect())
    for (const yFraction of [0.25, 0.5, 0.75]) {
      for (const xFraction of [0.15, 0.85, 0.35, 0.65]) {
        const x = box.left + box.width * xFraction
        const y = box.top + box.height * yFraction
        if (overlays.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) continue
        const hit = document.elementFromPoint(x, y)
        if (hit?.classList.contains('react-flow__pane') && element.contains(hit)) return { x, y }
      }
    }
    throw new Error('No unobstructed React Flow pane point found')
  })
  await page.mouse.move(point.x, point.y)
  await expect
    .poll(() =>
      page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane') ?? false,
        point
      )
    )
    .toBe(true)
}

async function seedBranchFlow(page: Page) {
  return page.evaluate(
    async ({ chainLength, sideBranchLength }) => {
      const api = (window as any).api
      const req = async (id: string, method: string, p: string, body?: unknown) => {
        const result = await api.dataApi.request({ id, method, path: p, body })
        if (result && result.ok === false) throw new Error(`${method} ${p}: ${JSON.stringify(result.error)}`)
        return result?.data ?? result
      }
      const assistant = await req('p-assistant', 'POST', '/assistants', { name: `probe-assistant-${Date.now()}` })
      const topic = await req('p-topic', 'POST', '/topics', {
        name: `probe-branch-${Date.now()}`,
        assistantId: assistant.id
      })
      const makeMessage = async (index: number, parentId: string | null, role: 'user' | 'assistant', text: string) =>
        req(`p-msg-${index}-${role}-${parentId ?? 'root'}`, 'POST', `/topics/${topic.id}/messages`, {
          parentId,
          role,
          status: 'success',
          data: { parts: [{ type: 'text', text }] }
        })

      let parentId: string | null = null
      const chain: string[] = []
      for (let i = 0; i < chainLength; i += 1) {
        const role = i % 2 === 0 ? 'user' : 'assistant'
        const message = await makeMessage(i, parentId, role, `CHAIN_${i}_${role}`)
        chain.push(message.id)
        parentId = message.id
      }

      let shortBranchId = ''
      let sideIndex = 0
      for (const fork of [10, 30]) {
        let sideParent: string | null = chain[fork]
        for (let j = 0; j < sideBranchLength; j += 1) {
          const role = j % 2 === 0 ? 'user' : 'assistant'
          const message = await req(`p-side-${sideIndex}`, 'POST', `/topics/${topic.id}/messages`, {
            parentId: sideParent,
            role,
            status: 'success',
            setAsActive: false,
            data: { parts: [{ type: 'text', text: `SIDE_${fork}_${j}` }] }
          })
          sideParent = message.id
          sideIndex += 1
        }
        if (fork === 10) shortBranchId = sideParent!
      }

      const activeId = chain[chain.length - 1]
      await req('p-active', 'PUT', `/topics/${topic.id}/active-node`, { nodeId: activeId })
      const tree = await req('p-tree', 'GET', `/topics/${topic.id}/tree`)
      return {
        topicId: topic.id,
        activeId,
        shortBranchId,
        nodeCount: tree.nodes.length,
        activeNodeId: tree.activeNodeId
      }
    },
    { chainLength: CHAIN_LENGTH, sideBranchLength: SIDE_BRANCH_LENGTH }
  )
}

test('branch flow locates the current node and supports scroll panning with pinch zoom', async ({
  mainWindow: page
}, testInfo) => {
  await page.evaluate(async (privacyVersion) => {
    const api = window.api
    await api.preference.set('app.language', 'en-US')
    await api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await api.preference.set('app.privacy.policy_version', privacyVersion)
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await selectSidebarApp(page, 'Chat')

  const seeded = await seedBranchFlow(page)

  expect(seeded.nodeCount).toBeGreaterThan(70)
  expect(seeded.activeNodeId).toBe(seeded.activeId)
  await page.evaluate(async (topicId: string) => {
    await window.api.ipcApi.request('navigation.open_route_in_main', { path: `/app/chat?topicId=${topicId}` })
  }, seeded.topicId)

  const branchButton = page.getByRole('button', { name: 'Branch Management', exact: true }).first()
  await branchButton.click()
  const flow = page.locator('.react-flow:visible').first()
  await expect(flow).toBeVisible()

  const screenshot = async (name: string) => {
    await page.mouse.move(2, 2)
    const screenshotPath = testInfo.outputPath(`${name}.png`)
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
  }

  await expectActiveCentered(page, flow, seeded.activeId)
  await screenshot('01-initial-centered')

  await moveToBlankPane(page, flow)
  const beforeVertical = await readViewport(flow)
  await page.mouse.wheel(0, 240)
  await page.mouse.move(2, 2)
  await expect
    .poll(async () => {
      const after = await readViewport(flow)
      return Math.abs(after.y - beforeVertical.y) >= 1 && Math.abs(after.zoom - beforeVertical.zoom) <= 1e-6
    })
    .toBe(true)

  await moveToBlankPane(page, flow)
  const beforeHorizontal = await readViewport(flow)
  await page.mouse.wheel(240, 0)
  await page.mouse.move(2, 2)
  await expect
    .poll(async () => {
      const after = await readViewport(flow)
      return Math.abs(after.x - beforeHorizontal.x) >= 1 && Math.abs(after.zoom - beforeHorizontal.zoom) <= 1e-6
    })
    .toBe(true)
  await screenshot('02-scroll-panned')

  await moveToBlankPane(page, flow)
  const beforePinch = await readViewport(flow)
  await page.keyboard.down('Control')
  try {
    await page.mouse.wheel(0, 240)
  } finally {
    await page.keyboard.up('Control')
  }
  await page.mouse.move(2, 2)
  await expect.poll(async () => Math.abs((await readViewport(flow)).zoom - beforePinch.zoom)).toBeGreaterThan(1e-6)
  await screenshot('03-pinch-zoomed')

  await moveToBlankPane(page, flow)
  const beforeClosingPan = await readViewport(flow)
  await page.mouse.wheel(0, 480)
  await page.mouse.move(2, 2)
  await expect.poll(async () => Math.abs((await readViewport(flow)).y - beforeClosingPan.y)).toBeGreaterThanOrEqual(1)
  await page.getByRole('button', { name: 'Close sidebar', exact: true }).click()
  await expect(flow).toHaveCount(0)
  await branchButton.click()
  await expectActiveCentered(page, flow, seeded.activeId)
  await screenshot('04-reopened-centered')
})

test('branch flow centers the shorter branch selected while the pane is hidden', async ({
  mainWindow: page
}, testInfo) => {
  await page.evaluate(async (privacyVersion) => {
    await window.api.preference.set('app.language', 'en-US')
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.privacy.policy_version', privacyVersion)
    await window.api.preference.set('app.developer_mode.enabled', true)
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await selectSidebarApp(page, 'Chat')
  const seeded = await seedBranchFlow(page)
  await page.evaluate(async (topicId: string) => {
    await window.api.ipcApi.request('navigation.open_route_in_main', { path: `/app/chat?topicId=${topicId}` })
  }, seeded.topicId)

  const branchButton = page.getByRole('button', { name: 'Branch Management', exact: true }).first()
  await branchButton.click()
  const flow = page.locator('.react-flow:visible').first()
  await expectActiveCentered(page, flow, seeded.activeId)

  await page.getByRole('button', { name: 'Call Chain', exact: true }).first().click()
  await expect(flow).toHaveCount(0)
  await page.evaluate(async ({ topicId, shortBranchId }) => {
    const api = (window as any).api
    const req = async (id: string, method: string, p: string, body?: unknown) => {
      const result = await api.dataApi.request({ id, method, path: p, body })
      if (result && result.ok === false) throw new Error(`${method} ${p}: ${JSON.stringify(result.error)}`)
      return result?.data ?? result
    }
    await req('p-hidden-active', 'PUT', `/topics/${topicId}/active-node`, { nodeId: shortBranchId })
  }, seeded)

  await branchButton.click()
  await expectActiveCentered(page, flow, seeded.shortBranchId)
  const screenshotPath = testInfo.outputPath('hidden-branch-reopened-centered.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('hidden-branch-reopened-centered', { path: screenshotPath, contentType: 'image/png' })
})
