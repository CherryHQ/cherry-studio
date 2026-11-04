import { expect, gotoHarness, test } from './fixtures'

test('a second tab cannot open or write the same account database (AC5)', async ({ context, page, account }) => {
  await page.evaluate((account) => harness.client.open(account), account)
  await page.evaluate(() => harness.client.send('seedMessages', { count: 10 }))

  const second = await context.newPage()
  await gotoHarness(second)
  const refusal = await second.evaluate(
    (account) =>
      harness.client.open(account, 500).then(
        () => 'opened',
        (error: Error) => error.name
      ),
    account
  )
  expect(refusal).toBe('DatabaseLockedError')

  const write = await second.evaluate(() =>
    harness.client
      .send('sql', {
        sql: "INSERT INTO topic (id, order_key, created_at, updated_at) VALUES ('x', 'x', 0, 0)",
        mode: 'run'
      })
      .then(
        () => 'written',
        (error: Error) => error.message
      )
  )
  expect(write).toContain('not open')

  // Once the first tab goes away the lock and file handles pass to the second.
  await page.close()
  await second.evaluate((account) => harness.client.open(account, 10_000), account)
  const [{ n }] = await second.evaluate(() =>
    harness.client.send<{ n: number }[]>('sql', { sql: "SELECT count(*) AS n FROM message WHERE role != 'root'" })
  )
  expect(n).toBe(10)
})
