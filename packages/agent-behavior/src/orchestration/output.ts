import { offloadMarker } from '../core/context/offload'
import type { HostPorts, OutputFile } from '../ports/host'

/** The text a rejection carries, for results that report a host failure. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Host output-store/verifier calls may reject with any value; unreadable diagnostics must still produce a failure result.
export const reasonOf = (error: unknown): string => {
  try {
    return String(error instanceof Error ? error.message : error)
  } catch {
    return 'Host operation failed'
  }
}

/** D31, D22: what the model reads instead of `file.content` once the full text went to the output store. */
export async function storedMarker(host: HostPorts, file: OutputFile): Promise<string> {
  try {
    return offloadMarker(file.content, { path: await host.outputStore.save(file) })
  } catch (error) {
    return offloadMarker(file.content, { error: reasonOf(error) })
  }
}
