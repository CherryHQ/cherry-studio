/**
 * Host/guest document-focus helpers for macOS IME caret coordinates in `<webview>`.
 *
 * Chromium anchors the candidate window using the focused document's selection.
 * When the host page still owns a selection, or when launch/resize leaves a stale
 * caret screen cache, the panel appears far from the guest caret. Clearing the
 * host selection and briefly claiming focus inside the guest forces a fresh
 * caret rect (electron#4539 / Chromium#593134 workaround pattern).
 */

/** Clear the host document selection so IME stops anchoring to the host page. */
export function releaseDocumentFocus(): void {
  const element = document.createElement('span')
  document.body.append(element)
  const range = document.createRange()
  range.setStart(element, 0)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  selection?.removeAllRanges()
  element.remove()
}

/**
 * Claim document focus in the current document, then restore the prior caret on
 * the next frame so NSTextInputClient re-reads the caret screen rect.
 * Run this inside the guest (via executeJavaScript) after {@link releaseDocumentFocus}.
 */
export function claimDocumentFocus(): void {
  const active = document.activeElement
  const selection = window.getSelection()
  let selectionStart: number | null | undefined
  let selectionEnd: number | null | undefined
  let range: Range | undefined
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    selectionStart = active.selectionStart
    selectionEnd = active.selectionEnd
  }
  if (selection && selection.rangeCount > 0) range = selection.getRangeAt(0)

  const restore = () => {
    if (
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
      selectionStart != null &&
      selectionEnd != null
    ) {
      active.selectionStart = selectionStart
      active.selectionEnd = selectionEnd
      return
    }
    if (range && selection) {
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }

  const probe = document.createElement('span')
  document.body.append(probe)
  const probeRange = document.createRange()
  probeRange.setStart(probe, 0)
  selection?.removeAllRanges()
  selection?.addRange(probeRange)
  selection?.removeAllRanges()
  probe.remove()
  requestAnimationFrame(restore)
}

/** Guest-world payload for `<webview>.executeJavaScript`. */
export const CLAIM_DOCUMENT_FOCUS_SCRIPT = `(${claimDocumentFocus.toString()})()`
