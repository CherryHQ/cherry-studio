/**
 * Utility functions for libSQL vector operations.
 */

/**
 * Converts an array of numbers to Float32Array for libSQL vector storage.
 */
export function toFloat32Array(array: number[]): Float32Array {
  return new Float32Array(array)
}

/**
 * Converts Float32Array back to regular number array.
 */
export function fromFloat32Array(float32Array: Float32Array): number[] {
  return Array.from(float32Array)
}
