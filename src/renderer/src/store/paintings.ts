import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { PaintingAction, PaintingsState } from '@renderer/types'

const initialState: PaintingsState = {
  paintings: [],
  generate: [],
  remix: [],
  edit: [],
  upscale: [],
  DMXAPIPaintings: []
}

const paintingsSlice = createSlice({
  name: 'paintings',
  initialState,
  reducers: {
    addPainting: (
      state: PaintingsState,
      action: PayloadAction<{ namespace?: keyof PaintingsState; painting: PaintingAction }>
    ) => {
      const { namespace = 'paintings', painting } = action.payload
      if (state[namespace]) {
        state[namespace].unshift(painting)
      } else {
        state[namespace] = [painting]
      }
    },
    removePainting: (
      state: PaintingsState,
      action: PayloadAction<{ namespace?: keyof PaintingsState; painting: PaintingAction }>
    ) => {
      const { namespace = 'paintings', painting } = action.payload
      // @ts-ignore - TypeScript 无法正确推断数组元素类型与过滤条件的兼容性
      state[namespace] = state[namespace].filter((c) => c.id !== painting.id)
    },
    updatePainting: (
      state: PaintingsState,
      action: PayloadAction<{ namespace?: keyof PaintingsState; painting: PaintingAction }>
    ) => {
      const { namespace = 'paintings', painting } = action.payload
      state[namespace] = state[namespace].map((c) => (c.id === painting.id ? painting : c))
    },
    updatePaintings: (
      state: PaintingsState,
      action: PayloadAction<{ namespace?: keyof PaintingsState; paintings: PaintingAction[] }>
    ) => {
      const { namespace = 'paintings', paintings } = action.payload
      // @ts-ignore - TypeScript 无法正确推断数组元素类型与过滤条件的兼容性
      state[namespace] = paintings
    }
  }
})

export const { updatePaintings, addPainting, removePainting, updatePainting } = paintingsSlice.actions

export default paintingsSlice.reducer
