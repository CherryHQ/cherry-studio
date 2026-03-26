import { describe, expect, it } from 'vitest'

import { ProcessState } from '../types'

describe('ProcessState enum', () => {
  it('has the correct string value for Idle', () => {
    expect(ProcessState.Idle).toBe('idle')
  })

  it('has the correct string value for Running', () => {
    expect(ProcessState.Running).toBe('running')
  })

  it('has the correct string value for Stopping', () => {
    expect(ProcessState.Stopping).toBe('stopping')
  })

  it('has the correct string value for Stopped', () => {
    expect(ProcessState.Stopped).toBe('stopped')
  })

  it('has the correct string value for Crashed', () => {
    expect(ProcessState.Crashed).toBe('crashed')
  })

  it('has exactly five members', () => {
    const values = Object.values(ProcessState)
    expect(values).toHaveLength(5)
    expect(values).toEqual(['idle', 'running', 'stopping', 'stopped', 'crashed'])
  })
})
