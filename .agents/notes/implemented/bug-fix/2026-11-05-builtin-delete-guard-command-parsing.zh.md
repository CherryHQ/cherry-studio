# Agent Note: 内置删除守卫只匹配可执行命令

Status: implemented

[English](2026-11-05-builtin-delete-guard-command-parsing.md) | 中文

## 问题

受保护的内置 Agent（Assistant 与 Support）绝不能永久删除数据，因此 `builtin-destructive` 会对命令文本命中删除模式的 Bash 调用作出拒绝。检测器此前用正则匹配整条原始命令字符串，导致「文本」等价于「执行」：写一段提到 `rm` 的 heredoc、LaTeX 参数 `-halt-on-error`、视频扩展名 `.rmvb`、Python 源码里的 `del` 关键字，或者 `rg "del|remove"` 这样的正则，都会被当成删除。

对 Agent 会话为期四周的审计发现，约四分之一的拦截属于这类误杀：追加记忆条目、创建文档或脚本、编译 LaTeX、只读扫描都被拒绝；而把真正的删除写进脚本文件，却在真正执行前不会被拦截。

## 决定

`assistantCommandSafety` 现在先解析命令再做判断。本地分词器把字符串拆成由简单命令组成的管道，识别引号、转义、注释、重定向、命令替换与 heredoc。守卫只匹配可执行的命令词及其参数，不再扫描原始文本。

heredoc 正文与开启它的那一行分离。只有当该行把标准输入交给解释器时（`bash <<'EOF'`、`python3 - <<'PY'`、`cat <<'EOF' | bash`）才分析正文；由 `cat`、`tee`、`printf` 写入文件的 heredoc 一律忽略。`-c`、`-e`、`--eval` 传入的解释器代码同样会被分析，并且先剥离脚本字符串与注释，因此 `print("os.remove(x)")` 不会被当成调用。嵌套的 `$(…)` 与反引号命令替换会递归分析；经 `ssh`、`su`、`chroot`、`kubectl exec` 与 `docker`/`podman` 的 `exec`/`run` 执行的命令会解析出内层命令，避免被包装器掩盖。

命令词会穿过赋值、`sudo`、`xargs`、`env`、`timeout` 等包装器解析。`halt`、`shutdown`、`reboot` 只作为命令词匹配，`-halt-on-error` 属于参数。`Remove-Item`、`del`、`sc delete`、`reg delete` 只在可执行位置匹配，包括经 `powershell -Command`（以及 base64 的 `-EncodedCommand`）和 `cmd /c` 调用的形式。

拒绝文案现在写明这是内置 Tool Guard，由 Cherry Studio 强制实施，并说明设置里没有可检查或编辑的 hook。

## 备选方案

- `bash-parser`：能给出真正的 AST，但该包停在 v0.5.0，会把二十个 Babel 6 时代的依赖带进主进程构建。守卫需要的是命令边界，不是完整语法。
- `shell-quote`：维护中且体积小，但只是分词器，不支持 heredoc，还会误读词中的 `#`、`$VAR` 与反引号。heredoc 预处理和命令替换扫描仍要自己写，等于维护两套解析器。
- 继续收紧正则：heredoc 与引号文本没有比分词更便宜的正则边界；而避开误杀的模式同样会漏掉 `bash -c 'rm …'`。
- 拦截 `trash`：守卫针对永久删除，安全的移入回收站路径应当保持可用。

## 后果

- 守卫按结构判断，因此写进脚本文件的删除要等解释器执行时才会被拦——旧检测器同样有这一盲区。该守卫仍是可用性守卫，不是安全边界。
- 分析最多递归四层 `-c`、命令替换与 heredoc 嵌套，对对抗性输入的工作量有上界。
- `git restore --staged` 现在放行，因为它只取消暂存；不带 `--staged` 或带 `--worktree` 的 `git restore` 仍然拦截。
- `fdisk` 等磁盘工具在只读形式下仍然拦截，保持原有行为。

## 验证

- 回归 — `pnpm test:main src/main/ai/agents/builtin/__tests__/assistantCommandSafety.test.ts`：67 个测试；原有真实删除仍被拦截，审计中的误杀（heredoc 写文件、`-halt-on-error`、`.rmvb`、`del lines[0]`、引号内正则）被放行。
- 回归 — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/guardRules.test.ts`：77 个测试；`builtin-destructive` 在所有权限模式下仍拒绝真实 `rm`，且不影响普通 Agent。
- 回归 — `pnpm typecheck:node`：主进程类型检查通过。
