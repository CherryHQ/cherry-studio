import { bootConfigValid } from './checks/config'
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
import { userDataLocation } from './checks/storage'
import type { DoctorCheckRegistry } from './types'

/** One entry per catalog id; the type makes a missing or extra entry a compile error. */
export const doctorCheckRegistry: DoctorCheckRegistry = {
  'config-boot-config-valid': bootConfigValid,
  'storage-userdata-location': userDataLocation,
  'network-online': online,
  'network-dns-resolution': dnsResolution,
  'network-tls-handshake': tlsHandshake,
  'network-proxy-applied': proxyApplied,
  'network-endpoint-update': endpointUpdate,
  'network-endpoint-registry': endpointRegistry,
  'network-endpoint-cloud': endpointCloud,
  'network-endpoint-diagnostics': endpointDiagnostics
}
