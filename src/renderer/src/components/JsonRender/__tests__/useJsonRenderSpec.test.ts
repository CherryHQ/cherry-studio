import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useJsonRenderSpec } from '../hooks/useJsonRenderSpec'

describe('useJsonRenderSpec', () => {
  it('returns null spec for empty content', () => {
    const { result } = renderHook(() => useJsonRenderSpec('', false))
    expect(result.current.spec).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('parses direct JSON spec', async () => {
    const specJson = JSON.stringify({
      root: 'card-1',
      elements: {
        'card-1': {
          type: 'Card',
          props: { title: 'Hello' },
          children: []
        }
      }
    })
    const { result } = renderHook(() => useJsonRenderSpec(specJson, false))
    await waitFor(() => {
      expect(result.current.spec).not.toBeNull()
    })
    expect(result.current.spec?.root).toBe('card-1')
    expect(result.current.error).toBeNull()
  })

  it('returns error for invalid JSON', async () => {
    const { result } = renderHook(() => useJsonRenderSpec('not json at all', false))
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })
  })

  it('returns error for JSON missing root/elements', async () => {
    const { result } = renderHook(() => useJsonRenderSpec('{"foo": "bar"}', false))
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })
    expect(result.current.error).toContain('missing')
  })

  it('parses JSONL SpecStream format', async () => {
    const jsonl = [
      '{"op":"add","path":"/root","value":"card-1"}',
      '{"op":"add","path":"/elements/card-1","value":{"type":"Card","props":{"title":"Test"},"children":[]}}'
    ].join('\n')
    const { result } = renderHook(() => useJsonRenderSpec(jsonl, false))
    await waitFor(() => {
      expect(result.current.spec).not.toBeNull()
    })
    expect(result.current.spec?.root).toBe('card-1')
  })
})
