import { loggerService } from '@logger'
import { app } from 'electron'

import type { MemorySample, ProcessMetric } from './types'

const logger = loggerService.withContext('perfMemory')

/** main 进程自身的内存切片。调用成本约几微秒，可以按秒级频率采。 */
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
 * 全进程（main / renderer / GPU / utility）的 CPU 与内存。
 * 比 `process.memoryUsage()` 贵得多，只在面板主动请求时调用，不要放进定时器。
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
