import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scan = vi.hoisted(() => ({ collectErrorLogRecords: vi.fn(), diagnose: vi.fn() }))
vi.mock('@main/services/diagnostics/scan', () => scan)

const { recentLogFindings } = await import('../logs')
const signal = new AbortController().signal
const ctx = { signal, share: <T>(_key: string, factory: (signal: AbortSignal) => Promise<T>) => factory(signal) }

function finding(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: 'provider-auth-rejected',
    domain: 'provider',
    attribution: 'user-fixable',
    devMessage: 'Provider authentication failed',
    count: 1,
    firstSeenMs: 1,
    lastSeenMs: 2,
    evidence: [{ timestampMs: 2, excerpt: 'secret prompt text' }],
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
  scan.collectErrorLogRecords.mockResolvedValue({
    records: [{ timestampMs: 2_000_000_000_000, message: 'raw secret log record' }],
    unparsedLineCount: 0,
    skippedFileCount: 0,
    truncated: false
  })
  scan.diagnose.mockReturnValue([])
})

afterEach(() => vi.restoreAllMocks())

describe('logs-recent-findings', () => {
  it('filters the shared seven-day scan to the last 24 hours', async () => {
    const recent = { timestampMs: 2_000_000_000_000, message: 'recent' }
    scan.collectErrorLogRecords.mockResolvedValue({
      records: [recent, { timestampMs: 1_999_800_000_000, message: 'old' }],
      unparsedLineCount: 0,
      skippedFileCount: 0,
      truncated: false
    })
    await expect(recentLogFindings.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(scan.collectErrorLogRecords).toHaveBeenCalledWith(
      '/mock/app.logs',
      {
        fromMs: 1_999_395_200_000,
        toMs: 2_000_000_000_000
      },
      signal
    )
    expect(scan.diagnose).toHaveBeenCalledWith([recent])
  })

  it('aggregates app and user actions without copying log excerpts into evidence', async () => {
    scan.diagnose.mockReturnValue([
      finding({ ruleId: 'chat-tool-use-id-conflict', domain: 'chat', attribution: 'app-bug', count: 2 }),
      finding(),
      finding({ ruleId: 'mcp-connection-closed', domain: 'mcp' })
    ])
    const result = await recentLogFindings.run(ctx)

    expect(result).toMatchObject({
      status: 'warn',
      attribution: 'app-bug',
      detail: { variant: 'findings', params: { count: 3, occurrences: 4 } },
      actions: [
        { kind: 'report' },
        { kind: 'navigate', target: '/settings/provider' },
        { kind: 'navigate', target: '/settings/mcp' }
      ]
    })
    expect(JSON.stringify(result)).not.toContain('secret prompt text')
    expect(JSON.stringify(result)).not.toContain('raw secret log record')
  })

  it('keeps transient-only findings actionable as a warning without a misleading fix', async () => {
    scan.diagnose.mockReturnValue([
      finding({ ruleId: 'provider-rate-limited', attribution: 'transient', devMessage: 'Retry later' })
    ])
    await expect(recentLogFindings.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'transient',
      actions: []
    })
  })

  it.each([{ unparsedLineCount: 1 }, { skippedFileCount: 1 }, { truncated: true }])(
    'does not pass an incomplete scan: %j',
    async (partial) => {
      scan.collectErrorLogRecords.mockResolvedValue({
        records: [],
        unparsedLineCount: 0,
        skippedFileCount: 0,
        truncated: false,
        ...partial
      })
      await expect(recentLogFindings.run(ctx)).rejects.toThrow('incomplete')
      scan.diagnose.mockReturnValue([finding()])
      await expect(recentLogFindings.run(ctx)).resolves.toMatchObject({
        status: 'warn',
        devMessage: expect.stringContaining('Incomplete')
      })
    }
  )
})
