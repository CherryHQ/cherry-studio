import { loggerService } from '@logger'
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { PaintingAction, PaintingsState } from '@renderer/types'

const logger = loggerService.withContext('Store:paintings')

const initialState: PaintingsState = {
  paintings: [],
  generate: [],
  remix: [],
  edit: [],
  upscale: [],
  DMXAPIPaintings: [],
  tokenFluxPaintings: [],
  openai_image_generate: [],
  openai_image_edit: []
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

      const existingIndex = state[namespace].findIndex((c) => c.id === painting.id)
      if (existingIndex !== -1) {
        state[namespace] = state[namespace].map((c) => (c.id === painting.id ? painting : c))
      } else {
        logger.error(`Painting with id ${painting.id} not found in ${namespace}`)
      }
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
