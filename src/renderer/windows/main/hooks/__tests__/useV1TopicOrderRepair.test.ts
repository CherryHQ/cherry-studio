import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: requestMock }
}))

import { readV1AssistantsTopicSource, requestV1TopicOrderRepair, useV1TopicOrderRepair } from '../useV1TopicOrderRepair'

describe('readV1AssistantsTopicSource', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns {} when persist is absent', () => {
    expect(readV1AssistantsTopicSource()).toEqual({})
  })

  it('extracts Redux [C,A,B] from a stringified persist slice', () => {
    localStorage.setItem(
      'persist:cherry-studio',
      JSON.stringify({
        assistants: JSON.stringify({
          assistants: [
            {
              topics: [{ id: 't-c', pinned: true }, { id: 't-a' }, { id: 't-b', pinned: false }]
            }
          ],
          defaultAssistant: { topics: [{ id: 't-c', pinned: false }] }
        })
      })
    )

    expect(readV1AssistantsTopicSource()).toEqual({
      assistants: [
        {
          topics: [{ id: 't-c', pinned: true }, { id: 't-a' }, { id: 't-b', pinned: false }]
        }
      ],
      defaultAssistant: { topics: [{ id: 't-c', pinned: false }] }
    })
  })

  it('returns null when persist JSON is invalid', () => {
    localStorage.setItem('persist:cherry-studio', '{')
    expect(readV1AssistantsTopicSource()).toBeNull()
  })
})

describe('requestV1TopicOrderRepair', () => {
  beforeEach(() => {
    localStorage.clear()
    requestMock.mockReset()
    requestMock.mockResolvedValue({ applied: false, reason: 'no_source' })
  })

  it('does not call IPC when persist cannot be parsed', async () => {
    localStorage.setItem('persist:cherry-studio', '{')
    await requestV1TopicOrderRepair()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('sends the parsed Redux topic sequence', async () => {
    localStorage.setItem(
      'persist:cherry-studio',
      JSON.stringify({
        assistants: JSON.stringify({
          assistants: [
            {
              topics: [{ id: 't-c', pinned: true }, { id: 't-a' }, { id: 't-b', pinned: false }]
            }
          ]
        })
      })
    )

    await requestV1TopicOrderRepair()

    expect(requestMock).toHaveBeenCalledExactlyOnceWith('app.migration_v2.repair_topic_order', {
      assistants: [
        {
          topics: [{ id: 't-c', pinned: true }, { id: 't-a' }, { id: 't-b', pinned: false }]
        }
      ]
    })
  })
})

describe('useV1TopicOrderRepair', () => {
  beforeEach(() => {
    localStorage.clear()
    requestMock.mockReset()
    requestMock.mockResolvedValue({ applied: true, reason: 'repaired' })
  })

  it('requests repair once on mount', async () => {
    const { unmount } = renderHook(() => useV1TopicOrderRepair())
    await act(async () => {
      await Promise.resolve()
    })
    expect(requestMock).toHaveBeenCalledTimes(1)
    unmount()
  })
})
