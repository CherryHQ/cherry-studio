# 品牌打包功能文档

## 概述

Cherry Studio 支持多品牌构建，允许基于同一源码构建不同品牌的应用程序。品牌配置通过 `brand.config.json` 实现，支持自定义应用名称、图标、功能开关等。

## 目录结构

```
cherry-studio/
├── brand.config.json           # 品牌配置文件
├── brand.config.schema.json    # 配置 Schema
├── brand-custom/               # 自定义品牌资源目录（模板）
│   ├── icon.png               # Linux 图标
│   ├── logo.png               # 应用 Logo
│   └── tray_*.png             # 托盘图标
├── brand-jlpay/                # JlPay 品牌资源目录（示例）
│   ├── icon.png               # 20KB
│   ├── icon.icns              # macOS 图标 (122KB)
│   ├── icon.ico               # Windows 图标 (285KB)
│   ├── logo.png               # Logo (43KB)
│   └── tray_*.png             # 托盘图标
├── build/                      # 默认资源目录（不修改）
│   ├── icon.png               # 默认图标
│   ├── logo.png               # 默认 Logo
│   └── ...
├── scripts/
│   └── brand-builder.js       # 品牌构建脚本
└── out/                        # 构建输出
    ├── main/                  # 主进程输出
    └── renderer/              # 渲染进程输出
```

## 配置文件结构

### brand.config.json

```json
{
  "$schema": "./brand.config.schema.json",
  "default": {
    "name": "Cherry Studio",
    "description": "A powerful AI assistant for producer.",
    "appId": "com.kangfenmao.CherryStudio",
    "productName": "Cherry Studio",
    "executableName": "Cherry Studio",
    "desktopName": "CherryStudio.desktop",
    "author": "support@cherry-ai.com",
    "homepage": "https://github.com/CherryHQ/cherry-studio",
    "protocols": {
      "name": "Cherry Studio",
      "schemes": ["cherrystudio"]
    },
    "assets": {
      "icon": "build/icon.png",
      "logo": "build/logo.png",
      "trayIcon": "build/tray_icon.png",
      "trayIconDark": "build/tray_icon_dark.png",
      "trayIconLight": "build/tray_icon_light.png"
    },
    "features": {
      "enableTestPlan": true
    },
    "license": {
      "type": "AGPL-3.0",
      "sourceCodeUrl": "https://github.com/CherryHQ/cherry-studio",
      "licenseUrl": "https://www.gnu.org/licenses/agpl-3.0.html",
      "copyrightNotice": "Copyright (C) CherryHQ"
    },
    "update": {
      "serverUrl": "",
      "configUrl": "",
      "feedUrl": "",
      "mirror": "github"
    }
  }
}
```

### 配置项说明

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `name` | 应用显示名称 | `"Cherry Studio"` |
| `description` | 应用描述 | `"A powerful AI assistant"` |
| `appId` | 应用唯一标识 | `"com.company.app"` |
| `productName` | 产品名称 | `"Cherry Studio"` |
| `executableName` | 可执行文件名 | `"CherryStudio"` |
| `protocols.schemes` | URI 协议 | `["myapp"]` |
| `assets.icon` | Linux 图标路径 | `"brand-myapp/icon.png"` |
| `assets.iconMac` | macOS 图标路径 | `"brand-myapp/icon.icns"` |
| `assets.iconWin` | Windows 图标路径 | `"brand-myapp/icon.ico"` |
| `assets.logo` | Logo 路径 | `"brand-myapp/logo.png"` |
| `features.enableTestPlan` | 是否启用测试计划 | `true/false` |

## 构建流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        品牌构建流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 配置阶段 (brand-builder.js)                                 │
│     ├─ 加载 brand.config.json                                   │
│     ├─ 验证品牌配置                                              │
│     ├─ 默认品牌: 从 Git 恢复 build/ 资源                         │
│     └─ 自定义品牌: 仅记录品牌信息，不复制文件                     │
│                                                                 │
│  2. 环境变量生成                                                  │
│     ├─ 写入 .env.brand 文件                                      │
│     ├─ 生成 electron-builder.brand.yml (品牌构建)                 │
│     └─ 修改 build-constants.ts (临时)                            │
│                                                                 │
│  3. 构建阶段 (electron-vite build)                               │
│     ├─ 运行类型检查                                              │
│     ├─ 构建主进程和渲染进程                                       │
│     └─ 输出到 out/ 目录                                          │
│                                                                 │
│  4. 资源复制阶段 (仅品牌构建)                                     │
│     ├─ 复制 logo.png → out/renderer/assets/                     │
│     ├─ 替换所有 logo-<hash>.png 文件                             │
│     ├─ 复制托盘图标 → out/main/                                  │
│     └─ 复制应用图标 → out/main/                                  │
│                                                                 │
│  5. 打包阶段 (electron-builder)                                  │
│     ├─ 使用品牌配置的图标路径                                     │
│     ├─ 生成安装包                                                │
│     └─ 应用内图标使用 out/ 目录的资源                             │
│                                                                 │
│  6. 清理阶段                                                     │
│     └─ 恢复 build-constants.ts                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 使用方法

### 开发模式

```bash
# 默认品牌开发
pnpm dev

# JlPay 品牌开发
pnpm dev:jlpay

# 自定义品牌开发
pnpm dev:brand
```

### 生产构建

```bash
# 默认品牌构建
pnpm build:default

# JlPay 品牌构建（包含打包）
pnpm build:jlpay

# 自定义品牌构建
pnpm build:custom
```

### 手动执行

```bash
# 配置品牌环境
node scripts/brand-builder.js jlpay

# 配置并构建
node scripts/brand-builder.js jlpay --build

# 使用环境变量构建
dotenv -e .env.brand -- pnpm build
```

## 创建新品牌

### 步骤 1: 编辑 brand.config.json

```json
{
  "mybrand": {
    "name": "My Brand App",
    "description": "My Custom AI Assistant",
    "appId": "com.mycompany.myapp",
    "productName": "My App",
    "executableName": "MyApp",
    "desktopName": "myapp.desktop",
    "author": "support@mycompany.com",
    "homepage": "https://mycompany.com",
    "protocols": {
      "name": "My App",
      "schemes": ["myapp"]
    },
    "assets": {
      "icon": "brand-mybrand/icon.png",
      "iconMac": "brand-mybrand/icon.icns",
      "iconWin": "brand-mybrand/icon.ico",
      "logo": "brand-mybrand/logo.png",
      "trayIcon": "brand-mybrand/tray_icon.png",
      "trayIconDark": "brand-mybrand/tray_icon_dark.png",
      "trayIconLight": "brand-mybrand/tray_icon_light.png"
    },
    "features": {
      "enableTestPlan": false
    },
    "license": {
      "type": "AGPL-3.0",
      "sourceCodeUrl": "https://github.com/mycompany/cherry-studio",
      "licenseUrl": "https://www.gnu.org/licenses/agpl-3.0.html",
      "copyrightNotice": "Based on Cherry Studio - Copyright (C) CherryHQ. Modified by My Company.",
      "showOriginalAttribution": true
    },
    "ui": {
      "contactEmail": "support@mycompany.com",
      "showDocs": false,
      "showWebsite": false,
      "showEnterprise": false,
      "showCareers": false,
      "githubRepoUrl": "https://github.com/mycompany/cherry-studio"
    },
    "update": {
      "serverUrl": "",
      "configUrl": "",
      "feedUrl": "",
      "mirror": "github"
    }
  }
}
```

### 步骤 2: 创建品牌资源目录

```bash
mkdir brand-mybrand
# 添加以下文件:
# - icon.png (512x512, Linux)
# - icon.icns (macOS)
# - icon.ico (Windows)
# - logo.png (1024x1024)
# - tray_icon.png (16x16 或 32x32)
# - tray_icon_dark.png
# - tray_icon_light.png
```

### 步骤 3: 添加构建脚本（可选）

在 `package.json` 中添加：

```json
{
  "scripts": {
    "dev:mybrand": "dotenv -e .env.brand -- electron-vite dev",
    "build:mybrand": "node scripts/brand-builder.js mybrand --build && electron-builder --config electron-builder.brand.yml"
  }
}
```

### 步骤 4: 构建测试

```bash
# 开发测试
node scripts/brand-builder.js mybrand
pnpm dev:mybrand

# 构建测试
pnpm build:mybrand
```

## 环境变量

品牌构建会生成以下环境变量：

### 基础信息

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `BRAND_PROFILE` | 品牌标识 | `jlpay` |
| `APP_NAME` | 应用名称 | `JlPay Studio` |
| `APP_DESCRIPTION` | 应用描述 | `嘉联AI+平台` |
| `APP_ID` | 应用ID | `com.jlpay.AIStudio` |
| `APP_AUTHOR` | 作者邮箱 | `support@jlpay.com` |
| `APP_HOMEPAGE` | 主页URL | `https://www.jlpay.com` |
| `APP_PROTOCOL` | URI协议 | `jlpaystudio` |

### 功能控制

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `ENABLE_TEST_PLAN` | 启用测试计划 | `true` |
| `CUSTOM_BUILD` | 自定义构建 | `false` |
| `SHOW_DOCS` | 显示文档 | `true` |
| `SHOW_WEBSITE` | 显示网站 | `true` |
| `SHOW_ENTERPRISE` | 显示企业版 | `true` |
| `SHOW_CAREERS` | 显示招聘 | `true` |

### 许可证合规

| 变量名 | 说明 |
|--------|------|
| `SOURCE_CODE_URL` | 源码地址 (AGPL-3.0 要求) |
| `LICENSE_URL` | 许可证地址 |
| `ORIGINAL_PROJECT_NAME` | 原始项目名 |
| `ORIGINAL_PROJECT_URL` | 原始项目URL |

## 资源处理规则

### build/ 目录

**规则**: `build/` 目录始终保持默认状态，不被品牌构建修改。

- 默认品牌: 从 Git 恢复
- 自定义品牌: 不复制任何文件到 `build/`

### out/ 目录

**规则**: 品牌资源仅在构建后复制到 `out/` 目录。

| 源路径 | 目标路径 | 说明 |
|--------|----------|------|
| `brand-jlpay/logo.png` | `out/renderer/assets/logo.png` | 关于我们页面 |
| `brand-jlpay/logo.png` | `out/renderer/assets/logo-<hash>.png` | 替换所有 hash 版本 |
| `brand-jlpay/tray_icon.png` | `out/main/tray_icon.png` | 托盘图标 |
| `brand-jlpay/icon.png` | `out/main/icon.png` | Linux 图标 |
| `brand-jlpay/icon.icns` | `out/main/icon.icns` | macOS 图标 |
| `brand-jlpay/icon.ico` | `out/main/icon.ico` | Windows 图标 |

### electron-builder 图标

**规则**: 打包时直接使用品牌目录中的图标。

```yaml
# electron-builder.brand.yml (自动生成)
win:
  icon: brand-jlpay/icon.ico
mac:
  icon: brand-jlpay/icon.icns
linux:
  icon: brand-jlpay/icon.png
```

## 生成的文件

### .env.brand

品牌环境变量文件，由 `brand-builder.js` 生成：

```env
BRAND_PROFILE=jlpay
ENABLE_TEST_PLAN=false
APP_NAME=JlPay Studio
APP_ID=com.jlpay.AIStudio
# ... 更多变量
```

### electron-builder.brand.yml

品牌打包配置文件，由 `brand-builder.js` 自动生成，**不应提交到 Git**。

已在 `.gitignore` 中配置忽略。

## 图标规格

### 应用图标

| 平台 | 文件格式 | 推荐尺寸 | 说明 |
|------|----------|----------|------|
| Linux | PNG | 512x512 | icon.png |
| macOS | ICNS | 1024x1024 | icon.icns |
| Windows | ICO | 256x256 | icon.ico |

### Logo

| 用途 | 尺寸 | 格式 |
|------|------|------|
| 关于我们页面 | 1024x1024 | PNG |
| 启动页面 | 1024x1024 | PNG |

### 托盘图标

| 用途 | 尺寸 | 格式 |
|------|------|------|
| 托盘图标 | 16x16 | PNG |
| 托盘图标 (深色) | 16x16 | PNG |
| 托盘图标 (浅色) | 16x16 | PNG |

## 故障排除

### 问题: 图标没有更新

**原因**: Vite 构建时对资源文件进行了 hash 处理。

**解决**: `brand-builder.js` 会自动替换所有 `logo-<hash>.png` 文件。

### 问题: 托盘图标显示不正确

**原因**: 托盘图标需要复制到 `out/main/` 目录。

**解决**: 确认 `brand.config.json` 中配置了 `trayIcon` 路径。

### 问题: 打包后图标仍为默认

**原因**: electron-builder 没有使用品牌配置。

**解决**: 使用 `--config electron-builder.brand.yml` 参数。

```bash
electron-builder --config electron-builder.brand.yml
```

### 问题: build/ 目录被修改

**原因**: 旧版本的 `brand-builder.js` 会复制文件到 `build/`。

**解决**: 当前版本不会修改 `build/` 目录。如果仍有问题，恢复默认：

```bash
node scripts/brand-builder.js default
```

## 更新日志

### 2026-03-04

- 修改资源处理逻辑，不再复制任何文件到 `build/` 目录
- 所有品牌资源在构建后直接复制到 `out/` 目录
- 支持替换 Vite 生成的 hash 资源文件
- 生成正确的应用图标用于关于我们页面和启动页面

### 之前版本

- 支持多品牌配置
- 支持自定义图标、Logo、托盘图标
- 支持 AGPL-3.0 许可证合规
