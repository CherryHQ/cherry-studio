export function installSyncRafMock() {
  const originalRequestAnimationFrame = window.requestAnimationFrame

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0)
    return 0
  }) as typeof window.requestAnimationFrame

  return () => {
    window.requestAnimationFrame = originalRequestAnimationFrame
  }
}
