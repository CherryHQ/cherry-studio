import { describe, expect, it } from 'vitest'

import {
  OcrAsyncTaskResultSchema,
  OcrAsyncTaskStartResultSchema,
  OcrAsyncTaskStatusSchema
} from '../ocr/async'

describe('ocr async task schemas', () => {
  it('parses an OCR task start payload', () => {
    const result = OcrAsyncTaskStartResultSchema.parse({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'pending'
    })

    expect(result.taskId).toBe('job-1')
    expect(result.providerTaskId).toBe('paddle-1')
  })

  it('parses a completed OCR task result payload', () => {
    const result = OcrAsyncTaskResultSchema.parse({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'completed',
      progress: 100,
      result: {
        text: 'hello',
        pages: [{ text: 'hello' }]
      }
    })

    expect(result.result.text).toBe('hello')
  })

  it('rejects unknown status values', () => {
    expect(() =>
      OcrAsyncTaskStatusSchema.parse({
        taskId: 'job-1',
        providerTaskId: 'paddle-1',
        status: 'done',
        progress: 100
      })
    ).toThrow(/status/i)
  })
})
