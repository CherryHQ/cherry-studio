# 🖥️ 开发指南

## IDE 配置

### VSCode like

- 编辑器：[Cursor](https://www.cursor.com/) 等，任何 VS Code 兼容编辑器均可。
- 推荐扩展见 [`.vscode/extensions.json`](/.vscode/extensions.json)。

### Zed

1. 安装扩展：[Biome](https://github.com/biomejs/biome-zed)、[oxc](https://github.com/oxc-project/zed-oxc)
2. 复制示例配置文件到本地 Zed 配置目录：
   ```bash
   cp .zed/settings.json.example .zed/settings.json
   ```
3. 按需自定义 `.zed/settings.json`（该文件已被 git 忽略）。

## 项目配置

### 安装 Node.js

项目所需的 Node.js 版本定义在 `.node-version` 文件中。推荐使用 [nvm](https://github.com/nvm-sh/nvm)、[fnm](https://github.com/Schniz/fnm) 等版本管理工具自动切换：

```bash
nvm install
```

### 安装 pnpm

pnpm 版本已锁定在 `package.json` 的 `packageManager` 字段中，通过 corepack 即可自动安装对应版本：

```bash
corepack enable
```

### 安装依赖

```bash
pnpm install
```

### 环境变量

```bash
cp .env.example .env
```

### 启动开发

```bash
pnpm dev
```

### 调试

```bash
pnpm debug
```

然后在浏览器中访问 chrome://inspect

### 测试

```bash
pnpm test
```

### 构建

```bash
# Windows
$ pnpm build:win

# macOS
$ pnpm build:mac

# Linux
$ pnpm build:linux
```
