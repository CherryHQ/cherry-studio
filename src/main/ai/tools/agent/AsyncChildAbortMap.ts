/**
 * Per-stream abort plumbing for sub-agents spawned by the `agent` meta-tool.
 * One instance per parent `Agent.stream()` call. Both sync and async children
 * go through this map so cancellation is uniform: `abortAll('parent-stream-end')`
 * fires on parent stream termination and unblocks any detached drainers.
 *
 * Status / identity / listing live in the messages table (see D12), not here —
 * this map only owns runtime-only state (AbortController references) that
 * cannot be persisted.
 */
export class AsyncChildAbortMap {
  private readonly map = new Map<string, AbortController>()

  set(taskId: string, ac: AbortController): void {
    this.map.set(taskId, ac)
  }

  delete(taskId: string): void {
    this.map.delete(taskId)
  }

  abortAll(reason: string = 'parent-stream-end'): void {
    for (const ac of this.map.values()) ac.abort(reason)
    this.map.clear()
  }
}
