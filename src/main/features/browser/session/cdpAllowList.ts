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
  'Page.getLayoutMetrics',
  'Page.createIsolatedWorld',
  'Page.handleJavaScriptDialog',
  'Runtime.enable',
  'Runtime.evaluate',
  'Runtime.releaseObjectGroup',
  'DOM.enable',
  'DOM.getDocument',
  'DOM.describeNode',
  'Accessibility.enable',
  'Accessibility.queryAXTree',
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

const eventMethods = [
  'Page.frameNavigated',
  'Page.frameStartedLoading',
  'Page.frameStoppedLoading',
  'Page.loadEventFired',
  'Page.javascriptDialogOpening',
  'Page.javascriptDialogClosed',
  'Runtime.consoleAPICalled',
  'Runtime.exceptionThrown',
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.loadingFinished',
  'Network.loadingFailed'
] as const satisfies readonly (keyof ProtocolMapping.Events)[]
type CdpEventMethod = (typeof eventMethods)[number]
export type CdpEvent = {
  [M in CdpEventMethod]: { method: M; params: ProtocolMapping.Events[M][0] }
}[CdpEventMethod]
export const cdpEventMethods: ReadonlySet<string> = new Set(eventMethods)
