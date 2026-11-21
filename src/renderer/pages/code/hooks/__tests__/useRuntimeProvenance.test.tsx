import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CodeCli } from '@shared/types/codeCli'
import type { RuntimeProvenance } from '@shared/types/runtimeProvenance'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))

import { useRuntimeProvenance } from '../useRuntimeProvenance'

const hermes: RuntimeProvenance = {
  tool: 'hermes',
  binarySource: 'system',
  configHome: '/hermes',
  executablePath: '/bin/hermes',
  pluginRoots: ['/hermes/plugins'],
  reloadRequirement: 'restart_session'
}
const dsh: RuntimeProvenance = {
  tool: 'dsh',
  binarySource: 'system',
  configHome: '/dsh',
  executablePath: '/bin/dsh',
  pluginRoots: null,
  reloadRequirement: 'runtime_dependent'
}

describe('useRuntimeProvenance', () => {
  it('does not expose the previous tool while the selected tool is loading', async () => {
    let resolveDsh!: (value: RuntimeProvenance) => void
    mocks.request.mockResolvedValueOnce(hermes).mockReturnValueOnce(
      new Promise<RuntimeProvenance>((resolve) => {
        resolveDsh = resolve
      })
    )
    const { result, rerender } = renderHook(({ tool }) => useRuntimeProvenance(tool, '1'), {
      initialProps: { tool: CodeCli.HERMES as CodeCli }
    })
    await waitFor(() => expect(result.current).toEqual(hermes))
    rerender({ tool: CodeCli.DEEPSEEK_HARNESS })
    expect(result.current).toBeUndefined()
    await act(async () => resolveDsh(dsh))
    expect(result.current).toEqual(dsh)
    rerender({ tool: CodeCli.CLAUDE_CODE })
    expect(result.current).toBeUndefined()
  })
})
