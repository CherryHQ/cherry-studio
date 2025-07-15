import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { factExtractionPrompt, updateMemorySystemPrompt } from '@renderer/utils/memory-prompts'
import type { MemoryConfig } from '@types'

/**
 * Memory store state interface
 * Manages a single memory configuration for the application
 */
export interface MemoryState {
  /** The current memory configuration */
  memoryConfig: MemoryConfig
  /** The currently selected user ID for memory operations */
  currentUserId: string
  /** Global memory enabled state - when false, memory is disabled for all assistants */
  globalMemoryEnabled: boolean
}

// Default memory configuration to avoid undefined errors
const defaultMemoryConfig: MemoryConfig = {
  embedderDimensions: 1536,
  isAutoDimensions: true,
  customFactExtractionPrompt: factExtractionPrompt,
  customUpdateMemoryPrompt: updateMemorySystemPrompt
}

/**
 * Initial state for the memory store
 */
export const initialState: MemoryState = {
  memoryConfig: defaultMemoryConfig,
  currentUserId: localStorage.getItem('memory_currentUserId') || 'default-user',
  globalMemoryEnabled: false // Default to false
}

/**
 * Redux slice for managing memory configuration
 *
 * Usage example:
 * ```typescript
 * // Setting a memory config
 * dispatch(updateMemoryConfig(newConfig))
 *
 * // Getting the memory config
 * const config = useSelector(getMemoryConfig)
 * ```
 */
const memorySlice = createSlice({
  name: 'memory',
  initialState,
  reducers: {
    /**
     * Updates the memory configuration
     * @param state - Current memory state
     * @param action - Payload containing the new MemoryConfig
     */
    updateMemoryConfig: (state, action: PayloadAction<MemoryConfig>) => {
      state.memoryConfig = action.payload
    },
    /**
     * Sets the current user ID and persists it to localStorage
     * @param state - Current memory state
     * @param action - Payload containing the new user ID
     */
    setCurrentUserId: (state, action: PayloadAction<string>) => {
      state.currentUserId = action.payload
      localStorage.setItem('memory_currentUserId', action.payload)
    },
    /**
     * Sets the global memory enabled state and persists it to localStorage
     * @param state - Current memory state
     * @param action - Payload containing the new global memory enabled state
     */
    setGlobalMemoryEnabled: (state, action: PayloadAction<boolean>) => {
      state.globalMemoryEnabled = action.payload
    }
  },
  selectors: {
    /**
     * Selector to get the current memory configuration
     * @param state - Memory state
     * @returns The current MemoryConfig or undefined if not set
     */
    getMemoryConfig: (state) => state.memoryConfig,
    /**
     * Selector to get the current user ID
     * @param state - Memory state
     * @returns The current user ID
     */
    getCurrentUserId: (state) => state.currentUserId,
    /**
     * Selector to get the global memory enabled state
     * @param state - Memory state
     * @returns The global memory enabled state
     */
    getGlobalMemoryEnabled: (state) => state.globalMemoryEnabled
  }
})

// Export action creators
export const { updateMemoryConfig, setCurrentUserId, setGlobalMemoryEnabled } = memorySlice.actions

// Export selectors
export const { getMemoryConfig, getCurrentUserId, getGlobalMemoryEnabled } = memorySlice.selectors

// Type-safe selector for accessing this slice from the root state
export const selectMemory = (state: { memory: MemoryState }) => state.memory

// Root state selector for memory config with safety check
export const selectMemoryConfig = (state: { memory?: MemoryState }) => state.memory?.memoryConfig || defaultMemoryConfig

// Root state selector for current user ID with safety check
export const selectCurrentUserId = (state: { memory?: MemoryState }) => state.memory?.currentUserId || 'default-user'

// Root state selector for global memory enabled with safety check
export const selectGlobalMemoryEnabled = (state: { memory?: MemoryState }) => state.memory?.globalMemoryEnabled ?? false

export { memorySlice }
// Export the reducer as default export
export default memorySlice.reducer
