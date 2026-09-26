type MermaidRenderJob = {
  run?: (isCancelled: () => boolean) => Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
  started: boolean
  cancelled: boolean
}

/** Serializes Mermaid renders because Mermaid has one shared mutable config. */
export class MermaidRenderService {
  private pending: MermaidRenderJob[] = []
  private running = false

  enqueue(run: (isCancelled: () => boolean) => Promise<void>) {
    let job!: MermaidRenderJob
    const promise = new Promise<void>((resolve, reject) => {
      job = { run, resolve, reject, started: false, cancelled: false }
    })
    this.pending.push(job)
    this.startNext()

    return {
      promise,
      isQueued: () => !job.started && !job.cancelled,
      cancel: () => {
        if (job.cancelled) return
        job.cancelled = true
        if (!job.started) {
          this.pending.splice(this.pending.indexOf(job), 1)
          job.run = undefined
          job.resolve()
        }
      }
    }
  }

  private startNext() {
    if (this.running) return
    const job = this.pending.shift()
    if (!job) return

    this.running = true
    job.started = true
    const run = job.run!
    job.run = undefined
    void run(() => job.cancelled)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.running = false
        this.startNext()
      })
  }
}

export const mermaidRenderService = new MermaidRenderService()
