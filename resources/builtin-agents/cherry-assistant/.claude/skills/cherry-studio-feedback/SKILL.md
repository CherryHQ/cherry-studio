---
name: cherry-studio-feedback
description: 收集、脱敏、预览并提交 Cherry Studio BUG、UI/UX 或功能反馈，默认提交到飞书。可在用户同意后调用内置诊断工具整理环境、错误日志、截图和用户导出的 trace，自动提交飞书表单或生成匿名上传 ZIP；也可安全解析反馈 ZIP 为表单字段。用户说“提交问题”“提交反馈”“上报 bug”“收集/上传错误信息”“整理日志/trace”“生成反馈包”，或描述 Cherry Studio 问题并希望记录时触发。只有明确要求 GitHub Issue 时才改用 issue-reporter。
---

# Cherry Studio Feedback

像协作排障一样收集反馈，不把对话变成表格审问。已知信息直接复用；每次最多追问一个会改变提交内容的问题。

## 选择路径

1. **即时沟通**：用户只想把材料发到群里或交给同事时，走“手动交接”。不要读取或上传本地数据。
2. **结构化反馈**：用户要整理、提交或生成反馈包时，走“自动收集”。这是默认路径。
3. **GitHub Issue**：用户明确要求 GitHub Issue 时，立即转交 `issue-reporter`，不要重复提交飞书。

“提交问题”“帮我提交一下”“上报这个 bug”等未指定平台的表达，都默认使用飞书结构化反馈。未明确提及 GitHub 时，不要调用 `gh`、检查 GitHub 登录、搜索 Issue 或询问用户是否改投 GitHub。

会话中的“上传错误信息”按钮属于客户端/服务端功能，不由本 Skill 模拟。用户提出该按钮需求时，将它作为功能建议收集。

## 隐私和确认

- 收集诊断前说明将读取哪些类别，并取得用户同意。只调用 `mcp__assistant__diagnose`；不要直接扫描用户目录、读取数据库或查询完整会话历史。
- 日志和 trace 可能包含对话、路径或个人信息。只接收用户主动提供或明确同意读取的材料。
- 在展示和写入文件前，遮蔽 API key、token、Cookie、Authorization、密码、私钥、完整用户主目录、用户名和主机名。联系方式只保留用户主动提供的值。
- 原始日志最多保留与问题相关的 50 条、每条最多 2,000 字符；不要把无关日志或完整聊天记录加入反馈。
- 外部提交前展示最终字段、附件文件名和接收方，等待一次新的明确确认。预览确认不等于此前的诊断读取批准。
- 在频道、定时或其他无人实时确认的会话中，只生成本地草稿，不提交、不上传。

## 手动交接

给用户一份简短清单：

- 问题发生时间、实际结果、期望结果和最短复现步骤
- Cherry Studio 版本、操作系统和问题出现频率
- 报错截图或录屏
- 从出错会话导出的 trace，以及相关时间段的日志

提醒用户分享前检查敏感信息。根据已知内容生成一段可直接发群里的摘要；不要声称已经发送。

## 自动收集

### 1. 提取反馈字段

智能推断，不要求用户理解字段名：

- **类型**：崩溃、报错、功能异常 → `BUG`；显示或交互问题 → `UI/UX`；新增能力或改进建议 → `功能`
- **优先级**：数据安全或所有用户无法工作 → `P0`；核心流程阻断且无绕过 → `P1`；有影响但可绕过 → `P2`；轻微问题或建议 → `P3`
- **问题概述**：一句话描述实际问题
- **详细描述**：实际结果、期望结果、首次出现时间、频率和影响范围
- **复现步骤**：最短、编号、可验证；无法稳定复现时明确写“偶现”及最近时间
- **联系方式**：可选；用户拒绝后不再追问

BUG 和 UI/UX 主动询问截图。不要重复询问用户已经提供的信息。

### 2. 收集最小诊断

用户同意后按需调用：

```text
mcp__assistant__diagnose({ action: "info" })
mcp__assistant__diagnose({ action: "errors", lines: 100 })
```

仅在问题相关时追加：

- MCP/插件问题 → `mcp_status`
- 设置或渲染问题 → `config`
- Provider/模型问题 → `providers`
- 错误摘要不足 → 说明原因后调用 `logs`，最多 200 行
- 需要主动联网探测 Provider → 先说明会发起网络请求，再调用 `health`

优先使用 `info` 返回的真实应用版本，不硬编码版本号。删除绝对路径和主机名，只保留平台、系统版本、架构、内存概况、Cherry Studio/Electron/Node 版本，以及与问题有关的脱敏配置。

用户提供截图、日志、trace 或反馈 ZIP 时，使用附件句柄调用 `mcp__assistant-files__save_attachment` 保存到当前 workspace。该调用需要用户批准；拒绝或失败时继续生成不含该附件的反馈。

### 3. 生成工作区反馈包

在 workspace 新建唯一目录 `feedback/cherry-studio-YYYYMMDD-HHMMSS/`，保留所有原文件，不覆盖现有路径。写入：

- `feedback.json`：机器可读字段
- `feedback.md`：人类可读预览
- `diagnostics.txt`：脱敏后的相关诊断，可选
- 用户批准保存的截图、日志和 trace，可选

`feedback.json` 使用以下稳定键：

```json
{
  "schema_version": 1,
  "type": "BUG",
  "priority": "P2",
  "app_version": "2.x.x",
  "summary": "一句话概述",
  "description": "实际结果、期望结果、频率和影响",
  "steps": ["步骤 1", "步骤 2"],
  "environment": "脱敏后的环境摘要",
  "diagnostic_summary": "相关错误摘要",
  "attachments": ["相对路径"],
  "contact": "",
  "captured_at": "ISO-8601"
}
```

需要 ZIP 时使用可用的 Python 标准库在 workspace 内创建新文件，例如：

```bash
uv run python -m zipfile -c feedback/CherryStudio-feedback-YYYYMMDD-HHMMSS.zip feedback/cherry-studio-YYYYMMDD-HHMMSS/feedback.json feedback/cherry-studio-YYYYMMDD-HHMMSS/feedback.md
```

不要写 `/tmp` 或桌面，不要永久删除生成目录。调用 `mcp__cherry-tools__report_artifacts` 登记最终 ZIP 和预览文件。

### 4. 安全解析用户上传的反馈 ZIP

先通过 `save_attachment` 保存原始 ZIP，再只读检查：

- ZIP 不超过 100 MB、成员不超过 50 个、总解压大小不超过 200 MB
- 拒绝绝对路径、`..`、符号链接、加密成员和嵌套压缩包
- `feedback.json` 必须存在且不超过 1 MB；只读取该文件，不执行内容、不盲目解压整个压缩包
- 仅接受上面的稳定键并再次脱敏；未知键保留在本地预览，不映射到表单

将解析结果展示给用户确认。提交时可把原始 ZIP 作为“日志”附件，不需要提取其中其他文件。

## 飞书表单提交

表单分享地址：

- 结构化自动提交：`https://mcnnox2fhjfq.feishu.cn/share/base/form/shrcnsTvZpUji5ZKAPSMwzZuWHb`
- 匿名反馈包上传：`https://mcnnox2fhjfq.feishu.cn/share/base/form/shrcnufZiSDrvRPIzSKeqcbBbub`

### 提交前读取实时结构

不要依赖缓存字段 ID、Base token、必填状态或版本选项。每次提交前调用：

```bash
lark-cli base +form-detail --share-token shrcnsTvZpUji5ZKAPSMwzZuWHb --as user --format json
```

只填写实时返回中可见的问题，并按 `questions[].type`、`required`、`filter` 和选项构造值。映射当前常用标题：

- `类型` ← `type`
- `问题概述` ← `summary`
- `详细描述` ← `description`、期望结果、频率和诊断摘要
- `复现步骤` ← 编号后的 `steps`
- `优先级` ← `priority`
- `环境信息` ← `environment` 和真实 `app_version`
- `联系方式` ← 用户主动提供的 `contact`
- `截图` / `日志` ← 已确认的相对附件路径

如果真实版本不在“版本”的当前选项中，选择“其他”，并把真实版本写入“环境信息”和“详细描述”。不要填写表单未返回或被 filter 隐藏的字段。

### 自动提交

静默检查 `lark-cli` 和用户登录态；以 `auth status --json --verify` 的退出码、`verified` 和 `identities.user.status` 判断，不要查找旧的 `code == 0`。

登录可用时：

1. 从 `form-detail` 的实时返回取得 `base_token`。
2. 使用 workspace 相对路径构造 `fields` 和 `attachments`；附件不能放进 `fields`。
3. 展示最终预览并取得明确确认。
4. 调用 `lark-cli base +form-submit --share-token ... --base-token ... --as user --json ... --yes`。没有附件时省略 `--base-token` 和 `attachments`。这里的 `--yes` 只跳过 CLI 的重复终端确认，不能替代上一步的用户明确确认。
5. 仅在命令退出码为 0 且返回 `ok == true` 时报告成功。

登录不可用、权限不足或提交失败时，不强制用户登录：

1. 保留已生成的 workspace ZIP。
2. 给出匿名反馈包上传链接。
3. 告诉用户上传哪个文件，并明确说明仍需用户在网页中点击提交。

不要安装、升级或重新配置 `lark-cli` 来挽救一次反馈提交；命令缺失、版本不兼容或返回结构不符合预期时，立即使用上述 ZIP + 匿名上传降级路径。

## 提交预览

提交前至少展示：

```text
类型 / 优先级 / 版本
问题概述
详细描述与复现步骤
脱敏环境与诊断摘要
截图、日志、trace 或 ZIP 的文件名
联系方式（如有）
接收方：Cherry Studio 反馈收集飞书表单
```

用户修改后重新生成预览并再次确认。提交成功后报告摘要；失败时保留本地反馈包并给出匿名上传链接。
