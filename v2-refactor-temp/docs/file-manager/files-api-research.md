# OpenAI / Google / Anthropic Files API 调研报告

> 调研时间：2026-04-18
> 资料来源：developers.openai.com、ai.google.dev、docs.claude.com（经 Context7 MCP / WebFetch 检索）

---

## 核心对比一览

| 维度 | **OpenAI** | **Google（Gemini Dev API）** | **Anthropic** |
|---|---|---|---|
| **状态** | GA | GA | **Beta**（`anthropic-beta: files-api-2025-04-14`） |
| **单文件上限** | 512 MB | 2 GB | 500 MB |
| **账号/项目总容量** | 2.5 TB / 项目 | 20 GB / 项目 | 500 GB / 组织 |
| **生命周期** | 默认永久，可选 `expires_after` | **48 小时自动删除**，不可续期 | 永久，需手动 `DELETE` |
| **存储计费** | 原始 Files 免费；Vector Store $0.10/GB·天 | **全免费** | **全免费** |
| **引用方式** | `file_id` / `file_url` / `file_data`（base64，≤32 MB） | `file_data.file_uri` / inline base64 | `source.type="file"` / `base64` / `url`（统一 block） |
| **purpose 分类** | 有（assistants/batch/fine-tune/vision/user_data/evals） | 无（单一池） | 无（单一池） |
| **跨能力复用** | 最强：Responses / Assistants / Batch / Fine-tune / Vision 共用 `file_id` | 主要服务 `generateContent` | Messages + Code Execution + Skills 双向闭环 |
| **特色能力** | Vector Store + File Search、Batch 产出回取 | 视频帧率 / 时间裁剪（`fps`/`start_offset`） | 与 Citations + Prompt Caching 深度协同、产出可下载 |
| **音视频原生** | 图像为主，音视频走专用模型 | ✅ 完整支持（MP4 / MP3 等） | ❌ 未明确支持，仅 PDF / 图像 / 文本 / 代码 |
| **多云可用** | N/A | Vertex AI 走 GCS URI，不用 Files API | **Bedrock / Vertex AI 不可用**（仅 Anthropic 第一方） |

### 一句话定位

- 🤖 **OpenAI**——**跨能力复用之王**：一个 `file_id` 在 Responses / Batch / Fine-tune / Vision 之间打通，`purpose` 强制分类带来秩序感。
- 🔷 **Google**——**音视频之王**：2 GB 超大单文件 + 视频时间戳裁剪，但 **48h 即焚**决定了它只适合"上传即用"场景。
- 🟣 **Anthropic**——**工程优雅之王**：统一 `source` 协议把 `file` 当作 `base64` / `url` 的平替，与 Citations / Prompt Caching / Skills 深度联动，但仍在 beta 且不支持音视频。

### 选型建议

| 场景 | 推荐 | 理由 |
|---|---|---|
| 长期知识库 / 跨会话复用 | Anthropic / OpenAI | 均持久；避开 Google 的 48h 过期 |
| 视频 / 音频理解 | Google | 几乎是唯一选择 |
| 一份数据跑多条流水线（在线 + Batch + 微调） | OpenAI | `purpose` 体系最顺手 |
| 带高质量引用的文档问答 | Anthropic | `document` + `citations.enabled` + `file_id` 组合最舒服 |
| 预算敏感 | Google / Anthropic | 存储全免费；OpenAI 的 Vector Store 按 GB·天收费 |

---

## 一、OpenAI Files API

### 1.1 基本端点

Base URL `https://api.openai.com`，需 `Authorization: Bearer $OPENAI_API_KEY`。

| 操作 | 方法 | 路径 |
|---|---|---|
| 上传文件 | `POST` | `/v1/files`（`multipart/form-data`，字段 `file` + `purpose`；可选 `expires_after`） |
| 列出文件 | `GET` | `/v1/files`（可按 `purpose` / `limit` / `order` / `after` 过滤） |
| 获取元数据 | `GET` | `/v1/files/{file_id}` |
| 下载内容 | `GET` | `/v1/files/{file_id}/content` |
| 删除文件 | `DELETE` | `/v1/files/{file_id}` |

File 对象典型字段：`id / object / bytes / created_at / expires_at / filename / purpose / status / status_details`。

### 1.2 purpose 参数

- `assistants`：供 Assistants API（`code_interpreter`、`file_search`）引用。
- `batch`：Batch API `.jsonl` 输入；产出 purpose 为 `batch_output`。
- `fine-tune`：微调训练集（`.jsonl`，符合 chat/completion 格式）。
- `vision`：Vision / Responses 图像输入（png/jpg/gif/webp）。
- `user_data`：Responses API 通用用户文档（PDF 等），也可作为 Prompt 模板变量。
- `evals`：Evals API 数据集（细节未完全确认）。
- 只读/系统产出：`batch_output`、`fine-tune-results`（不可手动上传）。

### 1.3 文件限制

- **单文件**：512 MB。
- **File Search 单文件 token**：≤ 5,000,000 tokens。
- **项目总容量**：2.5 TB；**组织层面无硬上限**。
- **支持格式**：File Search 类文本文档（pdf/md/docx/txt/html/代码）、Vision（png/jpg/gif/webp）、Batch/Fine-tune（jsonl）、Responses `input_file`（PDF 等）。

### 1.4 生命周期

- 默认 `expires_at: null`，文件**永久保留**，需手动 DELETE。
- 上传时可传 `expires_after`（相对 `created_at` 的秒数 anchor），到期自动删除。
- Batch 产出文件不会自动过期，需手动清理。
- Vector Store 是独立对象，有自己的 expiration 策略（供 File Search 使用）。

### 1.5 与其他能力的集成

- **Responses API（主推）**：`input_file { file_id }` / `input_image { file_id }`；也支持 `file_data`（base64 ≤32 MB）与 `file_url`。
- **Assistants API v2**：`file_search` 工具走 Vector Store 消费 `purpose=assistants` 的文件；`code_interpreter` 通过 message `attachments` 引用。**v1 已弃用**。
- **Batch API**：上传 `purpose=batch` 的 `.jsonl`，在 `/v1/batches` 用 `input_file_id` 引用，输出通过 `/v1/files/{output_file_id}/content` 下载。
- **Fine-tuning**：`purpose=fine-tune` 上传训练 / 验证集。
- **Vision / 图像生成**：`purpose=vision`，可做视觉模型输入或 image edit 源图。

### 1.6 计费

- Files API 原始对象存储**不单独计费**。
- **File Search / Vector Store**：$0.10 / GB·天，每组织前 1 GB 免费；工具调用 $2.50 / 1k calls。
- **ChatKit / Agent Kit 上传**：$0.10 / GB·天，每账号每月首 1 GB 免费。
- Fine-tune 训练数据训练期不单独计存储费，按 token 训练费计。

### 1.7 最简 SDK 示例

```python
from openai import OpenAI
client = OpenAI()

f = client.files.create(file=open("report.pdf", "rb"), purpose="user_data")
resp = client.responses.create(
    model="gpt-5",
    input=[{"role": "user", "content": [
        {"type": "input_text", "text": "总结这份 PDF"},
        {"type": "input_file", "file_id": f.id},
    ]}],
)
print(resp.output_text)
```

```javascript
import fs from "fs";
import OpenAI from "openai";
const openai = new OpenAI();

const f = await openai.files.create({
  file: fs.createReadStream("report.pdf"),
  purpose: "user_data",
});
const r = await openai.responses.create({
  model: "gpt-5",
  input: [{ role: "user", content: [
    { type: "input_text", text: "总结这份 PDF" },
    { type: "input_file", file_id: f.id },
  ]}],
});
console.log(r.output_text);
```

### 1.8 差异化亮点

- **一次上传、多端复用**：同一 `file_id` 可在 Responses / Assistants / Batch / Fine-tune / Vision 之间跨场景引用（受 purpose 约束），这是相较 Anthropic 与 Google 较少见的"长生命周期 + 跨能力"设计。
- **三种文件传递方式并存**：`file_id`（Files API）/ `file_url`（外链）/ `file_data`（base64 内联 ≤32 MB），开发者在"持久托管"与"一次性内联"之间可灵活选择。

### 1.9 未确认项

- `evals` purpose 的完整字段约束。
- 各 purpose 的精细 MIME 白名单。
- `expires_after` 的最大 / 最小秒数上限。

---

## 二、Google Gemini Files API

聚焦 **Gemini Developer API**（`generativelanguage.googleapis.com`）下的 Files service；末尾对比 Vertex AI。

### 2.1 基本端点（REST v1beta）

基址：`https://generativelanguage.googleapis.com`

| 操作 | 方法 | 路径 |
|---|---|---|
| 媒体上传（resumable） | `POST` | `/upload/v1beta/files` |
| 仅创建元数据 | `POST` | `/v1beta/files` |
| 列出文件 | `GET` | `/v1beta/files`（`pageSize` ≤ 100，默认 10） |
| 获取文件 | `GET` | `/v1beta/files/{name}` |
| 删除文件 | `DELETE` | `/v1beta/files/{name}` |
| 注册 GCS 对象 | `POST` | `/v1beta/files:register` |

文件资源字段：`name / displayName / mimeType / sizeBytes / uri / state（PROCESSING / ACTIVE / FAILED）/ expirationTime / sha256Hash / videoMetadata`。

### 2.2 上传协议

- **Resumable upload（推荐）**：三步协议，`X-Goog-Upload-Protocol: resumable` + `X-Goog-Upload-Command: start/upload, finalize` 头。SDK `files.upload` 底层即此。
- **Inline（base64 `inlineData`）**：字节直接放进 `generateContent.contents`。
- **选择门槛**：
  - 图片：请求总大小 ≤ 20 MB 用 inline，否则走 Files API。
  - PDF：小文档 / 一次性用 inline，较大或复用走 Files API（无明确 MB 阈值）。
  - 视频：&lt;1 分钟可 inline，&gt;100 MB 或 10 分钟以上**强制** Files API。

### 2.3 文件限制

- 单文件 **2 GB**；项目总存储 **20 GB**。
- **PDF**：单文件 ≤ 50 MB 且 ≤ 1000 页；每页 **258 tokens**。
- **图片 MIME**：`image/png`、`image/jpeg`、`image/webp`、`image/heic`、`image/heif`。
- **视频 MIME**：MP4、MPEG、MOV、AVI、FLV、MPG、WebM、WMV、3GPP。
- **音频**：约 **32 tokens/秒**（完整 MIME 列表未完全确认）。
- 普通 `generateContent` 请求总 payload ≤ 100 MB。

### 2.4 生命周期与 TTL

- **48 小时自动删除**：存储 48 小时后自动清理；期间可读元数据但下载受限。
- `expirationTime` 字段标注过期时刻。
- **不支持延长 / 续期**。长期保存请走 GCS（Vertex AI）或重新上传。

### 2.5 与 generateContent 的集成

在 `contents.parts` 中通过 `file_data` 引用：

```json
{"file_data": {"mime_type": "video/mp4", "file_uri": "files/abc-123"}}
```

**视频特殊点**：
- 上传后 `state` 先为 `PROCESSING`，需轮询至 `ACTIVE` 才能推理。
- `videoMetadata` 可传 `fps` / `start_offset` / `end_offset`；Prompt 内用 `MM:SS` 引用时间戳。
- 默认 1 FPS 抽帧；默认分辨率约 300 tokens/秒，低分辨率 100 tokens/秒；单帧标准分辨率 258 tokens。
- 1M context 模型可处理默认分辨率 1 小时视频，低分辨率 3 小时。

### 2.6 计费

- **Files API 本身免费**：所有可用区域存储均不收费。
- 输入 token 按模型实际消耗计价（PDF 258 tokens/页；视频按秒；图片按分辨率 tile）。

### 2.7 最简 SDK 示例（新 SDK `google-genai`）

```python
from google import genai

client = genai.Client(api_key="YOUR_KEY")

my_file = client.files.upload(file="sample.pdf")

resp = client.models.generate_content(
    model="gemini-2.5-pro",
    contents=["请总结这份文档", my_file],
)
print(resp.text)

for f in client.files.list():
    print(f.name, f.state)
client.files.delete(name=my_file.name)
```

```javascript
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const uploaded = await ai.files.upload({
  file: "sample.mp3",
  config: { mimeType: "audio/mpeg" },
});

const resp = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: createUserContent([
    "转写这段音频",
    createPartFromUri(uploaded.uri, uploaded.mimeType),
  ]),
});
console.log(resp.text);
```

> 旧的 `google-generativeai` 已进入维护模式；新项目请用 `google-genai`（Python）/ `@google/genai`（Node）。

### 2.8 Vertex AI 对比

Vertex AI **没有独立 Files API**，文件引用通过：
- **GCS `gs://` URI**（主流方式）：公开可读或同项目。
- **inline base64 `fileData`**。
- **公网 HTTP(S) URL**。
- Vertex AI Studio 控制台直传（最大 7 MB）。

因此生产上 Vertex AI 侧的"Files"等价于 GCS 生命周期管理（用户自管 TTL、权限、计费），不存在 48 小时自动过期；Gemini Developer API 的 Files 则是托管式、免费但 48h 即焚的临时存储。

---

## 三、Anthropic Files API

### 3.1 当前状态与 Beta Header

Files API 仍处于 **beta 阶段**，未 GA。调用任一端点需携带：

```
anthropic-beta: files-api-2025-04-14
anthropic-version: 2023-06-01
```

Messages 中引用 `file_id` 时同样需要此 beta header。**不适用于 ZDR**，且在 **Amazon Bedrock / Google Vertex AI 上不可用**。

### 3.2 基本端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/files` | 上传（`multipart/form-data`，字段 `file`） |
| `GET` | `/v1/files` | 分页列出当前 workspace 的文件 |
| `GET` | `/v1/files/{file_id}` | 获取元数据（`id / filename / mime_type / size_bytes / created_at / type / downloadable`，可选 `scope`） |
| `GET` | `/v1/files/{file_id}/content` | 下载文件内容（**仅限** Skills / Code Execution 产出；用户上传文件不可回取） |
| `DELETE` | `/v1/files/{file_id}` | 删除（不可恢复） |

### 3.3 文件限制与 MIME

- **单文件**：500 MB。
- **组织总容量**：500 GB。
- **速率限制（beta 期）**：约 100 req/min。
- **支持 MIME**：
  - `application/pdf` → `document` block
  - `text/plain` → `document` block
  - `image/jpeg` / `image/png` / `image/gif` / `image/webp` → `image` block
  - Code Execution 支持的数据集（CSV / XLSX / DOCX 等）→ `container_upload` block
- **音视频**：Files API 页**未列出**原生音视频类型，仅视觉与 Code Execution 场景。音视频支持未确认。
- 不支持作为 `document` 直传的格式（.csv / .md / .docx / .xlsx）建议先转 PDF 或纯文本。

### 3.4 生命周期

- **持久存储**：文件一直存在，直到显式 `DELETE`。
- 作用域为 API key 所属 **workspace**，同 workspace 其他 key 可共享。
- 删除后极短时间内进行中的 Messages 调用仍可能可读，之后按 Anthropic 数据保留策略清除。
- **无自动过期**（与 OpenAI `expires_after`、Google 48h TTL 不同）。

### 3.5 与 Messages API 的集成

`source.type = "file"` 替代 `base64` / `url`：

```json
{ "type": "document",
  "source": { "type": "file", "file_id": "file_011C..." },
  "title": "...", "context": "...",
  "citations": { "enabled": true } }
```

```json
{ "type": "image",
  "source": { "type": "file", "file_id": "file_011C..." } }
```

- **base64**：每次请求重编码、吃带宽。
- **url**：需可公开访问。
- **file**：只传一次、跨请求复用，天然适合 Prompt Caching（同 `file_id` 哈希稳定，命中率高）。
- **Code Execution Tool** 与 **Skills** 双向：既消费 Files 作为输入，又产出 Files（图表、CSV），可通过 `/content` 下载。
- **Computer Use** 不直接消费 `file_id`（截图走 tool_result 的 image block），是否有直接消费路径未确认。

### 3.6 计费

- **存储 / 上传 / 下载 / 列举 / 元数据 / 删除：全免费**。
- 文件真正进入 Messages 请求时，内容按**普通输入 token** 计价。
- 与 **Prompt Caching** 组合：把大型 PDF / 图像放进带 `cache_control` 的 block，配合稳定 `file_id`，可大幅降低重复请求的 token 成本。

### 3.7 最简 SDK 示例

```python
from anthropic import Anthropic
client = Anthropic()
up = client.beta.files.upload(
    file=("doc.pdf", open("doc.pdf", "rb"), "application/pdf"),
)
resp = client.beta.messages.create(
    model="claude-opus-4-7", max_tokens=1024,
    betas=["files-api-2025-04-14"],
    messages=[{"role": "user", "content": [
        {"type": "text", "text": "总结这份文档"},
        {"type": "document", "source": {"type": "file", "file_id": up.id}},
    ]}],
)
```

```javascript
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import fs from "fs";
const anthropic = new Anthropic();
const up = await anthropic.beta.files.upload({
  file: await toFile(fs.createReadStream("doc.pdf"), undefined, { type: "application/pdf" }),
  betas: ["files-api-2025-04-14"],
});
const resp = await anthropic.beta.messages.create({
  model: "claude-opus-4-7", max_tokens: 1024, betas: ["files-api-2025-04-14"],
  messages: [{ role: "user", content: [
    { type: "text", text: "总结这份文档" },
    { type: "document", source: { type: "file", file_id: up.id } },
  ]}],
});
```

### 3.8 差异化亮点

- **统一 content block 抽象**：同一 `source` 协议把 `base64` / `url` / `file` 视为可互换子类型，前端代码几乎无需改动即可从"嵌入式"升级为"引用式"；比 OpenAI 的 `file_id` 与 `image_url` 混合模型更一致。
- **与 Skills / Code Execution 的双向打通**：既能上传给模型读，Code Execution 产出的图表 / 数据也以 `file_id` 回流并可 `/content` 下载——形成"上传 → 分析 → 产出 → 下载"闭环；OpenAI 的 Code Interpreter 回取需走 assistants/thread 链路，路径更长。
- **Citations 与 Prompt Caching 协同**：`document` block 内建 `citations.enabled`，配合 `file_id` 产生稳定字符 / 页码级引用；Prompt Caching 命中率相比重复 base64 显著更高。
- **持久 + 无过期**：对比 OpenAI Assistants 默认生命周期语义与 Google 的 48h 自动过期，对常驻知识库 / 跨会话引用更友好。
- **上传 / 存储完全免费**：只在推理时按 token 计费，商业模型透明。

### 3.9 未确认项

- 音视频原生支持。
- Computer Use 是否直接消费 `file_id`。

---

## 参考来源

### OpenAI
- https://platform.openai.com/docs/api-reference/files
- https://platform.openai.com/docs/assistants/tools/file-search
- https://developers.openai.com（Context7 索引）

### Google
- https://ai.google.dev/gemini-api/docs/files
- https://ai.google.dev/api/files
- https://ai.google.dev/gemini-api/docs/video-understanding
- https://ai.google.dev/gemini-api/docs/document-processing
- https://ai.google.dev/gemini-api/docs/image-understanding
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/send-multimodal-prompts

### Anthropic
- https://docs.claude.com/en/docs/build-with-claude/files
- https://docs.claude.com/en/api/files-create
- anthropic-sdk-python / anthropic-sdk-typescript 仓库文档
