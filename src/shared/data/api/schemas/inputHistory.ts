import * as z from 'zod'

import type { InputHistory } from '../../types/inputHistory'

export const INPUT_HISTORY_DEFAULT_LIMIT = 20

export const SaveInputHistorySchema = z.strictObject({
  content: z.string().trim().min(1)
})

export type SaveInputHistoryDto = z.infer<typeof SaveInputHistorySchema>

export type InputHistorySchemas = {
  '/input-history': {
    GET: {
      response: InputHistory[]
    }
    POST: {
      body: SaveInputHistoryDto
      response: InputHistory
    }
  }
}
