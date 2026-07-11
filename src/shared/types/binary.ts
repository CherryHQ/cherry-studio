export type BinaryResolution =
  | { source: 'managed'; path: string; version: string }
  | { source: 'bundled'; path: string; version?: string }
  | { source: 'system'; path: string }
  | { source: 'none' }

export type BinaryResolutions = Record<string, BinaryResolution>
