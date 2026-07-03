import os from 'node:os'

import { isMac, isWin } from '@main/core/platform'
import { app } from 'electron'

export const getDeviceType = () => (isMac ? 'mac' : isWin ? 'windows' : 'linux')

export const getHostname = () => os.hostname()

export const getCpuName = () => {
  try {
    const cpus = os.cpus()
    if (!cpus || cpus.length === 0 || !cpus[0].model) {
      return 'Unknown CPU'
    }
    return cpus[0].model
  } catch {
    return 'Unknown CPU'
  }
}

/** PCI vendor id for Intel GPUs. */
const INTEL_GPU_VENDOR_ID = 0x8086

/** Minimal shape of the `app.getGPUInfo('basic')` result we rely on. */
interface BasicGpuInfo {
  gpuDevice?: Array<{ vendorId?: number }>
}

let intelGpuProbe: Promise<boolean> | undefined

/**
 * Whether the machine has an Intel GPU (required by OVMS).
 *
 * Uses Electron's `app.getGPUInfo('basic')`, which returns GPU info already
 * collected by Chromium's GPU process — no subprocess, cross-platform-uniform.
 * The result (the Promise itself) is memoized so the query runs at most once.
 * Empty device list / software rendering / any error resolves to `false`.
 */
export const hasIntelGpu = (): Promise<boolean> => {
  intelGpuProbe ??= (app.getGPUInfo('basic') as Promise<BasicGpuInfo>)
    .then((info) => info?.gpuDevice?.some((device) => device?.vendorId === INTEL_GPU_VENDOR_ID) ?? false)
    .catch(() => false)
  return intelGpuProbe
}
