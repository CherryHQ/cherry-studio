/**
 * Create a group and move a topic into it. The topic can be archived or removed in another
 * window between opening the dialog and saving, so a failed assignment rolls the new group back:
 * retries must never accumulate empty groups.
 */
export async function assignTopicToNewGroup(input: {
  createGroup: () => Promise<{ id: string }>
  deleteGroup: (groupId: string) => Promise<unknown>
  assign: (groupId: string) => Promise<unknown>
}): Promise<void> {
  const group = await input.createGroup()
  try {
    await input.assign(group.id)
  } catch (error) {
    await input.deleteGroup(group.id).catch(() => {})
    throw error
  }
}
