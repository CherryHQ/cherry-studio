// TODO: remove this module — painting cancellation should move to the backend
// (the main-process generation service should own the AbortController per
// painting id and expose IPC to cancel). Renderer-side bookkeeping makes
// in-flight work die on window reload and can't survive process restart.
const abortControllers = new Map<string, AbortController>()

export function registerPaintingAbortController(paintingId: string, controller: AbortController): void {
  abortControllers.get(paintingId)?.abort()
  abortControllers.set(paintingId, controller)
}

export function getPaintingAbortController(paintingId: string): AbortController | null {
  return abortControllers.get(paintingId) ?? null
}

export function clearPaintingAbortController(paintingId: string, controller?: AbortController): void {
  if (!controller || abortControllers.get(paintingId) === controller) {
    abortControllers.delete(paintingId)
  }
}

export function abortPaintingGeneration(paintingId: string): void {
  abortControllers.get(paintingId)?.abort()
}
