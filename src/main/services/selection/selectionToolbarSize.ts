export interface SelectionToolbarSize {
  toolbarWidth: number
  toolbarHeight: number
}

/** Converts the renderer's CSS-pixel measurement into whole DIP dimensions for the toolbar window. */
export function getSelectionToolbarSize(
  widthCss: number,
  baseHeightCss: number,
  zoomFactor: number
): SelectionToolbarSize {
  return {
    toolbarWidth: Math.ceil(widthCss * zoomFactor),
    toolbarHeight: Math.ceil(baseHeightCss * zoomFactor)
  }
}
