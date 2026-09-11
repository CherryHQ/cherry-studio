import { bootConfigValid, hardwareAcceleration } from './checks/config'
import {
  installArchitectureMatch,
  installNativeModules,
  installUpdateAvailable,
  installVersionChannel
} from './checks/install'
import { recentLogFindings } from './checks/logs'
import { mcpLaunchCommands, mcpServersConnected } from './checks/mcp'
import {
  dnsResolution,
  endpointCloud,
  endpointDiagnostics,
  endpointRegistry,
  endpointUpdate,
  online,
  providerEndpoint,
  proxyApplied,
  tlsHandshake
} from './checks/network'
import { accessibilityPermission, screenCapturePermission } from './checks/permission'
import { cherryAccount, providerApiKey, providerModel } from './checks/provider'
import { claudeLogin, managedTools } from './checks/runtime'
import { diagnosticDataSize, diskSpace, userDataLocation } from './checks/storage'
import type { DoctorCheckRegistry } from './types'

/** One entry per catalog id; the type makes a missing or extra entry a compile error. */
export const doctorCheckRegistry: DoctorCheckRegistry = {
  'install-architecture-match': installArchitectureMatch,
  'install-version-channel': installVersionChannel,
  'install-update-available': installUpdateAvailable,
  'install-native-modules': installNativeModules,
  'permission-screen-capture': screenCapturePermission,
  'permission-accessibility': accessibilityPermission,
  'storage-userdata-location': userDataLocation,
  'storage-disk-space': diskSpace,
  'storage-diagnostic-data-size': diagnosticDataSize,
  'config-boot-config-valid': bootConfigValid,
  'config-hardware-acceleration': hardwareAcceleration,
  'provider-model': providerModel,
  'provider-api-key-present': providerApiKey,
  'provider-cherry-account': cherryAccount,
  'network-online': online,
  'network-dns-resolution': dnsResolution,
  'network-tls-handshake': tlsHandshake,
  'network-proxy-applied': proxyApplied,
  'network-endpoint-update': endpointUpdate,
  'network-endpoint-registry': endpointRegistry,
  'network-endpoint-cloud': endpointCloud,
  'network-endpoint-diagnostics': endpointDiagnostics,
  'network-provider-endpoint': providerEndpoint,
  'mcp-servers-connected': mcpServersConnected,
  'mcp-launch-commands': mcpLaunchCommands,
  'runtime-managed-tools': managedTools,
  'runtime-claude-login': claudeLogin,
  'logs-recent-findings': recentLogFindings
}
