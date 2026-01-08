# 飞书通知脚本

`scripts/feishu-notify.ts` 是一个 CLI 工具，用于向飞书 Webhook 发送通知。该脚本主要在 GitHub Actions 工作流中使用，实现自动通知功能。

## 功能特性

- 基于子命令的 CLI 结构，支持不同类型的通知
- 使用 HMAC-SHA256 签名验证
- 发送飞书交互式卡片消息
- 完整的 TypeScript 类型支持
- 通过环境变量传递凭证，确保安全性

## 使用方式

### 前置依赖

```bash
pnpm install
```

### CLI 结构

```bash
pnpm tsx scripts/feishu-notify.ts [command] [options]
```

### 环境变量（必需）

| 变量 | 说明 |
|------|------|
| `FEISHU_WEBHOOK_URL` | 飞书 Webhook URL |
| `FEISHU_WEBHOOK_SECRET` | 飞书 Webhook 签名密钥 |

## 命令

### `issue` - 发送 GitHub Issue 通知

```bash
pnpm tsx scripts/feishu-notify.ts issue [options]
```

| 参数 | 短选项 | 说明 | 必需 |
|------|--------|------|------|
| `--url` | `-u` | GitHub Issue URL | 是 |
| `--number` | `-n` | Issue 编号 | 是 |
| `--title` | `-t` | Issue 标题 | 是 |
| `--summary` | `-m` | Issue 摘要 | 是 |
| `--author` | `-a` | Issue 作者 | 否（默认："Unknown"） |
| `--labels` | `-l` | Issue 标签（逗号分隔） | 否 |

#### 示例

```bash
pnpm tsx scripts/feishu-notify.ts issue \
  -u "https://github.com/owner/repo/issues/123" \
  -n "123" \
  -t "Bug: Something is broken" \
  -m "这是一个关于某功能的 bug 报告" \
  -a "username" \
  -l "bug,high-priority"
```

## 在 GitHub Actions 中使用

该脚本主要在 `.github/workflows/github-issue-tracker.yml` 工作流中使用：

```yaml
- name: Install dependencies
  run: pnpm install

- name: Send notification
  run: |
    pnpm tsx scripts/feishu-notify.ts issue \
      -u "${{ github.event.issue.html_url }}" \
      -n "${{ github.event.issue.number }}" \
      -t "${{ github.event.issue.title }}" \
      -a "${{ github.event.issue.user.login }}" \
      -l "${{ join(github.event.issue.labels.*.name, ',') }}" \
      -m "Issue 摘要内容"
  env:
    FEISHU_WEBHOOK_URL: ${{ secrets.FEISHU_WEBHOOK_URL }}
    FEISHU_WEBHOOK_SECRET: ${{ secrets.FEISHU_WEBHOOK_SECRET }}
```

## 飞书卡片消息格式

`issue` 命令发送的交互式卡片包含以下内容：

- **标题**: `#<issue编号> - <issue标题>`
- **作者**: Issue 创建者
- **标签**: Issue 标签列表（如有）
- **摘要**: Issue 内容摘要
- **操作按钮**: "View Issue" 按钮，点击跳转到 GitHub Issue 页面

## 配置飞书 Webhook

1. 在飞书群组中添加自定义机器人
2. 获取 Webhook URL 和签名密钥
3. 将 URL 和密钥配置到 GitHub Secrets：
   - `FEISHU_WEBHOOK_URL`: Webhook 地址
   - `FEISHU_WEBHOOK_SECRET`: 签名密钥

## 错误处理

脚本在以下情况会返回非零退出码：

- 缺少必需的环境变量（`FEISHU_WEBHOOK_URL`、`FEISHU_WEBHOOK_SECRET`）
- 缺少必需的命令参数
- 飞书 API 返回非 2xx 状态码
- 网络请求失败

## 扩展新命令

CLI 设计支持多种通知类型。添加新命令的步骤：

1. 定义命令选项接口
2. 创建卡片构建函数
3. 添加新的命令处理函数
4. 使用 `program.command()` 注册命令
