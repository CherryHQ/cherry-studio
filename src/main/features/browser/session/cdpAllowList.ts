import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping'

import type { CommandOptions } from '../browserUse'

const allowedMethods = [
  'Page.enable',
  'Page.navigate',
  'Page.getNavigationHistory',
  'Page.navigateToHistoryEntry',
  'Page.captureScreenshot',
  'Network.enable',
  'DOM.scrollIntoViewIfNeeded',
  'DOM.getContentQuads',
  'DOM.getNodeForLocation',
  'DOM.resolveNode',
  'DOM.focus',
  'Runtime.callFunctionOn',
  'Runtime.releaseObject',
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Emulation.setFocusEmulationEnabled',
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
] as const satisfies readonly (keyof ProtocolMapping.Commands)[]

export type CdpMethod = (typeof allowedMethods)[number]
type CdpParams<M extends CdpMethod> = ProtocolMapping.Commands[M]['paramsType'][0]
export type CdpCommandArgs<M extends CdpMethod> = undefined extends CdpParams<M>
  ? [params?: CdpParams<M>, options?: CommandOptions]
  : [params: CdpParams<M>, options?: CommandOptions]
export const cdpAllowList: ReadonlySet<string> = new Set(allowedMethods)
