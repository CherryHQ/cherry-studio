import { Mutex } from 'async-mutex'

/**
 * Thin per-queue state holder. The dispatch loop itself lives on JobManager —
 * DispatchQueue just owns the per-queue concurrency cap and the Layer 1
 * mutex that serializes the (count → fetch → claim) section for this queue.
 *
 * No waiting list, no active job map. All job state lives in jobTable; the
 * dispatch loop re-queries on every tick to find work. The total memory
 * footprint per queue is one Map entry + one Mutex (~hundreds of bytes),
 * which keeps the 1000+ knowledge-base scenario tractable.
 */
export class DispatchQueue {
  readonly mutex = new Mutex()

  constructor(
    readonly name: string,
    readonly concurrency: number
  ) {}
}
