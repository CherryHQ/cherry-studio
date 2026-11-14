# Agent Note: Gitea 技能 URL 安装

Status: proposed

[English](2026-11-14-gitea-skill-urls.md) | 中文

## 问题

技能安装只接受 `github.com` 与 `raw.githubusercontent.com` 上的 GitHub `SKILL.md` URL。`src/shared/utils/skillMarketplace.ts` 中的 `parseGithubSkillUrl` 对其他主机返回 `null`，因此部署在私有 Gitea 服务器上的技能无法通过 URL 搜索、预览或安装（issue #20206）。用户需要对 Gitea 使用同样的单技能安装路径，包括 `dev` 等非主分支。

## 方案

### URL 形式与安装标识

接受任意 HTTPS 主机上的两种 Gitea 形式：

- `https://{host}/{owner}/{repo}/src/branch/{ref}/{dir}/SKILL.md`
- `https://{host}/{owner}/{repo}/raw/branch/{ref}/{dir}/SKILL.md`

描述文件名必须是 `SKILL.md` 或 `skill.md`，与 GitHub 相同。仓库名的 `.git` 后缀会被去除。标签路由以及仓库根或 tree URL 不在范围内。分支名通过与 GitHub 相同的提交查询解析，因此包含 `/` 的分支名会对照服务器的引用来解析，而不是简单按路径切分。

安装来源为 `gitea:{https URL}`，其中 URL 是技能描述文件的规范 `src/branch` 形式。`github:` 前缀及其 URL 形式不变，已持久化的来源保持原有标识。

### 获取与安装

`gitea:` 来源通过 Git smart HTTP 访问 `https://{host}/{owner}/{repo}.git` 获取，随后执行与 GitHub 获取器相同的提交观察、目标物化、技能目录校验、大小限制和回滚。被检查目录树所对应的提交即为被安装的提交。仅安装指定的技能目录。

访问为匿名方式，不请求、不存储、也不发送令牌。需要认证的服务器会以其返回的传输错误失败。

### 发现与界面

`search_skills` 与安装对话框识别 Gitea 的 `SKILL.md` URL，并与 GitHub 使用相同的单结果路径，返回一条结果。对此类输入不查询注册表。其余注册表搜索及结果保持不变。该结果的注册表标签为 `gitea`。

技能校验、按智能体启用、卸载与回滚行为保持不变。

## 考虑过的替代方案

- 将 `github:` 前缀推广到任意主机：放弃，因为已有安装来源、缓存键和测试都依赖 `github:`；独立前缀可保持这些标识稳定，并明确主机类型。
- 只接受 `src/branch` 形式：放弃，因为 Gitea 用户复制的下载链接通常是 raw 形式，且 issue 同时列出两种形式。
- 使用 Gitea REST contents API：放弃，因为其格式随 Gitea 版本而异，且会绕过已验证的 git 获取路径。
- 为局域网服务器允许明文 HTTP：暂时放弃，因为不支持凭据，且明文 HTTP 会使获取的技能内容可被篡改。如有需要，再以显式选择加入的方式重新评估。
- 要求每主机白名单或设置项：放弃，因为用户每次安装都会显式提供 URL；代价是应用会连接用户指定的任意 HTTPS 主机，已记录在风险中。

## 验收标准

- AC1 — 任意 HTTPS 主机上的两种 Gitea URL 形式都解析为一条技能结果，其安装来源为 `gitea:` 加规范描述文件 URL。（验证：单元测试；负责人：Backend）
- AC2 — GitHub URL 以及既有的 `github:`、`claude-plugins:`、`skills.sh:` 和 `clawhub:` 来源，解析与安装行为保持不变。（验证：单元测试；负责人：Backend）
- AC3 — 安装 `gitea:` 来源时，获取指定引用所观察到的提交，并仅安装指定的技能目录，且保留既有校验、大小限制和回滚。（验证：针对本地 Git HTTP 夹具的主进程集成测试；负责人：Backend）
- AC4 — 非 HTTPS URL、含嵌入凭据的 URL、仓库或 tree URL，以及不以 `SKILL.md` 结尾的 URL，都会在写入磁盘前被拒绝。（验证：单元测试；负责人：Backend）
- AC5 — 搜索与安装对话框接受 Gitea `SKILL.md` URL，只显示一条结果，且不为其查询注册表。（验证：单元测试与渲染进程测试；负责人：Frontend）
- AC6 — 需要认证的服务器以其传输错误失败；不读取、不存储、也不发送任何凭据。（验证：主进程集成测试；负责人：Backend）

## 风险

用户指定的任意 HTTPS 主机都会被连接，这可能触及内网服务；每次安装由用户发起，获取的内容与 GitHub 一样经过校验。包含 `/` 的分支名依赖服务器的引用列表，部分 Gitea 部署可能限制该列表。不同 Gitea 版本的 smart HTTP 行为可能不同；集成夹具只覆盖一种服务器构建，其他版本在测试前均未验证。匿名访问无法从私有仓库安装。
