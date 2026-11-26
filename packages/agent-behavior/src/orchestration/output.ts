import { exceedsThreshold, offloadMarker, offloadName } from '../core/context/offload'
import type { CallKey } from '../core/facts'
import { SUBAGENT_TOOL_NAME, type RunReport } from '../core/subagents/subagentText'
import type { HostPorts, OutputFile } from '../ports/host'

/** The text a rejection carries, for results that report a host failure. */
export const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** D31, D22: what the model reads instead of `file.content` once the full text went to the output store. */
export async function storedMarker(host: HostPorts, file: OutputFile): Promise<string> {
  try {
    return offloadMarker(file.content, { path: await host.outputStore.save(file) })
  } catch (error) {
    return offloadMarker(file.content, { error: reasonOf(error) })
  }
}

/** D22: a report or partial output over the threshold goes to the output store; the run record keeps the marker. */
export async function storeChildReport(host: HostPorts, call: CallKey, report: RunReport): Promise<RunReport> {
  const threshold = host.settings.offloadThreshold()
  const shorten = async (text: string | undefined) =>
    text === undefined || !exceedsThreshold(text, threshold)
      ? text
      : storedMarker(host, { name: offloadName(text), content: text, key: call, tool: SUBAGENT_TOOL_NAME })
  const [text, partial] = await Promise.all([shorten(report.report), shorten(report.partial)])
  return { ...report, ...(text === undefined ? {} : { report: text }), ...(partial === undefined ? {} : { partial }) }
}
