export function getElementBorderWidth(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  return {
    top: parseFloat(style.borderTopWidth),
    right: parseFloat(style.borderRightWidth),
    bottom: parseFloat(style.borderBottomWidth),
    left: parseFloat(style.borderLeftWidth)
  }
}
