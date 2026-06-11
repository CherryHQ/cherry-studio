/**
 * Wrap a steer message — one the user sent while the assistant was already working — so the model
 * treats it as a mid-task redirect that supersedes the in-progress instruction, rather than a fresh
 * standalone prompt. Chat wraps it into the rebuilt model history for the steer continuation.
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
