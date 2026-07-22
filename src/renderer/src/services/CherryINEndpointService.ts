/**
 * Prewarms the process-wide CherryIN endpoint selection only when the provider is enabled.
 * Other CherryIN entry points can still initialize the selection lazily through getEndpointSelection().
 */
export async function prewarmCherryInEndpoint(isProviderEnabled: boolean): Promise<void> {
  if (!isProviderEnabled) return

  await window.api.cherryin.getEndpointSelection()
}
