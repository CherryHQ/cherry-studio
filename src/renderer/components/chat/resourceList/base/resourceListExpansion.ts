export function remapResourceListCollapsedGroupIds(
  collapsedIds: readonly string[],
  mapGroupId: (groupId: string) => string
): string[] {
  return Array.from(new Set(collapsedIds.map(mapGroupId)))
}
