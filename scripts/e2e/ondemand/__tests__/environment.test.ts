import type { Page } from '@playwright/test'

import { ensureChinese, verifyTimezone } from '../environment'

// Catch unrelated timezone drift being mislabeled as a product assertion failure.
it('records timezone differences without enforcing an undeclared dependency', () => {
  expect(() => verifyTimezone(undefined, null, 'Etc/UTC')).not.toThrow()
  expect(() => verifyTimezone('Asia/Shanghai', 'UTC', 'Asia/Shanghai')).toThrow(
    expect.objectContaining({ exitCode: 2, code: 'TIMEZONE_MISMATCH' })
  )
  expect(() => verifyTimezone('Asia/Shanghai', null, 'Asia/Shanghai')).toThrow()
  expect(() => verifyTimezone('Asia/Shanghai', 'Asia/Shanghai', 'Asia/Shanghai')).not.toThrow()
})

it('classifies a wrong app preference as environment failure even if HTML claims Chinese', async () => {
  const page = {
    evaluate: async () => 'en-US',
    isClosed: () => false,
    context: () => ({ browser: () => ({ isConnected: () => true }) })
  } as unknown as Page
  await expect(ensureChinese(page)).rejects.toMatchObject({
    stage: 'environment',
    exitCode: 2,
    code: 'LOCALE_MISMATCH'
  })
})
