import { describe, expect, it } from 'vitest'

import { IpcChannel } from '../IpcChannel'

describe('IpcChannel API gateway migration', () => {
  it('keeps legacy ApiServer channels on the original api-server namespace', () => {
    expect(IpcChannel.ApiServer_Start).toBe('api-server:start')
    expect(IpcChannel.ApiServer_Stop).toBe('api-server:stop')
    expect(IpcChannel.ApiServer_Restart).toBe('api-server:restart')
    expect(IpcChannel.ApiServer_GetStatus).toBe('api-server:get-status')
    expect(IpcChannel.ApiServer_GetConfig).toBe('api-server:get-config')
  })

  it('moves ApiGateway channels to the new api-gateway namespace', () => {
    expect(IpcChannel.ApiGateway_Start).toBe('api-gateway:start')
    expect(IpcChannel.ApiGateway_Stop).toBe('api-gateway:stop')
    expect(IpcChannel.ApiGateway_Restart).toBe('api-gateway:restart')
    expect(IpcChannel.ApiGateway_GetStatus).toBe('api-gateway:get-status')
    expect(IpcChannel.ApiGateway_GetConfig).toBe('api-gateway:get-config')
    expect(IpcChannel.ApiGateway_Ready).toBe('api-gateway:ready')
  })
})
