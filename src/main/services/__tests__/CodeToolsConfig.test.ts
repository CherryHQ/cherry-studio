import { buildOpenAICodexConfigParams } from '../CodeToolsConfig'

describe('buildOpenAICodexConfigParams', () => {
  it('uses the built-in openai provider config without overriding reserved IDs', () => {
    const configParams = buildOpenAICodexConfigParams({
      providerId: 'openai',
      providerName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1/',
      model: 'gpt-5-codex'
    })

    expect(configParams).toContain('--config model_provider="openai"')
    expect(configParams).toContain('--config openai_base_url="https://api.openai.com/v1"')
    expect(configParams).toContain('--config model="gpt-5-codex"')
    expect(configParams).not.toContain('model_providers.openai')
  })

  it('keeps custom providers in model_providers config', () => {
    const configParams = buildOpenAICodexConfigParams({
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1/',
      model: 'openai/gpt-5'
    })

    expect(configParams).toContain('--config model_provider="openrouter"')
    expect(configParams).toContain('--config model_providers.openrouter.name="OpenRouter"')
    expect(configParams).toContain('--config model_providers.openrouter.base_url="https://openrouter.ai/api/v1"')
    expect(configParams).toContain('--config model_providers.openrouter.env_key="OPENAI_API_KEY"')
    expect(configParams).toContain('--config model_providers.openrouter.wire_api="responses"')
    expect(configParams).toContain('--config model="openai/gpt-5"')
  })
})
