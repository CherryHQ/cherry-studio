export type OpenRouterProviderOptions = {
  models?: string[]

  /**
   * https://openrouter.ai/docs/use-cases/reasoning-tokens
   * One of `max_tokens` or `effort` is required.
   * If `exclude` is true, reasoning will be removed from the response. Default is false.
   */
  reasoning?: {
    exclude?: boolean
  } & (
    | {
        max_tokens: number
      }
    | {
        effort: 'high' | 'medium' | 'low'
      }
  )

  /**
   * A unique identifier representing your end-user, which can
   * help OpenRouter to monitor and detect abuse.
   */
  user?: string

  extraBody?: Record<string, unknown>

  /**
   * Enable usage accounting to get detailed token usage information.
   * https://openrouter.ai/docs/use-cases/usage-accounting
   */
  usage?: {
    /**
     * When true, includes token usage information in the response.
     */
    include: boolean
  }
}
