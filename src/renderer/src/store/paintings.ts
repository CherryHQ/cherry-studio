/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import { loggerService } from '@logger'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { PaintingAction, PaintingsState } from '@renderer/types'

const logger = loggerService.withContext('Store:paintings')

const initialState: PaintingsState = {
  // SiliconFlow
  siliconflow_paintings: [],
  // DMXAPI
  dmxapi_paintings: [],
  // TokenFlux
  tokenflux_paintings: [],
  zhipu_paintings: [],
  // Aihubmix
  aihubmix_image_generate: [],
  aihubmix_image_remix: [],
  aihubmix_image_edit: [],
  aihubmix_image_upscale: [],
  // OpenAI
  openai_image_generate: [],
  openai_image_edit: [],
  // OVMS
  ovms_paintings: []
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
