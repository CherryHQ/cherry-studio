import { beforeEach, describe, expect, it, vi } from 'vitest'

const { services, events } = vi.hoisted(() => {
  const events: string[] = []
  const hold = (name: string) => ({
    dispose: vi.fn(() => {
      events.push(`release:${name}`)
    })
  })
  const participant = (name: string) => ({
    pause: vi.fn(() => {
      events.push(`pause:${name}`)
      return hold(name)
    }),
    drainInFlight: vi.fn(async () => {
      events.push(`drain:${name}`)
      return { stragglerIds: [] as string[] }
    })
  })
  return {
    events,
    services: {
      ChannelManager: {
        ...participant('channel-intake'),
        pauseAdapterRuntime: vi.fn(() => {
          events.push('pause:channel-runtime')
          return hold('channel-runtime')
        }),
        drainAdapterRuntimeInFlight: vi.fn(async () => {
          events.push('drain:channel-runtime')
          return { stragglerIds: [] as string[] }
        })
      },
      AiStreamManager: participant('ai'),
      AgentSessionRuntimeService: participant('agent'),
      JobManager: participant('job'),
      ClaudeCodeWarmQueryManager: participant('warm-query'),
      ProfileWriteBarrierService: participant('profile-write'),
      McpRuntimeService: participant('mcp')
    }
  }
})

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: keyof typeof services) => services[name])
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

import { BackupCancelledError } from '../errors'
import { captureSealedProfileView } from '../exportQuiesce'

describe('backup export quiesce transaction', () => {
  beforeEach(() => {
    events.length = 0
    vi.clearAllMocks()
    for (const service of Object.values(services)) {
      if ('drainInFlight' in service) {
        service.drainInFlight.mockImplementation(async () => {
          const name =
            service === services.ChannelManager
              ? 'channel-intake'
              : service === services.AiStreamManager
                ? 'ai'
                : service === services.AgentSessionRuntimeService
                  ? 'agent'
                  : service === services.JobManager
                    ? 'job'
                    : service === services.ClaudeCodeWarmQueryManager
                      ? 'warm-query'
                      : service === services.ProfileWriteBarrierService
                        ? 'profile-write'
                        : 'mcp'
          events.push(`drain:${name}`)
          return { stragglerIds: [] }
        })
      }
    }
    services.ChannelManager.drainAdapterRuntimeInFlight.mockImplementation(async () => {
      events.push('drain:channel-runtime')
      return { stragglerIds: [] }
    })
  })

  it('drains channel admission first and releases every hold in exact reverse order', async () => {
    await expect(
      captureSealedProfileView({
        createSnapshot: () => events.push('snapshot'),
        inspectSnapshot: () => {
          events.push('requirements')
          return ['resource']
        },
        captureBaseline: () => {
          events.push('baseline')
          return { bytes: 1 }
        }
      })
    ).resolves.toEqual({ snapshot: ['resource'], baseline: { bytes: 1 } })

    expect(events).toEqual([
      'pause:channel-intake',
      'drain:channel-intake',
      'pause:channel-runtime',
      'pause:ai',
      'pause:agent',
      'pause:job',
      'pause:warm-query',
      'drain:channel-runtime',
      'drain:ai',
      'drain:agent',
      'drain:job',
      'drain:warm-query',
      'pause:profile-write',
      'drain:profile-write',
      'pause:mcp',
      'drain:mcp',
      'snapshot',
      'requirements',
      'baseline',
      'release:mcp',
      'release:profile-write',
      'release:warm-query',
      'release:job',
      'release:agent',
      'release:ai',
      'release:channel-runtime',
      'release:channel-intake'
    ])
  })

  it('never closes AI admission when the channel flush did not reach admission', async () => {
    services.ChannelManager.drainInFlight.mockResolvedValueOnce({ stragglerIds: ['pending-batch'] })

    await expect(
      captureSealedProfileView({
        createSnapshot: vi.fn(),
        inspectSnapshot: vi.fn(),
        captureBaseline: vi.fn()
      })
    ).rejects.toMatchObject({
      phase: 'channel-intake',
      stragglerIds: ['channel-intake:pending-batch']
    })

    expect(events).toEqual(['pause:channel-intake', 'release:channel-intake'])
  })

  it('releases the complete stack when baseline capture fails', async () => {
    await expect(
      captureSealedProfileView({
        createSnapshot: () => events.push('snapshot'),
        inspectSnapshot: () => ['resource'],
        captureBaseline: () => {
          throw new Error('scan failed')
        }
      })
    ).rejects.toThrow('scan failed')

    expect(events.slice(-8)).toEqual([
      'release:mcp',
      'release:profile-write',
      'release:warm-query',
      'release:job',
      'release:agent',
      'release:ai',
      'release:channel-runtime',
      'release:channel-intake'
    ])
  })

  it('cancels immediately after the non-interruptible snapshot returns', async () => {
    const controller = new AbortController()

    await expect(
      captureSealedProfileView({
        signal: controller.signal,
        createSnapshot: () => controller.abort(),
        inspectSnapshot: vi.fn(),
        captureBaseline: vi.fn()
      })
    ).rejects.toBeInstanceOf(BackupCancelledError)

    expect(events.slice(-1)).toEqual(['release:channel-intake'])
    expect(events).toContain('release:mcp')
  })

  it('times out a stuck participant under the shared monotonic deadline', async () => {
    services.ChannelManager.drainInFlight.mockImplementationOnce(() => new Promise(() => {}))

    await expect(
      captureSealedProfileView({
        timeoutMs: 10,
        createSnapshot: vi.fn(),
        inspectSnapshot: vi.fn(),
        captureBaseline: vi.fn()
      })
    ).rejects.toMatchObject({ phase: 'channel-intake' })

    expect(events).toEqual(['pause:channel-intake', 'release:channel-intake'])
  })
})
