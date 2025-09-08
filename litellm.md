# Vertex AI SDK - LiteLLM 直通（Pass-through）端点文档

本指南介绍如何通过 LiteLLM Proxy 使用 Vertex AI 的原生 API（不做请求/响应转换），包括功能支持、端点说明、鉴权方式、示例与进阶用法。

## 功能概览

- 成本追踪：✅ 支持 /generateContent 端点的所有模型
- 日志记录：✅ 适用于所有集成
- 终端用户追踪：❌ 如需此功能请告知
- 流式输出：✅

## 支持的直通端点

- /vertex_ai → 路由至 https://{vertex_location}-aiplatform.googleapis.com/
- /vertex_ai/discovery → 路由至 https://discoveryengine.googleapis.com

## 使用方式

将原始 Vertex AI 域名替换为 LiteLLM Proxy 直通路由：

- 原始：https://REGION-aiplatform.googleapis.com
- 替换为：${LITELLM_PROXY_BASE_URL}/vertex_ai

示例：
- 原始 Vertex 路径：/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/${MODEL_ID}:generateContent
- 直通路径：/vertex_ai/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/${MODEL_ID}:generateContent

## 鉴权与凭证传递模式

LiteLLM 支持 3 种将请求直通到 Vertex AI 的凭证流转方式：

1. 指定项目/区域凭证（Specific Credentials）
   - 管理员为特定 project/region 配置直通凭证。
2. 默认凭证（Default Credentials）
   - 管理员配置默认凭证。
3. 客户端凭证（Client-Side Credentials，默认）
   - 若找不到默认或映射凭证，直接将客户端传来的凭证透传给 Vertex AI。

### 在 model_list 中为特定项目/区域启用直通

```yaml
model_list:
  - model_name: gemini-1.0-pro
    litellm_params:
      model: vertex_ai/gemini-1.0-pro
      vertex_project: adroit-crow-413218
      vertex_region: us-central1
      vertex_credentials: /path/to/credentials.json
      use_in_pass_through: true # 👈 关键开关
```

## 快速开始

1) 配置 Vertex AI 凭证环境变量

```bash
export DEFAULT_VERTEXAI_PROJECT="" # 例如 "adroit-crow-413218"
export DEFAULT_VERTEXAI_LOCATION="" # 例如 "us-central1"
export DEFAULT_GOOGLE_APPLICATION_CREDENTIALS="" # 例如 "/Users/Downloads/adroit-crow-413218-a956eef1a2a8.json"
```

2) 启动 LiteLLM Proxy

```bash
litellm
# RUNNING on http://0.0.0.0:4000
```

3) 测试 Generate Content（Gemini）

```bash
curl http://localhost:4000/vertex-ai/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/gemini-1.0-pro:generateContent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-1234" \
  -d '{
    "contents":[{
      "role": "user",
      "parts":[{"text": "How are you doing today?"}]
    }]
  }'
```

或使用 x-litellm-api-key 头：

```bash
curl http://localhost:4000/vertex_ai/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/${MODEL_ID}:generateContent \
  -H "Content-Type: application/json" \
  -H "x-litellm-api-key: Bearer sk-1234" \
  -d '{
    "contents":[{
      "role": "user", 
      "parts":[{"text": "How are you doing today?"}]
    }]
  }'
```

注意：上述两种鉴权头部二选一，视你的 Proxy 配置而定。

## 支持的 API 端点

- Gemini API
- Embeddings API
- Imagen API
- Code Completion API
- Batch prediction API
- Tuning API
- CountTokens API

## 鉴权到 Vertex AI 的两种方式

1) 客户端侧透传 Vertex 凭证到 Proxy Server  
2) 在 Proxy Server 上设置 Vertex AI 凭证（默认/映射到指定 project/region）

## 使用示例

### Gemini API（Generate Content）

```bash
curl http://localhost:4000/vertex_ai/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/gemini-1.5-flash-001:generateContent \
  -H "Content-Type: application/json" \
  -H "x-litellm-api-key: Bearer sk-1234" \
  -d '{"contents":[{"role": "user", "parts":[{"text": "hi"}]}]}'
```

### Embeddings API

```bash
curl http://localhost:4000/vertex_ai/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/textembedding-gecko@001:predict \
  -H "Content-Type: application/json" \
  -H "x-litellm-api-key: Bearer sk-1234" \
  -d '{"instances":[{"content": "gm"}]}'
```

### Imagen API

```bash
curl http://localhost:4000/vertex_ai/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/imagen-3.0-generate-001:predict \
  -H "Content-Type: application/json" \
  -H "x-litellm-api-key: Bearer sk-1234" \
  -d '{"instances":[{"prompt": "make an otter"}], "parameters": {"sampleCount": 1}}'
```

### Count Tokens API

```bash
curl http://localhost:4000/vertex_ai/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/gemini-1.5-flash-001:countTokens \
  -H "Content-Type: application/json" \
  -H "x-litellm-api-key: Bearer sk-1234" \
  -d '{"contents":[{"role": "user", "parts":[{"text": "hi"}]}]}'
```

### Tuning API

创建微调任务（Fine Tuning Job）：

```bash
curl http://localhost:4000/vertex_ai/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/gemini-1.5-flash-001:tuningJobs \
  -H "Content-Type: application/json" \
  -H "x-litellm-api-key: Bearer sk-1234" \
  -d '{
    "baseModel": "gemini-1.0-pro-002",
    "supervisedTuningSpec" : {
      "training_dataset_uri": "gs://cloud-samples-data/ai-platform/generative_ai/sft_train_data.jsonl"
    }
  }'
```

## 进阶用法

### 1) 搭配数据库与虚拟密钥（Virtual Keys）

用途：在不暴露上游（如 Anthropic/Vertex）真实 API Key 的情况下，为内部开发者提供可控访问。

- 环境变量

```bash
export DATABASE_URL=""
export LITELLM_MASTER_KEY=""

# Vertex AI 凭证
export DEFAULT_VERTEXAI_PROJECT="" # 例如 "adroit-crow-413218"
export DEFAULT_VERTEXAI_LOCATION="" # 例如 "us-central1"
export DEFAULT_GOOGLE_APPLICATION_CREDENTIALS="" # 例如 "/Users/Downloads/adroit-crow-413218-a956eef1a2a8.json"
```

- 启动 Proxy

```bash
litellm
# RUNNING on http://0.0.0.0:4000
```

- 生成虚拟 Key

```bash
curl -X POST 'http://0.0.0.0:4000/key/generate' \
  -H 'x-litellm-api-key: Bearer sk-1234' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

- 期望返回

```json
{
  "...": "...",
  "key": "sk-1234ewknldferwedojwojw"
}
```

- 使用虚拟 Key 调用

```bash
curl http://localhost:4000/vertex_ai/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/gemini-1.0-pro:generateContent \
  -H "Content-Type: application/json" \
  -H "x-litellm-api-key: Bearer sk-1234" \
  -d '{
    "contents":[{
      "role": "user", 
      "parts":[{"text": "How are you doing today?"}]
    }]
  }'
```

### 2) 发送标签到 LiteLLM（用于 DB 与日志回调追踪）

通过请求头 tags（逗号分隔）传递标签：

- 示例标签效果：["vertex-js-sdk", "pass-through-endpoint"]

```bash
curl http://localhost:4000/vertex_ai/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/gemini-1.0-pro:generateContent \
  -H "Content-Type: application/json" \
  -H "x-litellm-api-key: Bearer sk-1234" \
  -H "tags: vertex-js-sdk,pass-through-endpoint" \
  -d '{
    "contents":[{
      "role": "user", 
      "parts":[{"text": "How are you doing today?"}]
    }]
  }'
```

## 备注与建议

- 确保 Proxy 有合适的默认凭证，或明确开启 use_in_pass_through 并指定 vertex_project/vertex_region/vertex_credentials，以避免请求透传失败。
- x-litellm-api-key 与 Authorization 两种头部二选一，统一团队规范即可。
- 调用路径保持与原生 Vertex AI 完全一致，仅需替换域名为 /vertex_ai 直通路由。
- 若需终端用户追踪（End-user Tracking），请与维护者联系以评估支持。