import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { RootState } from '@renderer/store/index'

export interface NoteState {
  activeNodeId: string | undefined
}

const initialState: NoteState = {
  activeNodeId: undefined
}

const noteSlice = createSlice({
  name: 'note',
  initialState,
  reducers: {
    setActiveNodeId: (state, action: PayloadAction<string | undefined>) => {
      state.activeNodeId = action.payload
    }
  }
})

export const { setActiveNodeId } = noteSlice.actions

export const selectActiveNodeId = (state: RootState) => state.note.activeNodeId

export default noteSlice.reducer
