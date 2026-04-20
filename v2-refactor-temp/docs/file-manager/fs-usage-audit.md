# Main Process `fs` Usage Audit

> 追踪 `src/main/` 中所有直接使用 Node.js `fs` 模块的文件，
> 为 File Manager 统一封装提供迁移依据。
>
> - **生成日期**: 2026-04-06
> - **分析范围**: `src/main/` 下非测试文件（测试文件单独列出）

## 图例

| 标记 | 含义 |
|------|------|
| `sync` | 使用同步 API（`readFileSync` 等） |
| `async` | 使用异步/Promise API（`fs/promises`、回调） |
| `stream` | 使用流 API（`createReadStream` 等） |
| `watch` | 使用文件监听（`watch`/`watchFile`） |
| `stat` | 使用 `stat`/`lstat`/`access` 等元数据 API |
| `dir` | 使用目录操作（`mkdir`/`readdir`/`rmdir`） |
| `rw` | 使用读写操作（`readFile`/`writeFile`） |
| `del` | 使用删除操作（`unlink`/`rm`） |
| `copy` | 使用复制/重命名（`copyFile`/`rename`） |

---

## 1. Utils（`src/main/utils/`）

### `utils/index.ts`
- **Import**: `import fs from 'node:fs'`, `import fsAsync from 'node:fs/promises'`
- **Tags**: `sync` `async` `rw` `stat` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 创建前检查数据目录是否存在 |
| `fs.mkdirSync()` | 同步 | 递归创建数据目录 |
| `fsAsync.readdir()` | 异步 | 列出目录内容用于计算大小 |
| `fsAsync.stat()` | 异步 | 获取文件/目录元数据用于计算大小 |

### `utils/file.ts`
- **Import**: `import * as fs from 'node:fs'`, `import { readFile } from 'node:fs/promises'`
- **Tags**: `sync` `async` `rw` `stat` `dir` `del` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.readdirSync()` | 同步 | 递归扫描目录查找匹配文件 |
| `fs.statSync()` | 同步 | 获取文件信息以判断是目录还是文件 |
| `fs.existsSync()` | 同步 | 检查笔记目录是否存在 |
| `fs.mkdirSync()` | 同步 | 递归创建笔记目录 |
| `fs.promises.access()` | 异步 | 检查目录的写权限 |
| `readFile()` | 异步 | 自动检测编码并读取文本文件内容 |
| `fs.promises.open()` | 异步 | 打开锁文件用于原子写入操作 |
| `fs.promises.writeFile()` | 异步 | 写入文件内容（原子或非原子） |
| `fs.promises.rename()` | 异步 | 将临时文件重命名为最终文件名（原子写入） |
| `fs.promises.unlink()` | 异步 | 删除锁文件或临时文件 |
| `fs.promises.stat()` | 异步 | 获取文件信息以检查锁的过期状态 |
| `fs.promises.readFile()` | 异步 | 读取二进制文件用于 base64 编码 |
| `fs.promises.readdir()` | 异步 | 读取目录条目（含文件类型信息） |

### `utils/fileOperations.ts`
- **Import**: `import * as fs from 'node:fs'`
- **Tags**: `async` `copy` `del` `dir` `rw` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.lstat()` | 异步 | 获取文件信息以检测符号链接（不跟随） |
| `fs.promises.mkdir()` | 异步 | 递归创建目标目录 |
| `fs.promises.readdir()` | 异步 | 列出目录条目（含文件类型信息） |
| `fs.promises.copyFile()` | 异步 | 复制单个文件 |
| `fs.promises.chmod()` | 异步 | 复制后保留文件权限 |
| `fs.promises.rm()` | 异步 | 强制递归删除目录 |

### `utils/init.ts`
- **Import**: `import * as fs from 'node:fs'`
- **Tags**: `sync` `rw` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.accessSync()` | 同步 | 检查目录的写权限 |
| `fs.existsSync()` | 同步 | 读取前检查配置文件是否存在 |
| `fs.readFileSync()` | 同步 | 同步读取 config.json 文件 |
| `fs.mkdirSync()` | 同步 | 递归创建配置目录 |
| `fs.writeFileSync()` | 同步 | 同步写入 config.json 文件 |

### `utils/process.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查 git 可执行文件是否存在 |
| `fs.existsSync()` | 同步 | 检查二进制目录是否存在 |

### `utils/rtk.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `rw` `stat` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查打包的/已安装的 rtk 二进制文件是否存在 |
| `fs.mkdirSync()` | 同步 | 递归创建用户 bin 目录 |
| `fs.readFileSync()` | 同步 | 读取版本文件内容 |
| `fs.copyFileSync()` | 同步 | 从打包目录复制 rtk 二进制到用户 bin 目录 |
| `fs.chmodSync()` | 同步 | 设置复制后二进制的可执行权限（仅 Unix） |
| `fs.writeFileSync()` | 同步 | 写入版本文件以记录已安装版本 |

### `utils/ocr.ts`
- **Import**: `import { readFile } from 'fs/promises'`
- **Tags**: `async` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `readFile()` | 异步 | 读取图片文件到 buffer 用于预处理 |

### `utils/markdownParser.ts`
- **Import**: `import * as fs from 'fs'`
- **Tags**: `async` `rw` `stat` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.stat()` | 异步 | 检查技能 markdown 文件是否存在并获取信息 |
| `fs.promises.readFile()` | 异步 | 读取 markdown 文件内容用于解析 |
| `fs.promises.readdir()` | 异步 | 列出目录条目用于技能发现 |

### `utils/builtinSkills.ts`
- **Import**: `import fs from 'node:fs/promises'`
- **Tags**: `async` `rw` `dir` `copy` `del` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.access()` | 异步 | 检查资源技能目录是否可访问 |
| `fs.readdir()` | 异步 | 列出内置技能目录 |
| `fs.mkdir()` | 异步 | 创建全局技能目录和符号链接父目录 |
| `fs.cp()` | 异步 | 递归复制技能目录（从资源到存储） |
| `fs.writeFile()` | 异步 | 写入版本文件以追踪已安装的 app 版本 |
| `fs.readlink()` | 异步 | 检查现有符号链接的目标 |
| `fs.rm()` | 异步 | 移除错误的符号链接或过期条目 |
| `fs.symlink()` | 异步 | 创建 junction 符号链接用于技能发现 |
| `fs.readFile()` | 异步 | 读取 SKILL.md 文件用于哈希计算 |

---

## 2. Services（`src/main/services/`，非 agent）

### `services/AppService.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `async` `dir` `rw` `del` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.access()` | 异步 | mkdir 前检查路径是否存在 |
| `fs.promises.mkdir()` | 异步 | 递归创建自启动目录 |
| `fs.promises.writeFile()` | 异步 | 写入 Linux 自启动 desktop 文件 |
| `fs.promises.unlink()` | 异步 | 登出时删除 desktop 文件 |

### `services/FileSystemService.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.readFile()` | 异步 | 按可选编码读取文件 |

### `services/FileStorage.ts`
- **Import**: `import * as fs from 'fs'`, `import { writeFileSync } from 'fs'`, `import { readFile } from 'fs/promises'`
- **Tags**: `sync` `async` `stream` `stat` `rw` `del` `copy` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查临时/存储目录路径是否存在 |
| `fs.mkdirSync()` | 同步 | 创建临时/存储/笔记目录 |
| `fs.createReadStream()` | 流 | 创建可读流用于文件哈希 |
| `fs.statSync()` | 同步 | 获取文件信息（大小、创建时间）用于去重 |
| `fs.promises.readdir()` | 异步 | 列出存储目录中的文件 |
| `fs.promises.copyFile()` | 异步 | 复制文件（压缩图片或直接复制） |
| `fs.promises.stat()` | 异步 | 获取文件元数据 |
| `fs.promises.unlink()` | 异步 | 删除单个文件 |
| `fs.promises.rm()` | 异步 | 递归删除目录 |
| `fs.promises.rename()` | 异步 | 重命名/移动文件和目录 |
| `fs.promises.mkdir()` | 异步 | 递归创建目录 |
| `fs.readFileSync()` | 同步 | 同步读取文本文件内容 |
| `fs.promises.readFile()` | 异步 | 以 buffer 或指定编码读取文件 |
| `fs.promises.writeFile()` | 异步 | 写入文件内容（base64 图片、buffer） |
| `fs.accessSync()` | 同步 | 检查文件访问权限 |

### `services/CopilotService.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `async` `rw` `dir` `del` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查 token 文件或目录是否存在 |
| `fs.promises.mkdir()` | 异步 | 创建 token 存储目录 |
| `fs.promises.writeFile()` | 异步 | 保存加密的 Copilot token |
| `fs.promises.readFile()` | 异步 | 读取加密的 token 文件 |
| `fs.promises.access()` | 异步 | 删除前检查 token 文件是否存在 |
| `fs.promises.unlink()` | 异步 | 登出时删除 token 文件 |

### `services/ObsidianVaultService.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `stat` `dir` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查配置/仓库路径是否存在 |
| `fs.readFileSync()` | 同步 | 读取 Obsidian 配置 JSON 文件 |
| `fs.statSync()` | 同步 | 检查仓库路径是否为目录 |
| `fs.readdirSync()` | 同步 | 列出目录内容（含文件类型信息） |

### `services/OpenClawService.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `del` `rw` `dir` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查二进制/配置/符号链接路径是否存在 |
| `fs.unlinkSync()` | 同步 | 删除符号链接、二进制和配置文件 |
| `fs.rmSync()` | 同步 | 递归删除目录 |
| `fs.readFileSync()` | 同步 | 读取配置 JSON 文件 |
| `fs.writeFileSync()` | 同步 | 保存配置 JSON 文件 |
| `fs.mkdirSync()` | 同步 | 创建配置目录 |
| `fs.renameSync()` | 同步 | 重命名配置文件（备份和恢复） |

### `services/KnowledgeService.ts`
- **Import**: `import * as fs from 'node:fs'`
- **Tags**: `sync` `del` `dir` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查存储目录和待删除文件是否存在 |
| `fs.mkdirSync()` | 同步 | 创建知识库存储目录 |
| `fs.rmSync()` | 同步 | 递归删除知识库目录 |
| `fs.readFileSync()` | 同步 | 读取待删除列表文件 |
| `fs.writeFileSync()` | 同步 | 写入待删除列表文件 |
| `fs.unlinkSync()` | 同步 | 删除待删除记录文件 |

### `services/AnthropicService.ts`
- **Import**: `import { promises } from 'fs'`
- **Tags**: `async` `rw` `del` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `promises.mkdir()` | 异步 | 创建 OAuth 配置目录 |
| `promises.writeFile()` | 异步 | 保存 OAuth 凭证到文件 |
| `promises.readFile()` | 异步 | 读取 OAuth 凭证文件 |
| `promises.chmod()` | 异步 | 设置文件权限（0o600）确保安全 |
| `promises.unlink()` | 异步 | 删除凭证文件 |

### `services/CodeCliService.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `rw` `dir` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查配置/二进制/目录是否存在 |
| `fs.readFileSync()` | 同步 | 读取配置文件和 manifest JSON |
| `fs.writeFileSync()` | 同步 | 写入配置文件和 manifest |
| `fs.mkdirSync()` | 同步 | 创建日志和临时目录 |
| `fs.chmodSync()` | 同步 | 设置批处理文件的可执行权限 |
| `fs.unlinkSync()` | 同步 | 删除临时文件 |

### `services/ProtocolClient.ts`
- **Import**: `import fs from 'node:fs/promises'`
- **Tags**: `async` `rw` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.mkdir()` | 异步 | 创建 .local/share/applications 目录 |
| `fs.writeFile()` | 异步 | 写入 desktop 文件用于深度链接 |

### `services/SpanCacheService.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `del` `dir` `rw` `stat` `stream`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.rm()` | 异步 | 递归删除 trace 文件和目录 |
| `fs.readdir()` | 异步 | 列出 topic 目录中的 trace 文件 |
| `fs.mkdir()` | 异步 | 创建 trace 目录 |
| `fs.access()` | 异步 | 检查 trace 文件是否存在 |
| `fs.appendFile()` | 异步 | 追加 span 数据到 trace 文件 |
| `fs.open()` | 异步 | 打开 trace 文件用于流式读取 |

### `services/VersionService.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `stat` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查版本日志文件是否存在 |
| `fs.statSync()` | 同步 | 获取文件大小用于部分读取 |
| `fs.openSync()` | 同步 | 打开文件进行底层读取 |
| `fs.readSync()` | 同步 | 从文件末尾读取最后 1KB |
| `fs.closeSync()` | 同步 | 关闭文件描述符 |
| `fs.appendFileSync()` | 同步 | 追加版本记录到日志 |

### `services/WebviewService.ts`
- **Import**: `import { promises as fs } from 'fs'`
- **Tags**: `async` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.writeFile()` | 异步 | 将 PDF 和 HTML 文件写入磁盘 |

### `services/DxtService.ts`
- **Import**: `import * as fs from 'fs'`
- **Tags**: `sync` `del` `copy` `dir` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查目录和文件是否存在 |
| `fs.mkdirSync()` | 同步 | 创建临时和 MCP 目录 |
| `fs.renameSync()` | 同步 | 移动目录（重命名操作） |
| `fs.rmSync()` | 同步 | 强制递归删除目录 |
| `fs.readdirSync()` | 同步 | 列出目录条目（含类型信息） |
| `fs.copyFileSync()` | 同步 | 目录复制操作中复制文件 |
| `fs.readFileSync()` | 同步 | 读取 manifest.json 文件 |
| `fs.unlinkSync()` | 同步 | 删除临时 DXT 文件 |

### `services/mcp/oauth/storage.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `rw` `del` `dir` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.readFile()` | 异步 | 读取 OAuth 存储 JSON 文件 |
| `fs.mkdir()` | 异步 | 创建 oauth 目录 |
| `fs.writeFile()` | 异步 | 将 OAuth 数据写入临时文件 |
| `fs.rename()` | 异步 | 原子性重命名临时文件为正式文件 |
| `fs.unlink()` | 异步 | 删除 OAuth 存储文件 |

### `services/ocr/builtin/TesseractService.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `async` `stat` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.stat()` | 异步 | OCR 前检查图片文件大小 |
| `fs.promises.access()` | 异步 | 检查缓存目录是否存在 |
| `fs.promises.mkdir()` | 异步 | 创建 Tesseract 缓存目录 |

### `services/ocr/builtin/OvOcrService.ts`
- **Import**: `import * as fs from 'fs'`
- **Tags**: `sync` `async` `stat` `dir` `del` `rw` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查 OCR 可执行文件和目录是否存在 |
| `fs.promises.readdir()` | 异步 | 列出 img/output 目录中的文件 |
| `fs.promises.stat()` | 异步 | 检查条目是否为目录 |
| `fs.promises.rmdir()` | 异步 | 删除空目录 |
| `fs.promises.unlink()` | 异步 | 删除目录中的文件 |
| `fs.promises.mkdir()` | 异步 | 创建 img/output 目录 |
| `fs.promises.copyFile()` | 异步 | 复制图片文件到 img 目录 |
| `fs.promises.readFile()` | 异步 | 读取 OCR 输出文本文件 |

### `services/remotefile/MistralService.ts`
- **Import**: `import fs from 'node:fs/promises'`
- **Tags**: `async` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.readFile()` | 异步 | 读取文件 buffer 用于上传到 Mistral |

### `services/remotefile/OpenAIService.ts`
- **Import**: `import * as fs from 'fs'`
- **Tags**: `stream` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.createReadStream()` | 流 | 创建可读流用于上传文件到 OpenAI |

### `services/memory/MemoryService.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `stat` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查旧内存数据库路径是否存在 |
| `fs.renameSync()` | 同步 | 将内存数据库从旧位置迁移到新位置 |

### `services/lanTransfer/handlers/fileTransfer.ts`
- **Import**: `import * as fs from 'node:fs'`
- **Tags**: `async` `stream` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.stat()` | 异步 | 获取文件信息（存在性、大小检查） |
| `fs.createReadStream()` | 流 | 流式传输文件块用于局域网传输 |

---

## 3. Agent Services（`src/main/services/agents/`）

### `services/agents/BaseService.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `stat` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查可访问路径是否已存在 |
| `fs.statSync()` | 同步 | 获取文件/目录信息以判断是文件还是目录 |
| `fs.mkdirSync()` | 同步 | 递归创建 agent 工作区目录 |

### `services/agents/database/DatabaseManager.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `dir` `stat` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查新旧数据库路径是否存在（用于迁移） |
| `fs.mkdirSync()` | 同步 | 初始化前创建数据库目录 |
| `fs.renameSync()` | 同步 | 将数据库文件从旧位置迁移到新位置 |
| `fs.statSync()` | 同步 | 检查数据库文件信息以检测损坏（空文件） |
| `fs.unlinkSync()` | 同步 | 删除损坏的空数据库文件 |

### `services/agents/database/MigrationService.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查迁移日志文件是否存在 |
| `fs.readFileSync()` | 同步 | 读取迁移日志 JSON 文件以解析待执行迁移 |

### `services/agents/services/claudecode/index.ts`
- **Import**: `import * as fs from 'node:fs'`
- **Tags**: `sync` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 在多种场景下检查文件是否存在 |

### `services/agents/services/SessionService.ts`
- **Import**: `import * as fs from 'node:fs'`
- **Tags**: `async` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.readdir()` | 异步 | 列出 `.claude/commands/` 目录中的命令文件 |

### `services/agents/services/channels/ChannelMessageHandler.ts`
- **Import**: `import fs from 'node:fs/promises'`
- **Tags**: `async` `dir` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.mkdir()` | 异步 | 创建频道图片/文件存储目录 |
| `fs.writeFile()` | 异步 | 将频道图片持久化到工作区（base64 转文件） |
| `fs.writeFile()` | 异步 | 将频道文件持久化到工作区（base64 转文件） |

### `services/agents/services/channels/adapters/wechat/WeChatProtocol.ts`
- **Import**: `import fs from 'node:fs'`, `import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'`
- **Tags**: `sync` `async` `rw` `del` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 读取前检查上下文 token 文件是否存在 |
| `fs.readFileSync()` | 同步 | 从磁盘恢复微信上下文 token |
| `readFile()` | 异步 | 从 token 文件加载 bot 凭证 |
| `mkdir()` | 异步 | 创建 token 目录（限制权限 0o700） |
| `writeFile()` | 异步 | 将 bot 凭证保存到 token 文件（0o600） |
| `chmod()` | 异步 | 设置 token 文件权限为仅所有者可访问 |
| `rm()` | 异步 | 通过删除 token 文件清除凭证 |

### `services/agents/services/builtin/BuiltinAgentProvisioner.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `dir` `rw` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.mkdirSync()` | 同步 | 复制内置 agent 模板时创建目标目录 |
| `fs.readdirSync()` | 同步 | 列出模板目录中的文件用于递归复制 |
| `fs.copyFileSync()` | 同步 | 复制单个模板文件到 agent 工作区 |
| `fs.existsSync()` | 同步 | 检查模板目录或 agent.json 是否存在 |
| `fs.readFileSync()` | 同步 | 读取 agent.json 配置文件以提取元数据 |

### `services/agents/skills/SkillInstaller.ts`
- **Import**: `import * as fs from 'fs'`
- **Tags**: `async` `rw` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.rename()` | 异步 | 替换前备份已有技能目录 |
| `fs.promises.rename()` | 异步 | 安装失败时从备份恢复技能文件夹 |
| `fs.promises.readFile()` | 异步 | 读取 SKILL.md 内容以计算 SHA-256 哈希 |

### `services/agents/skills/SkillService.ts`
- **Import**: `import * as fs from 'node:fs'`
- **Tags**: `async` `dir` `rw` `stat` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.readdir()` | 异步 | 列出技能目录以构建文件树 |
| `fs.promises.readFile()` | 异步 | 读取技能文件用于内容访问 API |
| `fs.promises.mkdir()` | 异步 | 创建 .claude/skills 目录用于符号链接 |
| `fs.promises.lstat()` | 异步 | 删除前检查符号链接/目录状态 |
| `fs.promises.rm()` | 异步 | 重新链接前移除已有符号链接或目录 |
| `fs.promises.symlink()` | 异步 | 从 global-skills 创建 junction 符号链接到 .claude/skills |
| `fs.promises.unlink()` | 异步 | 卸载时移除技能符号链接 |
| `fs.promises.writeFile()` | 异步 | 将下载的 ZIP 文件写入临时目录 |
| `fs.promises.stat()` | 异步 | 处理前验证 ZIP 文件 |

### `services/agents/services/cherryclaw/seedWorkspace.ts`
- **Import**: `import { mkdir, stat, writeFile } from 'node:fs/promises'`
- **Tags**: `async` `dir` `rw` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `mkdir()` | 异步 | 创建工作区和 memory 子目录 |
| `writeFile()` | 异步 | 写入 SOUL.md 和 USER.md 模板文件 |
| `stat()` | 异步 | 检查模板文件是否已存在（幂等播种） |

### `services/agents/services/cherryclaw/prompt.ts`
- **Import**: `import { readdir, readFile, stat } from 'node:fs/promises'`
- **Tags**: `async` `rw` `stat` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `readdir()` | 异步 | 列出工作区文件用于大小写不敏感匹配 |
| `stat()` | 异步 | 检查文件存在性并获取 mtime 用于缓存 |
| `readFile()` | 异步 | 读取 SOUL.md、USER.md、FACT.md 记忆文件用于构建提示词 |

### `services/agents/services/cherryclaw/heartbeat.ts`
- **Import**: `import { readFile } from 'node:fs/promises'`
- **Tags**: `async` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `readFile()` | 异步 | 读取 heartbeat.md 文件（含路径遍历保护） |

---

## 4. Data Layer（`src/main/data/`）

### `data/db/DbService.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `stat` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查数据库文件是否存在 |
| `fs.statSync()` | 同步 | 获取数据库文件信息（大小） |
| `fs.unlinkSync()` | 同步 | 删除损坏的/空的数据库文件 |
| `fs.unlinkSync()` | 同步 | 删除孤立的 WAL/SHM 辅助文件 |

### `data/utils/pathResolver.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.realpathSync()` | 同步 | 解析 local_external 挂载路径的符号链接 |
| `fs.realpathSync()` | 同步 | 解析基础路径符号链接用于安全检查 |

### `data/bootConfig/BootConfigService.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `rw` `stat` `del` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查启动配置文件是否存在 |
| `fs.readFileSync()` | 同步 | 从文件加载启动配置 |
| `fs.unlinkSync()` | 同步 | 全部为默认值时删除配置文件 |
| `fs.mkdirSync()` | 同步 | 配置目录不存在时创建 |
| `fs.writeFileSync()` | 同步 | 将配置写入临时文件 |
| `fs.renameSync()` | 同步 | 原子性重命名临时文件为配置文件 |

### `data/migration/v2/window/MigrationIpcHandler.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `dir` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.mkdir()` | 异步 | 确保导出目录存在 |
| `fs.writeFile()` | 异步 | 将表数据 JSON 写入文件 |

### `data/migration/v2/utils/DexieFileReader.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `rw` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.readFile()` | 异步 | 将导出的表 JSON 文件读入内存 |
| `fs.access()` | 异步 | 检查表导出文件是否存在 |
| `fs.stat()` | 异步 | 获取表导出文件的大小 |

### `data/migration/v2/utils/JSONStreamReader.ts`
- **Import**: `import { createReadStream } from 'fs'`
- **Tags**: `stream`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `createReadStream()` | 流 | 创建可读流用于 JSON 文件批量读取 |
| `createReadStream()` | 流 | 创建可读流用于 JSON 文件计数 |
| `createReadStream()` | 流 | 创建可读流用于 JSON 文件采样 |

### `data/migration/v2/core/MigrationDbService.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `stat` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查数据库文件是否存在 |
| `fs.statSync()` | 同步 | 获取数据库文件大小 |
| `fs.unlinkSync()` | 同步 | 删除损坏的/空的数据库文件 |
| `fs.unlinkSync()` | 同步 | 删除孤立的 WAL/SHM 文件 |

### `data/migration/v2/core/MigrationContext.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.readFile()` | 异步 | 读取 localStorage 导出 JSON 文件 |

### `data/migration/v2/core/MigrationEngine.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.rm()` | 异步 | 递归删除临时导出目录 |

### `data/migration/v2/migrators/KnowledgeMigrator.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查旧版向量数据库文件是否存在 |
| `fs.statSync()` | 同步 | 检查路径是目录还是文件 |

---

## 5. Knowledge（`src/main/knowledge/`）

### `knowledge/embedjs/loader/draftsExportLoader.ts`
- **Import**: `import * as fs from 'node:fs'`
- **Tags**: `sync` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.readFileSync()` | 同步 | 读取 Drafts 导出 JSON 文件 |

### `knowledge/embedjs/loader/epubLoader.ts`
- **Import**: `import * as fs from 'fs'`
- **Tags**: `sync` `stream` `rw` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查 EPUB 文件是否存在 |
| `fs.createWriteStream()` | 流 | 创建写入流用于临时文本文件 |
| `fs.readFileSync()` | 同步 | 读取提取的临时文本内容 |
| `fs.unlinkSync()` | 同步 | 删除临时文本文件 |

### `knowledge/preprocess/BasePreprocessProvider.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `async` `stat` `dir` `rw` `copy` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查预处理存储目录是否存在 |
| `fs.mkdirSync()` | 同步 | 创建预处理存储目录 |
| `fs.existsSync()` | 同步 | 检查文件是否已预处理（目录检查） |
| `fs.promises.stat()` | 异步 | 检查路径是否为目录 |
| `fs.promises.readdir()` | 异步 | 列出已预处理目录中的文件 |
| `fs.promises.stat()` | 异步 | 获取文件信息（大小、创建时间） |
| `fs.existsSync()` | 同步 | 检查附件目录是否存在 |
| `fs.mkdirSync()` | 同步 | 创建附件目录 |
| `fs.copyFileSync()` | 同步 | 复制文件到附件目录 |
| `fs.unlinkSync()` | 同步 | 复制后删除原始文件 |

### `knowledge/preprocess/MistralPreprocessProvider.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `rw` `dir` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.readFileSync()` | 同步 | 读取图片文件并转换为 base64 |
| `fs.mkdirSync()` | 同步 | 创建 OCR 结果输出目录 |
| `fs.writeFileSync()` | 同步 | 保存 base64 编码的图片文件 |
| `fs.writeFileSync()` | 同步 | 保存合并后的 markdown 文件 |
| `fs.statSync()` | 同步 | 获取 markdown 文件大小 |

### `knowledge/preprocess/OpenMineruPreprocessProvider.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `async` `rw` `dir` `stat` `del` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.stat()` | 异步 | 获取文件大小以验证 PDF |
| `fs.promises.readFile()` | 异步 | 读取 PDF 文件用于验证 |
| `fs.readdirSync()` | 同步 | 列出提取输出目录中的文件 |
| `fs.renameSync()` | 同步 | 重命名提取的 markdown 文件 |
| `fs.existsSync()` | 同步 | 检查提取目录是否存在 |
| `fs.mkdirSync()` | 同步 | 创建提取目录 |
| `fs.writeFileSync()` | 同步 | 写入下载的 ZIP 文件 |
| `fs.unlinkSync()` | 同步 | 删除临时 ZIP 文件 |

### `knowledge/preprocess/Doc2xPreprocessProvider.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `async` `stream` `rw` `dir` `stat` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.stat()` | 异步 | 验证文件大小 |
| `fs.promises.readFile()` | 异步 | 读取文件用于上传 |
| `fs.createReadStream()` | 流 | 创建可读流用于文件上传 |
| `fs.mkdirSync()` | 同步 | 创建 ZIP/提取目录 |
| `fs.existsSync()` | 同步 | 检查提取目录是否存在 |
| `fs.writeFileSync()` | 同步 | 写入下载的 ZIP 文件 |
| `fs.unlinkSync()` | 同步 | 删除临时 ZIP 文件 |
| `fs.statSync()` | 同步 | 获取 markdown 文件大小 |

### `knowledge/preprocess/MineruPreprocessProvider.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `async` `rw` `dir` `stat` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.stat()` | 异步 | 验证文件大小 |
| `fs.promises.readFile()` | 异步 | 读取文件用于上传 |
| `fs.readdirSync()` | 同步 | 列出提取输出中的文件 |
| `fs.renameSync()` | 同步 | 重命名提取的 markdown 文件 |
| `fs.existsSync()` | 同步 | 检查提取的文件是否存在 |
| `fs.statSync()` | 同步 | 获取已处理文件的大小 |
| `fs.writeFileSync()` | 同步 | 写入下载的 ZIP 文件 |
| `fs.mkdirSync()` | 同步 | 创建提取目录 |
| `fs.unlinkSync()` | 同步 | 删除临时 ZIP 文件 |

### `knowledge/preprocess/PaddleocrPreprocessProvider.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `async` `rw` `dir` `stat` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.promises.stat()` | 异步 | 验证文件大小 |
| `fs.promises.readFile()` | 异步 | 读取文件以验证 PDF |
| `fs.existsSync()` | 同步 | 检查输出目录是否存在 |
| `fs.rmSync()` | 同步 | 删除已有的输出目录 |
| `fs.mkdirSync()` | 同步 | 创建输出目录 |
| `fs.writeFileSync()` | 同步 | 写入 markdown 结果到文件 |

---

## 6. MCP Servers（`src/main/mcpServers/`）

### `mcpServers/memory.ts`
- **Import**: `import { promises as fs } from 'fs'`
- **Tags**: `async` `rw` `dir` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.mkdir()` | 异步 | 递归创建 memory 文件路径目录 |
| `fs.access()` | 异步 | 检查 memory 文件是否存在 |
| `fs.writeFile()` | 异步 | 写入/创建 memory 文件（初始空结构） |
| `fs.readFile()` | 异步 | 从磁盘加载知识图谱数据 |
| `fs.writeFile()` | 异步 | 将内存中的图谱持久化到磁盘（带互斥锁） |

### `mcpServers/assistant.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: `sync` `rw` `stat` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查日志目录是否存在 |
| `fs.readdirSync()` | 同步 | 列出日志目录中的 .log 文件 |
| `fs.statSync()` | 同步 | 获取日志文件修改时间用于排序 |
| `fs.readFileSync()` | 同步 | 读取最新日志文件内容 |
| `fs.existsSync()` | 同步 | 检查源文件路径是否存在 |
| `fs.statSync()` | 同步 | 检查路径是文件还是目录 |
| `fs.readdirSync()` | 同步 | 列出目录内容（含文件类型） |
| `fs.readFileSync()` | 同步 | 读取源文件内容用于诊断 |

### `mcpServers/claw.ts`
- **Import**: `import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'`
- **Tags**: `async` `rw` `dir` `stat` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `mkdir()` | 异步 | 创建工作区目录 |
| `readdir()` | 异步 | 列出目录内容 |
| `readFile()` | 异步 | 读取文件内容 |
| `writeFile()` | 异步 | 写入文件内容 |
| `appendFile()` | 异步 | 追加内容到文件 |
| `rename()` | 异步 | 重命名/移动文件 |
| `stat()` | 异步 | 获取文件元数据 |

### `mcpServers/filesystem/server.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.mkdir()` | 异步 | 确保 filesystem MCP 的 baseDir 存在 |

### `mcpServers/filesystem/tools/delete.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `stat` `del`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.stat()` | 异步 | 获取文件/目录信息以判断类型 |
| `fs.rm()` | 异步 | 强制递归删除目录 |
| `fs.rmdir()` | 异步 | 删除空目录 |
| `fs.unlink()` | 异步 | 删除文件 |

### `mcpServers/filesystem/tools/ls.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.readdir()` | 异步 | 列出目录内容（含文件类型信息） |

### `mcpServers/filesystem/tools/edit.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `rw` `stat` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.stat()` | 异步 | 检查文件是否存在且为文件 |
| `fs.mkdir()` | 异步 | 父目录不存在时创建 |
| `fs.readFile()` | 异步 | 编辑前读取当前文件内容 |
| `fs.writeFile()` | 异步 | 替换后写入修改的文件内容 |

### `mcpServers/filesystem/tools/write.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `rw` `stat` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.mkdir()` | 异步 | 需要时创建父目录 |
| `fs.stat()` | 异步 | 检查文件是否已存在（用于日志） |
| `fs.writeFile()` | 异步 | 写入文件内容（覆盖或创建） |

### `mcpServers/filesystem/tools/read.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `rw` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.stat()` | 异步 | 检查文件是否存在且为文件 |
| `fs.readFile()` | 异步 | 以 UTF-8 读取文件内容 |

### `mcpServers/filesystem/tools/glob.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `stat`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.stat()` | 异步 | 验证搜索目录是否存在且为目录 |
| `fs.stat()` | 异步 | 获取文件大小和修改时间用于结果 |

### `mcpServers/filesystem/tools/grep.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `rw` `stat` `dir`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.readFile()` | 异步 | 读取文件内容用于模式匹配 |
| `fs.readdir()` | 异步 | 列出目录条目用于递归搜索 |
| `fs.stat()` | 异步 | 检查搜索路径是文件还是目录 |

### `mcpServers/filesystem/types.ts`
- **Import**: `import fs from 'fs/promises'`
- **Tags**: `async` `stat` `rw`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.realpath()` | 异步 | 解析真实路径处理符号链接（安全） |
| `fs.open()` | 异步 | 打开文件用于二进制检测 |

---

## 7. 顶层文件（`src/main/`）

### `bootstrap.ts`
- **Import**: `import fs from 'fs'`
- **Tags**: `sync` `stat` `copy`

| API | 同步/异步 | 用途 |
|-----|-----------|------|
| `fs.existsSync()` | 同步 | 检查被占用目录是否存在 |
| `fs.cpSync()` | 同步 | 递归复制被占用目录 |

### `ipc.ts`
- **Import**: `import fs from 'node:fs'`
- **Tags**: _（存在 import，具体用法待验证）_

---

## 8. 总结统计

### 文件数量（非测试）

| 分组 | 文件数 |
|------|--------|
| Utils | 9 |
| Services（非 agent） | 21 |
| Agent Services | 13 |
| Data Layer | 10 |
| Knowledge | 8 |
| MCP Servers | 12 |
| Top-level | 2 |
| **合计** | **75** |

### Import 风格分布

| 风格 | 使用次数 | 示例 |
|------|---------|------|
| `import fs from 'fs'` | ~12 | AppService, DbService |
| `import fs from 'node:fs'` | ~15 | CodeCliService, BootConfigService |
| `import * as fs from 'fs'` | ~5 | FileStorage, DxtService |
| `import * as fs from 'node:fs'` | ~5 | KnowledgeService, SkillService |
| `import fs from 'fs/promises'` | ~10 | SpanCacheService, MigrationEngine |
| `import fs from 'node:fs/promises'` | ~4 | ProtocolClient, MistralService |
| `import { promises } from 'fs'` | ~2 | AnthropicService |
| `import { promises as fs } from 'fs'` | ~2 | WebviewService, memory.ts |
| Named imports (`{ readFile, ... }`) | ~5 | claw.ts, cherryclaw/* |

> **问题**：8+ 种 import 风格混用，无统一规范。

### Sync vs Async 分布

| 类型 | 文件数 | 占比 |
|------|--------|------|
| 仅 sync | ~18 | 24% |
| 仅 async | ~30 | 40% |
| sync + async 混用 | ~27 | 36% |

### 最常用 API Top 10

| API | 出现文件数 | 用途类别 |
|-----|-----------|---------|
| `existsSync()` | 30+ | 存在性检查 |
| `mkdirSync()` / `mkdir()` | 25+ | 目录创建 |
| `readFileSync()` / `readFile()` | 25+ | 文件读取 |
| `writeFileSync()` / `writeFile()` | 20+ | 文件写入 |
| `statSync()` / `stat()` | 20+ | 元数据获取 |
| `unlinkSync()` / `unlink()` | 15+ | 文件删除 |
| `readdirSync()` / `readdir()` | 15+ | 目录列表 |
| `rmSync()` / `rm()` | 8+ | 递归删除 |
| `renameSync()` / `rename()` | 8+ | 重命名/移动 |
| `copyFileSync()` / `copyFile()` | 6+ | 文件复制 |

### 关键发现

1. **无统一文件操作抽象**：每个文件直接 `import fs`，无中间层
2. **Import 风格碎片化**：`'fs'` vs `'node:fs'` vs `'fs/promises'` 混用
3. **Sync/Async 不一致**：同类操作有的用 sync 有的用 async，部分文件混用两种风格
4. **重复模式多**：`existsSync() + mkdirSync({ recursive: true })` 在 20+ 个文件中重复出现
5. **原子写入不统一**：`mcp/oauth/storage.ts` 和 `BootConfigService.ts` 各自实现了临时文件+rename 的原子写入，`utils/file.ts` 有锁文件机制
6. **权限设置分散**：`chmod` 在 `AnthropicService`、`WeChatProtocol`、`rtk.ts` 等多处独立使用
7. **FileStorage.ts 是最大用户**：覆盖了几乎所有 fs 操作类别（sync/async/stream/stat/rw/del/copy/dir）
8. **MCP filesystem tools 最规范**：统一使用 `fs/promises`，纯 async

### 迁移优先级建议

| 优先级 | 目标 | 理由 |
|--------|------|------|
| P0 | `FileStorage.ts` | 最大 fs 用户，核心文件操作服务 |
| P0 | `utils/file.ts` + `utils/fileOperations.ts` | 底层工具函数，被广泛调用 |
| P1 | `knowledge/preprocess/*` | 8 个文件大量重复模式 |
| P1 | `data/` 层 | 数据库和迁移相关文件操作 |
| P2 | `services/agents/*` | Agent 子系统，相对独立 |
| P2 | `mcpServers/*` | 已经比较规范，迁移成本低 |
| P3 | 其余 services | 零散使用，逐步迁移 |
