import { render } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlusButton } from '../PlusButton'

const mocks = vi.hoisted(() => ({
  plugin: { key: 'plusButton' },
  unbind: vi.fn()
}))

vi.mock('../../plugins/plusButtonPlugin', () => ({
  defaultComputePositionConfig: {},
  plusButtonPluginDefaultKey: 'plusButton',
  PlusButtonPlugin: vi.fn(() => ({
    plugin: mocks.plugin,
    unbind: mocks.unbind
  }))
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('PlusButton', () => {
  it('does not unregister the plugin after the editor is already destroyed', () => {
    const editor = {
      isDestroyed: false,
      registerPlugin: vi.fn(),
      unregisterPlugin: vi.fn()
    } as unknown as Editor

    const { unmount } = render(
      <PlusButton editor={editor}>
        <span />
      </PlusButton>
    )

    expect(editor.registerPlugin).toHaveBeenCalledWith(mocks.plugin)

    ;(editor as unknown as { isDestroyed: boolean }).isDestroyed = true
    unmount()

    expect(editor.unregisterPlugin).not.toHaveBeenCalled()
    expect(mocks.unbind).toHaveBeenCalledTimes(1)
  })
})
