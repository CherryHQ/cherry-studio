// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { CLAIM_DOCUMENT_FOCUS_SCRIPT, claimDocumentFocus, releaseDocumentFocus } from '../webviewDocumentFocus'

describe('webviewDocumentFocus', () => {
  it('clears a host selection so IME cannot keep anchoring to the host page', () => {
    const marker = document.createElement('p')
    marker.textContent = 'chrome'
    document.body.append(marker)
    const range = document.createRange()
    range.selectNodeContents(marker)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(selection?.rangeCount).toBe(1)

    releaseDocumentFocus()

    expect(window.getSelection()?.rangeCount ?? 0).toBe(0)
    marker.remove()
  })

  it('restores an input caret after the focus probe so the next composition has a real rect', () => {
    // Bug this catches: claiming focus without restoring the caret leaves the guest
    // without a character range, so macOS IME places candidates far from the field.
    const input = document.createElement('input')
    input.value = '你好'
    document.body.append(input)
    input.focus()
    input.setSelectionRange(1, 1)

    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    claimDocumentFocus()

    expect(input.selectionStart).toBe(1)
    expect(input.selectionEnd).toBe(1)
    expect(CLAIM_DOCUMENT_FOCUS_SCRIPT.startsWith('(')).toBe(true)
    expect(CLAIM_DOCUMENT_FOCUS_SCRIPT).toContain('requestAnimationFrame')
    raf.mockRestore()
    input.remove()
  })
})
