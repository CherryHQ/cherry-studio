import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTimer } from '../useTimer'

describe('useTimer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each(['setTimeoutTimer', 'setIntervalTimer'] as const)(
    '%s keeps the replacement running after the old cleanup',
    (schedule) => {
      const { result } = renderHook(useTimer)
      const first = vi.fn()
      const replacement = vi.fn()
      const cleanupFirst = result.current[schedule]('same-key', first, 100)
      const cleanupReplacement = result.current[schedule]('same-key', replacement, 100)

      cleanupFirst()
      vi.advanceTimersByTime(100)

      expect(first).not.toHaveBeenCalled()
      expect(replacement).toHaveBeenCalledOnce()

      cleanupReplacement()
      result.current[schedule]('same-key', first, 100)
      result.current[schedule === 'setTimeoutTimer' ? 'clearTimeoutTimer' : 'clearIntervalTimer']('same-key')
      vi.advanceTimersByTime(200)

      expect(first).not.toHaveBeenCalled()
      expect(replacement).toHaveBeenCalledOnce()
    }
  )
})
