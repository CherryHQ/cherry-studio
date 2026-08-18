import { loggerService } from '@logger'
import { app } from 'electron'

import type { MemorySample, ProcessMetric } from './types'

const logger = loggerService.withContext('perfMemory')

/** A slice of this process's own memory. Costs a few microseconds, so second-level sampling is fine. */
export function sampleMemory(now: () => number = () => performance.now()): MemorySample {
  const usage = process.memoryUsage()
  return {
    at: now(),
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers
  }
}

/**
 * CPU and memory for every process (main / renderer / GPU / utility).
 * Far more expensive than `process.memoryUsage()` — call it on panel request only, never on a timer.
 */
export function collectProcessMetrics(): ProcessMetric[] {
  try {
    return app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      name: metric.name,
      cpuPercent: metric.cpu.percentCPUUsage,
      memoryKb: metric.memory.workingSetSize
    }))
  } catch (error) {
    logger.warn('Failed to collect app metrics', error as Error)
    return []
  }
}
