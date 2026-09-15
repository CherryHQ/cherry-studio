export const cdpAllowList: ReadonlySet<string> = new Set([
  'Page.enable',
  'Page.getFrameTree',
  'Page.createIsolatedWorld',
  'Page.handleJavaScriptDialog',
  'Runtime.enable',
  'Runtime.evaluate',
  'Runtime.releaseObjectGroup',
  'DOM.enable',
  'DOM.describeNode',
  'Accessibility.enable',
  'Accessibility.getFullAXTree',
  'Accessibility.getAXNodeAndAncestors',
  'Accessibility.getChildAXNodes',
  'DOMSnapshot.captureSnapshot'
])
