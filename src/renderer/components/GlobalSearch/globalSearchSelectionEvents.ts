export function isGlobalSearchSelectionForTab(
  payload: { targetTabId?: string } | null | undefined,
  currentTabId: string | null | undefined
) {
  return !!currentTabId && !!payload?.targetTabId && payload.targetTabId === currentTabId
}
