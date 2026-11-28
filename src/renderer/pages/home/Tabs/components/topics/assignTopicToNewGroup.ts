/**
 * Create a group and move a topic into it as ONE main-process write. The topic can be archived or
 * removed in another window between opening the dialog and saving: then nothing is committed or
 * published. The group id is chosen here, so a retry after a lost reply (timeout) resolves to the
 * already-committed result instead of creating a second group, and nothing is ever deleted
 * client-side that another window may already have moved a topic into.
 */
export async function assignTopicToNewGroup<T>(input: {
  submit: (groupId: string) => Promise<T>
  /** The draft's id, reused by every submission of the same dialog draft. */
  groupId?: string
  newGroupId?: () => string
}): Promise<T> {
  const groupId = input.groupId ?? (input.newGroupId ?? (() => crypto.randomUUID()))()
  try {
    return await input.submit(groupId)
  } catch {
    // The request may have committed before the reply was lost; the same id makes the retry idempotent.
    return await input.submit(groupId)
  }
}
