import type { JsonValue } from 'e2e'

declare global {
  interface Window {
    api: {
      preference: {
        get(key: string): Promise<JsonValue>
        set(key: string, value: unknown): Promise<void>
        setMultiple(values: Record<string, unknown>): Promise<void>
      }
      dataApi: {
        request(input: {
          id: string
          method: string
          path: string
          body?: unknown
        }): Promise<{ status: number; data: JsonValue }>
      }
    }
  }
}
