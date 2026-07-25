import { describe, expect, it } from 'vitest'

import { isRuntimeDependency, RUNTIME_INTERPRETERS } from '../binaryTools'

describe('isRuntimeDependency', () => {
  it('recognizes every registered interpreter, bare or with core:/@version', () => {
    for (const runtime of RUNTIME_INTERPRETERS) {
      expect(isRuntimeDependency(runtime)).toBe(true)
      expect(isRuntimeDependency(`core:${runtime}`)).toBe(true)
      expect(isRuntimeDependency(`${runtime}@1.2.3`)).toBe(true)
    }
  })

  it('rejects package-backend and unrelated specs', () => {
    expect(isRuntimeDependency('npm:ntn')).toBe(false)
    expect(isRuntimeDependency('pipx:something')).toBe(false)
    expect(isRuntimeDependency('gh')).toBe(false)
    expect(isRuntimeDependency('ruby')).toBe(false)
  })
})
