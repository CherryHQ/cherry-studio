import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

export type GatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface ChannelInfo {
  id: string
  name: string
  type: string
  status: 'connected' | 'disconnected' | 'error'
}

export interface HealthInfo {
  status: 'healthy' | 'unhealthy'
  gatewayPort: number
  uptime?: number
  version?: string
}

export interface OpenClawState {
  gatewayStatus: GatewayStatus
  gatewayPort: number
  channels: ChannelInfo[]
  lastHealthCheck: HealthInfo | null
  selectedModelUniqId: string | null
}

export const initialState: OpenClawState = {
  gatewayStatus: 'stopped',
  gatewayPort: 18790,
  channels: [],
  lastHealthCheck: null,
  selectedModelUniqId: null
}

const openClawSlice = createSlice({
  name: 'openclaw',
  initialState,
  reducers: {
    setGatewayStatus: (state, action: PayloadAction<GatewayStatus>) => {
      state.gatewayStatus = action.payload
    },
    setGatewayPort: (state, action: PayloadAction<number>) => {
      state.gatewayPort = action.payload
    },
    setChannels: (state, action: PayloadAction<ChannelInfo[]>) => {
      state.channels = action.payload
    },
    setLastHealthCheck: (state, action: PayloadAction<HealthInfo | null>) => {
      state.lastHealthCheck = action.payload
    },
    setSelectedModelUniqId: (state, action: PayloadAction<string | null>) => {
      state.selectedModelUniqId = action.payload
    },
    resetOpenClaw: () => {
      return initialState
    }
  }
})

export const {
  setGatewayStatus,
  setGatewayPort,
  setChannels,
  setLastHealthCheck,
  setSelectedModelUniqId,
  resetOpenClaw
} = openClawSlice.actions

export default openClawSlice.reducer
