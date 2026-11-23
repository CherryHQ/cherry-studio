# Agent Note: 在技能目录名中保留安全 Unicode 字符

Status: implemented

[English](2026-11-21-skill-unicode-folder-names.md) | 中文

## 问题

`src/main/ai/skills/skillPaths.ts` 中的 `sanitizeFolderName` 会把 `[a-zA-Z0-9_-]` 之外的所有字符替换为 `_`。字符数相同的非 ASCII 技能目录名会折叠成完全相同的纯下划线字符串（例如 CherryIN 市场中 `Chengfeng VideoCut Skills` 的 `剪口播` 与 `自进化` 都会变成 `___`），导致集合内部或托管库内不同技能之间因 `Conflicting skill folder: ___` 而安装失败。此外，`normalizeFolderKey` 仅调用 `.toLowerCase()` 而未做 Unicode NFC 归一化，`downloadSkillPackage` 也直接用 `.toLowerCase()` 而非 `normalizeFolderKey` 去重。

## 决策

- 在 `sanitizeFolderName` 中先执行 `.normalize('NFC').trim()`，移除 NUL 字节，保留 Unicode 字母、组合标记、数字、`_` 和 `-`（将 `[^\p{L}\p{M}\p{N}_-]` 替换为 `_`），并剔除开头的组合标记。
- 空白输入继续返回 `''`（保持既有空名拒绝行为）；非空白但清理后不含任何字母或数字的输入（如 `???`、`***` 等纯符号名）回退为 `skill-<sha256前8位>`，避免不同纯符号名撞成相同的下划线目录。
- 超过 80 个 Unicode 码点的名称按 `Array.from` 安全截断（不切碎 UTF-16 代理对），并拼接 `-<sha256前8位>` 防止前缀碰撞。
- 对 Windows 保留设备名（不区分大小写的 `CON`、`PRN`、`AUX`、`NUL`、`COM1`–`COM9`、`LPT1`–`LPT9`）追加 `-skill` 后缀。
- 将 `normalizeFolderKey` 委托给 `foldPathSegment`（`normalize('NFC').toLowerCase()`），并在 `cherrySkillMarketplace.ts` 中改用 `normalizeFolderKey` 做集合成员目录名去重。

## 考虑过的替代方案

- 对所有非 ASCII 名称保持纯 ASCII 并改用哈希后缀（`skill-<hash>`）：虽然规避了字符集差异，但会导致 `Data/Skills/` 目录名完全不可读，并与 `reconcileSkills` 已采纳的用户自建中文技能目录不一致。
- 在目录名中允许点号（`.`）：会重新引入点号开头的隐藏目录、`.`/`..` 路径穿越、Windows 末尾点号静默剥离以及 `con.txt` 类带扩展名保留设备名问题。继续将 `.` 替换为 `_` 既保留了现有 ASCII 行为，也规避了这些风险。

## 后果

- 现有 ASCII 目录名的清理结果保持完全不变；非 ASCII 技能名在 Windows、macOS 和 Linux 上都能保留可读且互不冲突的目录名。
- 包含等长非 ASCII 成员目录的市场集合（如 `Chengfeng VideoCut Skills`）可以正常安装、导出和卸载。
- 旧版本已安装在纯下划线目录下的市场技能仍会通过 `sourceUrl` 匹配识别为已安装，并可按技能 ID 正常卸载；对于旧版纯下划线目录的本地或 GitHub 技能重装，会落到新的 Unicode 目录名下，不会自动迁移旧目录。
- 开放中的 PR #20478 也在 `skillPaths.ts` 中加入了 Windows 保留设备名处理；后合入的一方需协调复用同一套保留名逻辑。

## 验证

- Regression — `pnpm test:main src/main/ai/skills/__tests__/skillPaths.test.ts`：7/7 项测试通过，覆盖 ASCII 兼容、中文/日文/天城文保留、NFD/NFC 归一化、纯符号哈希兜底、代理对安全超长截断、Windows 保留设备名与 `normalizeFolderKey` 折叠。
- Regression — `pnpm test:main src/main/ipc/handlers/__tests__/skill.test.ts`：31/31 项测试通过。
- Regression — `pnpm test:main src/main/ai/skills/__tests__/SkillService.test.ts`：Windows 下 186 项测试通过 180 项，包含新增的 `installs, exports, and uninstalls marketplace collection members with equal-length Chinese folder names` 与全部 10 项 CherryIN 市场测试；6 项原有无关测试因本机 Windows `fs.promises.symlink` 报 `EPERM` 失败。
- Regression — 线上真实包抽检（临时 Vitest 脚本，跑完已删）验证 `Chengfeng VideoCut Skills`（`04528359-491e-464c-8c0d-28a81b319cff`）：发现的 3 个成员（`剪口播`、`口播成片`、`自进化`）全部通过 `downloadSkillPackage` 校验，无目录名冲突。
- Regression — 对 4 个改动/新增 TS 文件执行 `pnpm exec oxfmt --check`、`pnpm exec oxlint --deny-warnings`、`pnpm exec eslint` 及 `pnpm typecheck:node`：全部零警告、零错误通过。
