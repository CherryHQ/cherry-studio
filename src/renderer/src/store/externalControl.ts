import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { ExternalControlServerType } from '@renderer/types'

export interface ExternalControlState {
  serverType: ExternalControlServerType
  httpPort: number | undefined
}

const initialState: ExternalControlState = {
  serverType: ExternalControlServerType.DISABLE,
  httpPort: undefined
}

const externalControlSlice = createSlice({
  name: 'externalControl',
  initialState,
  reducers: {
    setServerType: (state, action: PayloadAction<ExternalControlServerType>) => {
      state.serverType = action.payload
    },
    setHttpPort: (state, action: PayloadAction<number | undefined>) => {
      state.httpPort = action.payload
    }
  }
})

export const { setServerType, setHttpPort } = externalControlSlice.actions
export default externalControlSlice.reducer
export { initialState }
