import { describe, expect, it } from 'vitest'

import { AiCompletionService } from '../AiCompletionService'
import { ToolRegistry } from '../tools/ToolRegistry'

describe('AiCompletionService', () => {
  const createService = () => new AiCompletionService(new ToolRegistry())

  it('should manage active requests', () => {
    const service = createService()
    const controller = new AbortController()

    service.registerRequest('req-1', controller)
    service.abort('req-1')

    expect(controller.signal.aborted).toBe(true)
  })

  it('should handle abort for non-existent request gracefully', () => {
    const service = createService()
    service.abort('non-existent')
  })

  it('should remove request after completion', () => {
    const service = createService()
    const controller = new AbortController()

    service.registerRequest('req-1', controller)
    service.removeRequest('req-1')
    service.abort('req-1')
    expect(controller.signal.aborted).toBe(false)
  })
})
