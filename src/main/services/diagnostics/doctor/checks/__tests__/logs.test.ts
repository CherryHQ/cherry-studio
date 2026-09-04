import { application } from '@application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scan = vi.hoisted(() => ({ collectErrorLogRecords: vi.fn(), diagnose: vi.fn() }))
vi.mock('@main/services/diagnostics/scan', () => scan)

const { recentLogFindings } = await import('../logs')
const ctx = { signal: new AbortController().signal }

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
    records: [{ message: 'raw secret log record' }],
    unparsedLineCount: 2,
    skippedFileCount: 1,
    truncated: false
  })
  scan.diagnose.mockReturnValue([])
})

afterEach(() => vi.restoreAllMocks())

describe('logs-recent-findings', () => {
  it('scans the last 24 hours and passes when no rule matches', async () => {
    await expect(recentLogFindings.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(scan.collectErrorLogRecords).toHaveBeenCalledWith('/mock/app.logs', {
      fromMs: 1_999_913_600_000,
      toMs: 2_000_000_000_000
    })
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

  it('uses the centralized logs path', async () => {
    await recentLogFindings.run(ctx)
    expect(application.getPath).toHaveBeenCalledWith('app.logs')
  })
})
