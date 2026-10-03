import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useDebouncedAutoSave } from '../EditDialogShared'

describe('useDebouncedAutoSave', () => {
  it('flushes the latest form after an active save and waits for both writes', async () => {
    const firstWrite = Promise.withResolvers<void>()
    const latestWrite = Promise.withResolvers<void>()
    const latestStarted = Promise.withResolvers<void>()
    const started: string[] = []
    const persisted: string[] = []
    const { result, rerender } = renderHook(
      ({ changeKey }) =>
        useDebouncedAutoSave({
          enabled: false,
          changeKey,
          onSave: async () => {
            started.push(changeKey)
            if (changeKey === 'first') await firstWrite.promise
            else {
              latestStarted.resolve()
              await latestWrite.promise
            }
            persisted.push(changeKey)
          }
        }),
      { initialProps: { changeKey: 'first' } }
    )

    const firstFlush = result.current()
    rerender({ changeKey: 'intermediate' })
    const closingFlush = result.current()
    rerender({ changeKey: 'latest' })
    let closed = false
    void closingFlush.then(() => {
      closed = true
    })

    expect(started).toEqual(['first'])
    await act(async () => {
      firstWrite.resolve()
      await latestStarted.promise
    })
    expect(started).toEqual(['first', 'latest'])
    expect(persisted).toEqual(['first'])
    expect(closed).toBe(false)

    await act(async () => {
      latestWrite.resolve()
      await Promise.all([firstFlush, closingFlush])
    })
    expect(persisted).toEqual(['first', 'latest'])
    expect(closed).toBe(true)
  })

  it('does not repeat an in-flight save when the form has not changed', async () => {
    const write = Promise.withResolvers<void>()
    const persisted: string[] = []
    const { result } = renderHook(() =>
      useDebouncedAutoSave({
        enabled: false,
        changeKey: 'draft',
        onSave: async () => {
          await write.promise
          persisted.push('draft')
        }
      })
    )

    const firstFlush = result.current()
    const closingFlush = result.current()
    await act(async () => {
      write.resolve()
      await Promise.all([firstFlush, closingFlush])
    })
    expect(persisted).toEqual(['draft'])
  })

  it('rejects a failed drain without saving its successor until explicitly retried', async () => {
    const firstWrite = Promise.withResolvers<void>()
    const failure = new Error('Cannot persist the form')
    const persisted: string[] = []
    const { result, rerender } = renderHook(
      ({ changeKey }) =>
        useDebouncedAutoSave({
          enabled: false,
          changeKey,
          onSave: async () => {
            if (changeKey === 'first') await firstWrite.promise
            persisted.push(changeKey)
          }
        }),
      { initialProps: { changeKey: 'first' } }
    )

    const firstFlush = result.current()
    rerender({ changeKey: 'latest' })
    const closingFlush = result.current()
    const firstFailure = expect(firstFlush).rejects.toBe(failure)
    const closingFailure = expect(closingFlush).rejects.toBe(failure)
    await act(async () => {
      firstWrite.reject(failure)
      await Promise.all([firstFailure, closingFailure])
    })
    expect(persisted).toEqual([])

    await act(async () => {
      await result.current()
    })
    expect(persisted).toEqual(['latest'])
  })
})
