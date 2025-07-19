export const VOYAGE_SUPPORTED_DIM_MODELS = ['voyage-3-large', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-code-3']

export const OPENAI_SUPPORTED_DIM_MODELS = ['text-embedding-3-small', 'text-embedding-3-large']

export const DASHSCOPE_SUPPORTED_DIM_MODELS = ['text-embedding-v3', 'text-embedding-v4']

export const OPENSOURCE_SUPPORTED_DIM_MODELS = ['qwen3-embedding-0.6b', 'qwen3-embedding-4b', 'qwen3-embedding-8b']

// google ai embedding api 的 outputDimensionality 用于截断向量，可以认为所有 google 的嵌入模型都支持设置该参数
export const GOOGLE_SUPPORTED_DIM_MODELS = ['gemini-embedding-exp-03-07', 'gemini-embedding-exp', 'text-embedding-004']

/** 支持设置嵌入维度的嵌入模型 */
export const SUPPORTED_DIM_MODELS = [
  ...VOYAGE_SUPPORTED_DIM_MODELS,
  ...OPENAI_SUPPORTED_DIM_MODELS,
  ...DASHSCOPE_SUPPORTED_DIM_MODELS,
  ...OPENSOURCE_SUPPORTED_DIM_MODELS,
  ...GOOGLE_SUPPORTED_DIM_MODELS
] as const

// 对qwen3 embedding 做特别检查来避免vllm不支持qwen3 dimensions参数的问题
export const EMBEDDING_MODEL_DEFAULT_DIMS: Record<string, number> = {
  'qwen3-embedding-0.6b': 1024,
  'qwen3-embedding-4b': 2560,
  'qwen3-embedding-8b': 4096 // https://qwenlm.github.io/zh/blog/qwen3-embedding/
} as const

/**
 * 从模型 ID 中提取基础名称。
 * 例如：
 * - 'deepseek/deepseek-r1' => 'deepseek-r1'
 * - 'deepseek-ai/deepseek/deepseek-r1' => 'deepseek-r1'
 * @param {string} id 模型 ID
 * @param {string} [delimiter='/'] 分隔符，默认为 '/'
 * @returns {string} 基础名称
 */
const getBaseModelName = (id: string, delimiter: string = '/'): string => {
  const parts = id.split(delimiter)
  return parts[parts.length - 1]
}

/**
 * 从模型 ID 中提取基础名称并转换为小写。
 * 例如：
 * - 'deepseek/DeepSeek-R1' => 'deepseek-r1'
 * - 'deepseek-ai/deepseek/DeepSeek-R1' => 'deepseek-r1'
 * @param {string} id 模型 ID
 * @param {string} [delimiter='/'] 分隔符，默认为 '/'
 * @returns {string} 小写的基础名称
 */
export const getLowerBaseModelName = (id: string, delimiter: string = '/'): string => {
  return getBaseModelName(id, delimiter).toLowerCase()
}
