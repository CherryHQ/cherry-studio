// 针对OpenAI API的类型定义
declare namespace OpenAI {
  namespace Completions {
    interface CompletionUsage {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
  }

  namespace Models {
    interface Model {
      id: string
      object: string
      created: number
      owned_by: string
    }
  }
}
