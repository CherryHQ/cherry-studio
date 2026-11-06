import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

const state = vi.hoisted(() => ({
  load: vi.fn<() => Promise<Uint8Array>>()
}))

vi.mock('../deviceIdentity', () => ({ loadDesktopIdentity: state.load }))
// Discovery advertises via mDNS (bonjour-service); the connection budget never touches it.
vi.mock('../RemoteAdvertisement', () => ({
  RemoteAdvertisement: class {
    update() {}
    stop() {}
  }
}))
// Agent methods pull the whole AI stream manager; the budget is decided before any of that runs.
vi.mock('../agentJournal', () => ({
  RemoteAgentHub: class {
    publishSession() {}
    sweep() {}
    dispose() {}
  }
}))
// Park every accepted socket inside the Noise handshake: the budget test must observe
// admission decisions only, never a completed channel.
vi.mock('../RemoteConnection', () => ({ RemoteConnection: class {} }))
vi.mock('@cherrystudio/remote-transport', () => ({
  RemoteRpcError: class RemoteRpcError extends Error {},
  RemoteRpcServer: class RemoteRpcServer {},
  RemoteSocketStream: class RemoteSocketStream {},
  acceptSecureChannel: vi.fn(() => new Promise(() => {})),
  deviceIdentityId: () => 'mock-device-identity'
}))
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { onSessionUpdated: vi.fn(() => ({ dispose: vi.fn() })) }
}))
vi.mock('@data/services/RemoteCommandService', () => ({
  remoteCommandService: { interruptPending: vi.fn() }
}))
vi.mock('@data/services/ApiGatewayPairedDeviceService', () => ({
  apiGatewayPairedDeviceService: {}
}))

import { RemoteAccessService } from '../RemoteAccessService'

/** Minimal RemoteSocket stand-in recording constructor-side effects and close codes. */
const createSocket = () => {
  const socket = {
    binaryType: '',
    bufferedAmount: 0,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }
  return socket
}

type FakeSocket = ReturnType<typeof createSocket>

const enableLanMode = () => {
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.enabled', true)
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.host', '0.0.0.0')
}

/** Accepted sockets bind an abort listener; refused ones never reach that point. */
const accepted = (socket: FakeSocket) => socket.addEventListener.mock.calls.some(([type]) => type === 'close')

let service: RemoteAccessService
const sockets: FakeSocket[] = []

beforeEach(() => {
  BaseService.resetInstances()
  MockMainPreferenceServiceUtils.resetMocks()
  mockMainLoggerService.warn.mockClear()
  state.load.mockReset()
  state.load.mockResolvedValue(new Uint8Array([1, 2, 3]))
  enableLanMode()
  sockets.length = 0
  service = new RemoteAccessService()
})

afterEach(() => {
  service.closeIngress()
  BaseService.resetInstances()
})

const openFrom = (address: string): FakeSocket => {
  const socket = createSocket()
  sockets.push(socket)
  service.accept(socket as never, address)
  return socket
}

it('caps concurrent connections per LAN device address', () => {
  for (let i = 0; i < 4; i++) {
    expect(accepted(openFrom('192.168.1.8'))).toBe(true)
  }
  const refused = openFrom('192.168.1.8')
  expect(refused.close).toHaveBeenCalledWith(1013, 'Too many remote connections')
  expect(accepted(refused)).toBe(false)
  // The budget is per address, not global: a second device is unaffected.
  expect(accepted(openFrom('192.168.1.9'))).toBe(true)
})

it('does not collapse the per-device budget for loopback peers behind a local forwarder', () => {
  // A tunnel agent dials 127.0.0.1, so every forwarded connection shares one loopback
  // address. Treating it as a single device would let a handful of unauthenticated
  // sockets lock out paired devices for the whole invitation window.
  for (let i = 0; i < 8; i++) {
    const socket = openFrom('127.0.0.1')
    expect(socket.close).not.toHaveBeenCalled()
    expect(accepted(socket)).toBe(true)
  }
})

it('still enforces the global connection cap regardless of peer address', () => {
  for (let i = 0; i < 20; i++) {
    expect(accepted(openFrom(`192.168.1.${i + 1}`))).toBe(true)
  }
  for (let i = 0; i < 12; i++) {
    expect(accepted(openFrom('::1'))).toBe(true)
  }
  const refusedFromLan = openFrom('192.168.1.100')
  expect(refusedFromLan.close).toHaveBeenCalledWith(1013, 'Too many remote connections')
  const refusedFromLoopback = openFrom('127.0.0.1')
  expect(refusedFromLoopback.close).toHaveBeenCalledWith(1013, 'Too many remote connections')
})

it('warns with the peer address when the connection budget refuses a socket', () => {
  for (let i = 0; i < 4; i++) openFrom('192.168.1.8')
  mockMainLoggerService.warn.mockClear()
  openFrom('192.168.1.8')
  expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
    'Remote connection refused: remote connection budget exhausted',
    expect.objectContaining({ address: '192.168.1.8', active: 4, sameAddress: 4 })
  )
})

it('re-admits a device once its sockets close and free the budget', () => {
  const first = openFrom('192.168.1.8')
  openFrom('192.168.1.8')
  openFrom('192.168.1.8')
  openFrom('192.168.1.8')
  expect(openFrom('192.168.1.8').close).toHaveBeenCalledWith(1013, 'Too many remote connections')
  // Closing one socket drops it from the budget, so the same device can reconnect.
  const closeListener = first.addEventListener.mock.calls.find(([type]) => type === 'close')?.[1] as () => void
  closeListener()
  const readmitted = openFrom('192.168.1.8')
  expect(readmitted.close).not.toHaveBeenCalled()
  expect(accepted(readmitted)).toBe(true)
})
