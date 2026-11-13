import type { Transaction } from '@tiptap/pm/state'

export const RICH_EDITOR_USER_COMMAND_META = 'richEditorUserCommand'

export function isUserCommandTransaction(transaction: Transaction): boolean {
  return transaction.getMeta(RICH_EDITOR_USER_COMMAND_META) === true
}
