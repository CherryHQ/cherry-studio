/** Resolve only an editable surface explicitly registered for dictation. */
export function getDictationTarget(element: Element | null): { input: HTMLElement; targetId: string } | null {
  const input = element?.closest('textarea, input, [contenteditable="true"]')
  const surface = input?.closest('[data-voice-target-id]')
  const targetId = surface?.getAttribute('data-voice-target-id')
  if (!(input instanceof HTMLElement) || !surface || !targetId) return null
  if (
    (input.isContentEditable && (surface === input || surface.querySelector('[contenteditable="true"]') === input)) ||
    (surface === input &&
      input.matches('textarea:not(:disabled):not([readonly]), input:not(:disabled):not([readonly])'))
  )
    return { input, targetId }
  return null
}
