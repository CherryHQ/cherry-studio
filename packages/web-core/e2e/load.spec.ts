import type { Page, TestInfo } from '@playwright/test'

import { composerInput, gotoApp, send, setUpAssistant, test, useMockProvider } from './appPage'
import { expect } from './fixtures'

// Long sessions against the mock provider: memory must level off and replies must not slow down.
// Only Chromium measures the Worker's memory (`performance.measureUserAgentSpecificMemory`).
test.skip(({ browserName }) => browserName !== 'chromium', 'Only Chromium measures Worker memory')
// The headless shell lacks the memory API; the flag measures after a garbage collection at once.
test.use({ launch: { channel: 'chromium', args: ['--enable-blink-features=ForceEagerMeasureMemory'] } })

interface Sample {
  turn: number
  pageMb: number
  workersMb: number
  replyMs: number
}

const mb = (bytes: number) => Math.round((bytes / 2 ** 20) * 10) / 10
const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)

/** The memory of the page and of its Workers, in MB. */
async function measureMemory(page: Page): Promise<{ pageMb: number; workersMb: number }> {
  const { breakdown } = await page.evaluate(() =>
    (
      performance as unknown as {
        measureUserAgentSpecificMemory(): Promise<{ breakdown: { bytes: number; attribution: { scope: string }[] }[] }>
      }
    ).measureUserAgentSpecificMemory()
  )
  let pageBytes = 0
  let workerBytes = 0
  for (const { bytes, attribution } of breakdown) {
    if (attribution.some(({ scope }) => scope === 'DedicatedWorkerGlobalScope')) workerBytes += bytes
    else pageBytes += bytes
  }
  return { pageMb: mb(pageBytes), workersMb: mb(workerBytes) }
}

/**
 * Runs `turns` turns, measuring every `every` turns. Memory at the end must stay within 1.5 times
 * the first measurement, and the last ten replies must take at most twice as long as the first ten.
 */
async function runTurns(
  page: Page,
  testInfo: TestInfo,
  turns: number,
  every: number,
  turn: (n: number) => Promise<void>
) {
  const replyMs: number[] = []
  const samples: Sample[] = []
  for (let n = 1; n <= turns; n++) {
    const started = Date.now()
    await turn(n)
    replyMs.push(Date.now() - started)
    if (n % every === 0)
      samples.push({ turn: n, ...(await measureMemory(page)), replyMs: average(replyMs.slice(-every)) })
  }
  await testInfo.attach('samples', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' })
  console.log(`${testInfo.title}\n${JSON.stringify(samples)}`)

  const total = ({ pageMb, workersMb }: Sample) => pageMb + workersMb
  expect(total(samples.at(-1)!)).toBeLessThanOrEqual(total(samples[0]) * 1.5)
  expect(average(replyMs.slice(-10))).toBeLessThanOrEqual(average(replyMs.slice(0, 10)) * 2)
}

test('keeps memory and reply time level over 200 chat turns', async ({ page }, testInfo) => {
  test.setTimeout(30 * 60_000)
  const run = Date.now().toString(36)
  await gotoApp(page)
  await useMockProvider(page, run)
  await gotoApp(page)

  const messages = page.getByLabel('Messages')
  await runTurns(page, testInfo, 200, 50, async (n) => {
    await composerInput(page).click()
    await page.keyboard.type(`load ${n} ${run}`)
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(messages.getByText(`echo: load ${n} ${run}`, { exact: true })).toBeVisible()
  })
})

test('keeps memory and reply time level over 50 agent turns with file tools', async ({ page }, testInfo) => {
  test.setTimeout(30 * 60_000)
  const run = Date.now().toString(36)
  await gotoApp(page, 'Work')
  await setUpAssistant(page)
  await gotoApp(page, 'Work')

  await runTurns(page, testInfo, 50, 10, async (n) => {
    // Calls in one reply run together, so the read waits for the write's turn.
    const path = `load-${n}.txt`
    await send(page, `please call write ${JSON.stringify({ path, content: `turn ${n} ${run}` })}`)
    await page.getByRole('button', { name: /^Allow/ }).click()
    await expect(page.getByText(new RegExp(`^tools said: Successfully wrote .* to ${path}$`))).toBeVisible()
    await send(page, `please call read ${JSON.stringify({ path })}`)
    await expect(page.getByText(new RegExp(`^tools said:.*turn ${n} ${run}`))).toBeVisible()
  })
})
