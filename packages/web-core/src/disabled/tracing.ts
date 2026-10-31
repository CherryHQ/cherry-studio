// Stand-ins for the observability services that write traces to disk, bridge Claude Code
// over HTTP, or install Node's async-hooks context manager.
import { unsupportedClass } from './unsupported'

export const ClaudeCodeTraceBridgeService = unsupportedClass('Claude Code trace bridge')
export const TraceStorageService = unsupportedClass('Trace storage')
export const NodeTraceService = unsupportedClass('Node trace service')
