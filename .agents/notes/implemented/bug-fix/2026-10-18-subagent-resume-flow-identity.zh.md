# Agent Note: Continued sub-agent flow identity across reconnects

Status: implemented

[English](2026-10-18-subagent-resume-flow-identity.md) | 中文

## Problem

被继续(resume)的子 agent 的身份只存在于按进程、按轮次的内存映射里。Claude Code 会把续跑内容重新以**原始 launch tool-use id** 流式输出,而描述这次续跑的生命周期边携带的是**发起续跑的 call id**;DSH(在本工作推进期间已被上游退役)则把冷续跑的子 agent 绑定到它自己的 `send_message` 调用。映射一旦丢失,就会产生多种不同的故障:续跑内容在 drain 或连接重置后被丢弃;续跑边可能顶替 launch root;新进程完全没有映射;延迟输出可能因持久化标记被逐出而搁浅在缓冲里;UI 还会把已续跑的子 agent 显示为已完成——因为状态是从"已完结工具组"被刻意清空的 parts 上下文里读取的。

## Decision

launch tool-use id 是子 agent 运行的唯一身份,并在每个边界上存活。

**主进程。** flow anchor 在 drain 与连接重置后仍然保留;新连接从数据库恢复 launch root 与宿主行,重试按节流间隔进行,避免故障期间按 chunk 读库。task→tool-call 注册采用**首个注册优先**,续跑边永远不会顶替 launch root。flow root 的 anchor 跟随其内容实际流进的行——在存活回合里开流的一轮,在适配器中途 detach 之后仍留在该行,不会被劈到回合行与 launch 行两处(面板按消息顺序读一轮,劈开即乱序)。宿主行暂不可解析的 detached chunk 在受限预算内缓冲;溢出时整段前缀被放弃,抑制按前缀留下未闭合的**部件**记录——前缀已闭合的部件不会再发出任何内容,部件在重启或结束时退出记录,因此仍在流式的部件永不会被遗忘、记录也不会增长,兄弟流的重启同样不会放行会中止 SDK reader 的孤儿 delta。逐出持久化标记时同步失效对应 anchor,延迟输出因此会重新解析宿主行,而不是一直缓冲到 teardown。当前 SDK 的启动收据是散文格式(前缀与 `agentId:` trailer 之间夹着括号元数据);该原生格式通过共享文法解析,并按结构化格式同样的方式钉住收据自身的 call id。前台启动以子 agent 自己的报告作答,SDK 会把同一 trailer 附在其后——id 在 send 括号里重复、usage 块收尾——该尾部形态同样被识别,之后的 send 仍可继续该 agent。工具保持自己开始时所属轮次的续跑标记:标记在输入开始时冻结,因此晚于后续 send 才落地(哪怕该 send 只是排队)的结果,仍留在工具开始时的轮次,而不会跟随后来的 send。块按它开始所在的响应归因:标记按被观察到的响应 id 冻结——assistant 帧每条响应一个 id,流事件从 `message_start` 取得——因此落在响应中途的收据无法重标子 agent 已经开始发出的块。

**聊天渲染层。** 续跑收据呈现为 launch 风格条目:一个共享解析器决定 flow 目标(adapter 戳记 → 跨消息 launch 索引 → 子 agent 的运行时保留根,使后续 send 打开运行时保留任务的根);当历史 launch 不在已加载窗口内、但自身 call 是已被证实的根时,行保持可点击;任务状态改由列表级 launch 索引推导——已终结的任务只有新 run 的 `started` 边能复活——而不再依赖被清空的组内 parts;非终结的边只有在任务仍然存活(源轮次仍活跃,或仍在后台任务成员中)时才覆盖行状态,后台胶囊只在确实加载了可导航的行时才让位。失败或被取消的 send 不是续跑条目:它保留带失败提示的诊断行,而不是变成 flow 条目——行与工具组标题皆然。live cache 的边就是当前 run 自身的信念:非终结的 cache 边能让已结算任务复活——即使当初促成复活的 `started` 边已被替换;而未获担保的边仍不能——两者都由同一套 liveness 门裁决。

**flow 面板。** flow 按每次续跑切分轮次,轮次顺序按"开启该轮的 resume 调用"而非遍历位置(冷重启会把续跑内容移进 launch 所在行);每轮保留自己的 prompt;重复最终报告的 launch 结果文本被丢弃;冷续跑的 DSH 子 agent 自成一根;send 只有在投递结果可用之后才算续跑——待投递、失败与被取消的都不算;已投递的收据在有运行时标记时按标记开轮,使投递前产生的子 agent 输出留在其原轮,仅在完全没有标记证据时才回退到遍历位置;状态面板同样允许新 run 的 `started` 边复活已终结的任务行,并在 live cache 越过该 start 之后继续维持获担保的运行。

## Alternatives considered

- 只在内存里保留身份——否决:重启与会话重开会丢失。
- 消息级溢出抑制——否决:一个流的重启会放行兄弟流的孤儿 delta。
- 按 FIFO 逐出被丢弃的部件 id——否决:部件在被遗忘后仍可能发出 delta,放行它会让该行后续所有 chunk 都随 reader 一起中止。
- 在主进程复制启动收据文法——否决:统一使用 `src/shared/ai/launchReceipt.ts` 的共享文法,供 runtime adapter 与渲染层使用。
- 在 launch-root 查询失败时钉住续跑边的 call id——否决:会让后续导航指错;只有启动收据自身的 call id 才允许回退。
- 事后对 flow 消息排序——否决:一轮内容被拆到多行时归属仍然错误。

## Consequences

- 数据库是新进程的恢复来源;查询按节流间隔进行。
- 有界缓冲可能丢弃某个流的前缀;该流只能通过同一部件的新 start 重新汇入。
- DSH 已被上游退役;残留的 DSH 专用处理只服务历史转写。

## Verification

- Regression — `pnpm test:main src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`:220 通过,含恢复后的溢出抑制、marker 逐出时 anchor 失效、共享同一宿主行的交错 root、兄弟流溢出已完结部件后仍被抑制的未闭合部件、有界查找戳记,以及 flow root 在轮次流进的行上保持锚定。
- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/streamAdapter.test.ts`:88 通过,含散文启动收据、前台回答尾部 trailer 的启动注册,以及其他工具形似收据的输出不会重标该 agent,还有工具保持自己开始时所属轮次的续跑标记,以及响应保持自己开始时的标记。
- Regression — `pnpm test:shared src/shared/ai/__tests__/launchReceipt.test.ts`:6 通过(各种收据形态、伪造拒绝,以及前台回答携带的 trailer)。
- Regression — `pnpm test:renderer` 面板与聊天渲染套件:202 与 248 通过,含存活度协调、胶囊可导航性、前置收据轮次、失败 send 保留诊断行与组标题、未投递的 send 不参与轮次切分、投递后原轮内容留在原处,以及获担保的 live cache 边复活已结算运行;`typecheck:node` / `typecheck:web` 干净。
- Regression — 每个新回归测试都验证过"修复前失败、修复后通过"。
