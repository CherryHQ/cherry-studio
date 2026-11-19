import { expect, it } from 'vitest'

import { aiRequestSchemas } from '../ai'

it('preserves explicit tool suppression for one-shot background predictions and rejects invalid flags', () => {
  const schema = aiRequestSchemas['ai.text.generate'].input
  const request = { uniqueModelId: 'openai::test', prompt: 'Predict the next question.', disableTools: true }
  expect(schema.parse(request)).toMatchObject({ disableTools: true })
  expect(schema.safeParse({ ...request, disableTools: 'true' }).success).toBe(false)
})
