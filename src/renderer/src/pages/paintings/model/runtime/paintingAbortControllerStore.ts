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
