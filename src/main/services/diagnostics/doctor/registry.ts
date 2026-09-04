import { bootConfigValid, hardwareAcceleration } from './checks/config'
import { installVersionChannel } from './checks/install'
import { recentLogFindings } from './checks/logs'
import { mcpLaunchCommands, mcpServersConnected } from './checks/mcp'
import {
  dnsResolution,
  endpointCloud,
  endpointDiagnostics,
  endpointRegistry,
  endpointUpdate,
  online,
  proxyApplied,
  tlsHandshake
} from './checks/network'
import { accessibilityPermission, screenCapturePermission } from './checks/permission'
import { defaultModel, defaultProviderApiKey } from './checks/provider'
import { managedTools } from './checks/runtime'
import { diagnosticDataSize, diskSpace, userDataLocation } from './checks/storage'
import type { DoctorCheckRegistry } from './types'

/** One entry per catalog id; the type makes a missing or extra entry a compile error. */
export const doctorCheckRegistry: DoctorCheckRegistry = {
  'install-version-channel': installVersionChannel,
  'permission-screen-capture': screenCapturePermission,
  'permission-accessibility': accessibilityPermission,
  'storage-userdata-location': userDataLocation,
  'storage-disk-space': diskSpace,
  'storage-diagnostic-data-size': diagnosticDataSize,
  'config-boot-config-valid': bootConfigValid,
  'config-hardware-acceleration': hardwareAcceleration,
  'provider-default-model': defaultModel,
  'provider-api-key-present': defaultProviderApiKey,
  'network-online': online,
  'network-dns-resolution': dnsResolution,
  'network-tls-handshake': tlsHandshake,
  'network-proxy-applied': proxyApplied,
  'network-endpoint-update': endpointUpdate,
  'network-endpoint-registry': endpointRegistry,
  'network-endpoint-cloud': endpointCloud,
  'network-endpoint-diagnostics': endpointDiagnostics,
  'mcp-servers-connected': mcpServersConnected,
  'mcp-launch-commands': mcpLaunchCommands,
  'runtime-managed-tools': managedTools,
  'logs-recent-findings': recentLogFindings
}
