import { createSlice } from '@reduxjs/toolkit'
import { Agent } from '@renderer/types'

/**
 * @deprecated use assistants instead
 */
export interface AgentsState {
  /**
   * @deprecated use assistants instead
   */
  agents: Agent[]
}

const initialState: AgentsState = {
  agents: []
}

const assistantsSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {}
})

export default assistantsSlice.reducer
