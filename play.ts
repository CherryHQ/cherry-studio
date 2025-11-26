import Anthropic from '@anthropic-ai/sdk'

const ai = new Anthropic({
  baseURL: 'https://api.siliconflow.cn/abc',
  apiKey: 'sk-ehmixccsprlnudpgdwjwcwltbasallqatlmbjfzkeajhqqtb'
})

ai.messages.create(
  {
    max_tokens: 1024,
    model: 'deepseek-ai/DeepSeek-V3.1-Terminus',
    messages: [
      {
        role: 'user',
        content: 'hello'
      }
    ]
  },
  {}
)
