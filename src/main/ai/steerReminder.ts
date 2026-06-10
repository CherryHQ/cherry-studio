/**
 * Wrap a steer message — one the user sent while the assistant was already working — so the model
 * treats it as a mid-task redirect rather than a fresh prompt (invariant 7). Mirrors opencode's
 * `insertReminders`. Shared by both runtimes: chat wraps it into the rebuilt model history; the
 * claudeCode driver wraps it as it pushes into the live streaming-input queue.
 */
export function wrapSteerReminder(text: string): string {
  return [
    '<system-reminder>',
    'The user sent the following message:',
    text,
    '',
    'Please address this message and continue with your tasks.',
    '</system-reminder>'
  ].join('\n')
}
