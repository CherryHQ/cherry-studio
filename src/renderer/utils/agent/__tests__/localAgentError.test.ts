import { describe, expect, it } from 'vitest'

import { classifyLocalAgentError } from '../localAgentError'

describe('classifyLocalAgentError', () => {
  it.each([
    ['authentication', new Error('IpcError: Authentication required'), 'Authentication required'],
    ['authentication', new Error('IpcError: Not authenticated'), 'Not authenticated'],
    ['authentication', new Error('IpcError: Login required'), 'Login required'],
    ['region', 'IpcError: Error: Not available in your location', 'Not available in your location'],
    ['region', 'IpcError: Error: Not currently available in your region', 'Not currently available in your region'],
    ['region', 'IpcError: Error: Unsupported location', 'Unsupported location'],
    ['region', 'IpcError: Error: Unsupported region', 'Unsupported region'],
    ['timeout', new Error('Authentication timed out after 30s'), 'Authentication timed out after 30s'],
    ['unknown', 'Error: IpcError: Process exited: Error: missing config', 'Process exited: Error: missing config']
  ])('classifies %s and preserves diagnostic detail: %s', (kind, input, message) => {
    expect(classifyLocalAgentError(input)).toEqual({ kind, message })
  })
})
