import { expect, reloadHarness, test } from './fixtures'

const ROWS = 60_000
const KILLS = 10

const countMessages = () =>
  harness.client
    .send<{ n: number }[]>('sql', { sql: "SELECT count(*) AS n FROM message WHERE role != 'root'" })
    .then(([row]) => row.n)

test('a Worker killed mid-transaction leaves an intact, all-or-nothing database (AC4)', async ({ page, account }) => {
  test.setTimeout(15 * 60_000)
  await page.evaluate((account) => harness.client.open(account, 10_000), account)

  // Calibrate: how long the 60k-row transaction runs in this browser.
  const { ms: transactionMs } = await page.evaluate(
    (count) =>
      harness.client.send<{ ms: number }>('seedMessages', { count, singleTransaction: true, prefix: 'calibration' }),
    ROWS
  )

  const runs: { delayMs: number; before: number; after: number; integrity: unknown }[] = []
  for (let kill = 1; kill <= KILLS; kill++) {
    const delayMs = Math.round((transactionMs * kill) / (KILLS + 1))
    const before = await page.evaluate(countMessages)
    await page.evaluate(
      ({ count, prefix }) => {
        void harness.client.send('seedMessages', { count, singleTransaction: true, prefix })
      },
      { count: ROWS, prefix: `kill${kill}` }
    )
    await page.waitForTimeout(delayMs)
    await reloadHarness(page)

    await page.evaluate((account) => harness.client.open(account, 10_000), account)
    const after = await page.evaluate(countMessages)
    const integrity = await page.evaluate(() => harness.client.send('integrity'))
    runs.push({ delayMs, before, after, integrity })
  }

  await test
    .info()
    .attach('kills.json', { body: JSON.stringify({ transactionMs, runs }, null, 2), contentType: 'application/json' })
  for (const run of runs) {
    expect(run.integrity).toEqual({ integrity: 'ok', foreignKeyViolations: 0 })
    expect([run.before, run.before + ROWS]).toContain(run.after)
  }
})
