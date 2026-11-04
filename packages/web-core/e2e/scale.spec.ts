import { expect, reloadHarness, test } from './fixtures'

// Opt-in: seeding takes up to a minute per browser. Run with WEB_CORE_SCALE=1.
// 50k messages is far more than a trial account holds.
const SIZES = [50_000]
const TASK_BUDGET_MS = 1000

test.skip(!process.env.WEB_CORE_SCALE, 'scale measurements are opt-in (WEB_CORE_SCALE=1)')

async function median(sample: () => Promise<number>, runs = 5): Promise<number> {
  const times: number[] = []
  for (let i = 0; i < runs; i++) times.push(await sample())
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]
}

for (const size of SIZES) {
  test(`records boot and query timings at ${size} messages (AC8)`, async ({ page, account }) => {
    test.setTimeout(60 * 60_000)
    const cold = await page.evaluate((account) => harness.client.open(account), account)
    const seed = await page.evaluate(
      (count) => harness.client.send<{ ms: number; maxChunkMs: number }>('seedMessages', { count }),
      size
    )

    await reloadHarness(page)
    const warm = await page.evaluate((account) => harness.client.open(account, 10_000), account)
    const boot = await page.evaluate(() =>
      harness.client.send<{ foreignKeyCheckMs: number; customSqlMs: number }>('bootBreakdown')
    )

    const lastTopic = `seed-topic-${size / 100 - 1}`
    const listMs = await median(() =>
      page.evaluate(async (topicId) => {
        const started = performance.now()
        const response = await harness.client.request('GET', `/topics/${topicId}/messages`, { params: { limit: 50 } })
        if (response.status !== 200) throw new Error(JSON.stringify(response.error))
        return performance.now() - started
      }, lastTopic)
    )
    const searchMs = await median(() =>
      page.evaluate(async () => {
        const started = performance.now()
        await harness.client.send('searchMessages', { q: 'needle42' })
        return performance.now() - started
      })
    )
    const usageBytes = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0)

    const result = {
      size,
      coldMigrateMs: cold.migrateMs,
      seedMsPerMessage: seed.ms / size,
      seedMaxTaskMs: seed.maxChunkMs,
      warmOpenMs: warm.openMs,
      warmMigrateMs: warm.migrateMs,
      ...boot,
      listLatest50Ms: listMs,
      searchMs,
      // WebKit reports origin-independent figures here; only Chromium and Firefox are meaningful.
      usageMB: Math.round(usageBytes / 1e6)
    }
    console.log(JSON.stringify({ browser: test.info().project.name, ...result }))
    await test
      .info()
      .attach(`scale-${size}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' })

    expect.soft(cold.migrateMs, 'cold migration is one Worker task').toBeLessThan(TASK_BUDGET_MS)
    expect.soft(warm.migrateMs, 'warm boot migration check is one Worker task').toBeLessThan(TASK_BUDGET_MS)
  })
}
