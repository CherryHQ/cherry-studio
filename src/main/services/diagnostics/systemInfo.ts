import { statfs } from 'node:fs/promises'
import { arch, cpus, freemem, platform, release, totalmem, version } from 'node:os'

import { application } from '@application'
import type { DiagnosticWarning } from '@shared/ipc/schemas/diagnostics'
import { app, screen } from 'electron'

interface WhitelistedGpuDevice {
  readonly active?: boolean
  readonly driverVendor?: string
  readonly driverVersion?: string
  readonly vendorId?: number
}

interface DiagnosticSystemSnapshot {
  readonly application: {
    readonly isPackaged?: boolean
    readonly isPortable?: boolean
    readonly name?: string
    readonly version?: string
  }
  readonly displays?: ReadonlyArray<{
    readonly height: number
    readonly rotation: number
    readonly scaleFactor: number
    readonly width: number
  }>
  readonly disk?: {
    readonly freeBytes: number
    readonly totalBytes: number
  }
  readonly gpu?: {
    readonly devices: readonly WhitelistedGpuDevice[]
    readonly featureStatus?: Record<string, string>
    readonly renderer?: string
    readonly vendor?: string
  }
  readonly hardware: {
    readonly cpu?: {
      readonly logicalCores?: number
      readonly model?: string
    }
    readonly memory?: {
      readonly freeBytes?: number
      readonly totalBytes?: number
    }
  }
  readonly operatingSystem: {
    readonly arch?: string
    readonly locale?: string
    readonly platform?: NodeJS.Platform
    readonly release?: string
    readonly timezone?: string
    readonly version?: string
  }
  readonly runtime: {
    readonly chrome?: string
    readonly electron?: string
    readonly node?: string
    readonly v8?: string
  }
  readonly settings: {
    readonly developerModeEnabled?: boolean
    readonly hardwareAccelerationDisabled?: boolean
    readonly proxyConfigured?: boolean
  }
}

function collectValue<T>(warnings: Set<DiagnosticWarning>, collector: () => T): T | undefined {
  try {
    return collector()
  } catch {
    warnings.add('system_info_unavailable')
    return undefined
  }
}

async function collectAsyncValue<T>(
  warnings: Set<DiagnosticWarning>,
  collector: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await collector()
  } catch {
    warnings.add('system_info_unavailable')
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : undefined
}

async function collectGpuInfo(warnings: Set<DiagnosticWarning>): Promise<DiagnosticSystemSnapshot['gpu']> {
  const info = asRecord(await collectAsyncValue(warnings, () => app.getGPUInfo('basic')))
  const featureStatus = collectValue(warnings, () => ({ ...app.getGPUFeatureStatus() }))
  if (!info && !featureStatus) return undefined

  const devices = Array.isArray(info?.gpuDevice)
    ? info.gpuDevice.flatMap((value): WhitelistedGpuDevice[] => {
        const device = asRecord(value)
        if (!device) return []
        return [
          {
            active: readBoolean(device, 'active'),
            driverVendor: readString(device, 'driverVendor'),
            driverVersion: readString(device, 'driverVersion'),
            vendorId: readNumber(device, 'vendorId')
          }
        ]
      })
    : []
  const attributes = asRecord(info?.auxAttributes)
  return {
    devices,
    featureStatus,
    renderer: readString(attributes, 'glRenderer'),
    vendor: readString(attributes, 'glVendor')
  }
}

async function collectDiskInfo(warnings: Set<DiagnosticWarning>): Promise<DiagnosticSystemSnapshot['disk']> {
  const stats = await collectAsyncValue(warnings, () => statfs(application.getPath('app.userdata')))
  return stats ? { freeBytes: stats.bsize * stats.bavail, totalBytes: stats.bsize * stats.blocks } : undefined
}

function collectDisplayInfo(warnings: Set<DiagnosticWarning>): DiagnosticSystemSnapshot['displays'] {
  return collectValue(warnings, () =>
    screen.getAllDisplays().map((display) => ({
      height: display.size.height,
      rotation: display.rotation,
      scaleFactor: display.scaleFactor,
      width: display.size.width
    }))
  )
}

export async function collectDiagnosticSystemInfo(warnings: Set<DiagnosticWarning>): Promise<DiagnosticSystemSnapshot> {
  const cpuInfo = collectValue(warnings, cpus)
  const [disk, gpu] = await Promise.all([collectDiskInfo(warnings), collectGpuInfo(warnings)])

  return {
    application: {
      isPackaged: collectValue(warnings, () => app.isPackaged),
      isPortable: collectValue(
        warnings,
        () => process.platform === 'win32' && 'PORTABLE_EXECUTABLE_DIR' in process.env
      ),
      name: collectValue(warnings, () => app.getName()),
      version: collectValue(warnings, () => app.getVersion())
    },
    displays: collectDisplayInfo(warnings),
    disk,
    gpu,
    hardware: {
      cpu: cpuInfo ? { logicalCores: cpuInfo.length, model: cpuInfo[0]?.model ?? 'unknown' } : undefined,
      memory: {
        freeBytes: collectValue(warnings, freemem),
        totalBytes: collectValue(warnings, totalmem)
      }
    },
    operatingSystem: {
      arch: collectValue(warnings, arch),
      locale: collectValue(warnings, () => app.getLocale()),
      platform: collectValue(warnings, platform),
      release: collectValue(warnings, release),
      timezone: collectValue(warnings, () => Intl.DateTimeFormat().resolvedOptions().timeZone),
      version: collectValue(warnings, version)
    },
    runtime: {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
      v8: process.versions.v8
    },
    settings: {
      developerModeEnabled: collectValue(warnings, () =>
        application.get('PreferenceService').get('app.developer_mode.enabled')
      ),
      hardwareAccelerationDisabled: collectValue(warnings, () =>
        application.get('PreferenceService').get('BootConfig.app.disable_hardware_acceleration')
      ),
      proxyConfigured: collectValue(
        warnings,
        () => application.get('PreferenceService').get('app.proxy.mode') !== 'none'
      )
    }
  }
}
