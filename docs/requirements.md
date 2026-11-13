# riccon·scrum 需求规格与实现追踪

> 状态图例：**已实现** = 当前代码可复现；**计划中** = 已确认目标、尚未实现；**挂起** = 明确暂不做。
> 基线日期：2026-11-12。实现证据以仓库相对路径表示。

## 1. 编号规则

- `REQ-PROJ-xxx` 项目与配置
- `REQ-ONB-xxx` 入驻与画像
- `REQ-IDX-xxx` 代码索引与搜索
- `REQ-STORY-xxx` 故事与生命周期
- `REQ-ACP-xxx` agent 接入与会话
- `REQ-SEC-xxx` 权限、隔离与安全
- `REQ-TEAM-xxx` 团队编排
- `REQ-DOD-xxx` 完成定义与质量门禁
- `REQ-APPR-xxx` 审批与验收
- `REQ-OBS-xxx` 可观测性与度量
- `REQ-UI-xxx` 前端交互
- `REQ-NFR-xxx` 非功能需求
- `REQ-DISC-xxx` 需求发现轨道（计划中）
- `REQ-TASK-xxx` Story Task 执行轨道
- `REQ-FB-xxx` 需求迭代与 Bug 反馈轨道
- `REQ-DOC-xxx` 项目文档轨道

## 2. 项目与配置

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-PROJ-001 | 新建项目 | 通过文件夹选择器选择本地目录，不要求已是 git 仓库；已有仓库自动探测当前分支，非 git 目录可后续一键创建本地仓库 | 已实现 | `server/src/db.ts`、`server/src/routes.ts`、`web/src/components/RegisterModal.tsx`、`FolderPickerModal.tsx` |
| REQ-PROJ-002 | 项目级交付配置 | 可配置 agent 终端、团队模式、模型、术语表、DoD 命令、机器 DoD 要求、自动审批策略 | 已实现 | `server/src/db.ts`、`web/src/components/settings/SettingsProjectPanes.tsx` |
| REQ-PROJ-003 | 全局运行参数 | 可配置 WIP、轮次/墙钟/token 预算、空闲回收、默认终端；保存后立即生效 | 已实现 | `server/src/settings.ts`、`shared/src/index.ts`、`web/src/components/settings/SettingsGlobalPanes.tsx` |
| REQ-PROJ-004 | 多项目切换 | 顶栏切换项目后，看板、设置、画像、搜索、指标切换到对应项目；顶栏展示项目名与当前分支，支持切换分支和创建本地仓库 | 已实现 | `web/src/App.tsx`、`web/src/components/TopBar.tsx`、`GitBranch.tsx` |
| REQ-PROJ-005 | 配置项可解释 | 每个设置项有用途与影响说明 | 已实现 | `web/src/components/settings/*` |
| REQ-PROJ-006 | 项目归档与删除 | 项目可归档并从工作台/切换器隐藏；设置中可查看、恢复或永久删除；至少保留一个未归档项目；删除仅级联清理平台数据，不改动本地代码与 Git 分支 | 已实现 | `server/src/db.ts`、`server/src/routes.ts`、`web/src/components/settings/SettingsProjectsPane.tsx` |

## 3. 入驻与画像

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-ONB-001 | 技术栈确定性扫描 | 识别语言、框架、包管理器、清单、入口、测试/构建命令、顶层结构 | 已实现 | `server/src/scanner.ts` |
| REQ-ONB-002 | 架构文档生成 | 在临时 detached worktree 中由 agent 只读分析并产出 Markdown 架构文档 | 已实现 | `server/src/onboard.ts`、`server/src/templates.ts` |
| REQ-ONB-003 | 基线测试 | 在临时 worktree 中运行发现的测试命令并保存结果 | 已实现 | `server/src/onboard.ts`、`server/src/dod.ts` |
| REQ-ONB-004 | DoD 自动建议 | 项目未配置 DoD 时，用发现的测试命令生成测试类 DoD | 已实现 | `server/src/onboard.ts` |
| REQ-ONB-005 | 入驻状态可观测 | 状态机 scanning/analyzing/baselining/done/error，前端可查询与展示 | 已实现 | `server/src/db.ts`、`web/src/components/ProfileModal.tsx` |

## 4. 代码索引与搜索

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-IDX-001 | 建立文件与符号索引 | 跳过依赖/构建目录；限制单文件与总文件数；提取常见语言符号 | 已实现 | `server/src/indexer.ts` |
| REQ-IDX-002 | 代码搜索 | 支持符号、内容、文件名查询，返回路径、行号、片段 | 已实现 | `server/src/indexer.ts`、`server/src/routes.ts` |
| REQ-IDX-003 | 实现上下文注入 | 启动故事时按标题/描述检索索引，作为提示词上下文 | 已实现 | `server/src/service.ts`、`server/src/indexer.ts` |
| REQ-IDX-004 | 索引统计 | 可查询文件数与符号数 | 已实现 | `server/src/routes.ts` |

## 5. 故事与生命周期

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-STORY-001 | 手工创建故事 | 填写标题、描述、BDD 验收标准；标题必填 | 已实现 | `server/src/db.ts`、`web/src/components/CreateModal.tsx` |
| REQ-STORY-002 | 故事状态机 | 仅允许 draft/ready/in_dev/review/done/blocked 的合法迁移 | 已实现 | `shared/src/index.ts`、`server/src/db.ts`、`server/src/ops.ts` |
| REQ-STORY-003 | 就绪门禁 | 验收标准非空；要求机器 DoD 时至少一条命令 | 已实现 | `server/src/service.ts` |
| REQ-STORY-004 | WIP 限制 | in_dev 数量达到上限时拒绝启动新故事 | 已实现 | `server/src/service.ts`、`server/src/settings.ts` |
| REQ-STORY-005 | 独立分支与 worktree | 启动时从默认分支创建 `story/<id>-<slug>` 与独立 worktree | 已实现 | `server/src/service.ts`、`server/src/git.ts` |
| REQ-STORY-006 | 自动 DoD 播种 | 创建故事时按项目 DoD 生成条目，并附加人工验收项 | 已实现 | `server/src/db.ts` |
| REQ-STORY-007 | 退回修改必须给原因 | review 退回时原因必填；原因作为下一轮指令 | 已实现 | `web/src/components/Drawer.tsx`、`server/src/service.ts` |
| REQ-STORY-008 | 角色感知恢复 | 恢复会话优先选择 dev/solo，而不是团队最后一轮的 QA | 已实现 | `server/src/service.ts` |
| REQ-STORY-009 | 验收合并 | 带命令 DoD 全过；提交 worktree；以 `--no-ff` 合并；标记人工 DoD；清理 worktree | 已实现 | `server/src/service.ts`、`server/src/git.ts` |
| REQ-STORY-010 | 阻塞与恢复 | 预算/冲突/失败可转 blocked；人工可带指令恢复到 in_dev | 已实现 | `server/src/team.ts`、`server/src/service.ts` |

## 6. Agent 接入与会话

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-ACP-001 | ACP 终端适配 | 通过 AgentSpec 解析命令/参数/环境；不把终端逻辑写进编排 | 已实现 | `server/src/acp/agents.ts` |
| REQ-ACP-002 | 支持 opencode | 默认终端，ACP 模式，可钉住模型，使用独立 DB；默认模型 `opencode-go/deepseek-v4.1-flash`（非 free） | 已实现 | `server/src/acp/agents.ts`、`server/src/config.ts` |
| REQ-ACP-003 | 支持 Claude Code | 通过官方 ACP 适配器以 Node ESM 启动 | 已实现 | `server/src/acp/agents.ts` |
| REQ-ACP-004 | 支持 qoder-cli | 使用隐藏 `--acp`；剥离 `QODER*` 环境；空 MCP 配置；模型配置项 `model` | 已实现 | `server/src/acp/agents.ts`、`server/src/acp/runner.ts` |
| REQ-ACP-005 | 会话 resume | 使用 ACP `session/load` 恢复历史会话 | 已实现 | `server/src/acp/runner.ts` |
| REQ-ACP-006 | 模型钉住 | 项目配置模型时，opencode 用环境变量、qoder-cli 用 `session/set_config_option` | 已实现 | `server/src/acp/runner.ts`、`server/src/acp/agents.ts` |
| REQ-ACP-007 | 会话可观测 | 记录终端、角色、模型、状态；事件流展示消息/工具/计划/用量 | 已实现 | `server/src/acp/runner.ts`、`server/src/acp/manager.ts`、`web/src/components/Drawer.tsx` |
| REQ-ACP-008 | 启动失败可见 | 子进程启动失败发布 error 状态与原因，不静默挂起 | 已实现 | `server/src/acp/runner.ts` |
| REQ-ACP-009 | 空闲回收 | 超过配置时长且无进行中提示的会话被停止 | 已实现 | `server/src/acp/manager.ts` |

## 7. 权限、隔离与安全

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-SEC-001 | 权限请求人工决策 | 非自动批准的 ACP 权限请求进入待决列表，批准/拒绝后返回 agent | 已实现 | `server/src/acp/manager.ts`、`web/src/components/Rail.tsx` |
| REQ-SEC-002 | 分级自动批准 | 只自动批准读/搜索与配置的命令前缀；写/删/移动/抓取不自动批准 | 已实现 | `server/src/acp/policy.ts` |
| REQ-SEC-003 | 策略审计 | 自动批准也写审批记录，`decidedBy=policy` | 已实现 | `server/src/acp/manager.ts` |
| REQ-SEC-004 | 文件作用域 | runner 仅允许声明的根目录 | 已实现 | `server/src/acp/runner.ts` |
| REQ-SEC-005 | 不污染用户数据 | 平台 opencode 使用独立 DB；qoder-cli 空 MCP 配置 | 已实现 | `server/src/config.ts`、`server/src/acp/agents.ts` |
| REQ-SEC-006 | 命令注入防护 | git 操作用 execFile + argv；DoD 命令仅来自管理员配置 | 已实现 | `server/src/git.ts`、`server/src/dod.ts` |
| REQ-SEC-007 | 合并必须人工触发 | 不存在自动合并路径；合并前记录人工验收审批 | 已实现 | `server/src/service.ts` |

## 8. 团队编排

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-TEAM-001 | 团队模式开关 | 项目开启团队模式后，启动故事走 Lead→Dev→QA→Gate | 已实现 | `server/src/service.ts`、`server/src/team.ts` |
| REQ-TEAM-002 | 结构化计划 | Lead 输出 JSON 任务与文件；解析失败时降级为空计划 | 已实现 | `server/src/templates.ts`、`server/src/team.ts` |
| REQ-TEAM-003 | 冲突预检 | 文件范围与其它 in_dev 故事重叠时产生冲突审批；人工拒绝则停止 | 已实现 | `server/src/team.ts` |
| REQ-TEAM-004 | QA 独立评审 | QA 基于 diff 与验收标准输出 `{pass, issues}` | 已实现 | `server/src/templates.ts`、`server/src/team.ts` |
| REQ-TEAM-005 | 有界返工 | 未通过时带问题返工 Dev，最多 `maxRework` 次，超限转 blocked | 已实现 | `server/src/team.ts`、`server/src/config.ts` |
| REQ-TEAM-006 | 预算防控 | 轮次、墙钟、token 超限转 blocked 并记录事件 | 已实现 | `server/src/team.ts`、`server/src/settings.ts` |
| REQ-TEAM-007 | 团队可观测 | 展示阶段轨迹、计划、QA 结论、角色会话 | 已实现 | `web/src/components/Drawer.tsx`、`web/src/ui.tsx` |

## 9. 完成定义与质量门禁

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-DOD-001 | 机器 DoD | 执行项目配置的命令，保存尾部输出与通过状态 | 已实现 | `server/src/dod.ts`、`server/src/ops.ts` |
| REQ-DOD-002 | 文档 DoD | 校验 `.md` 或 `docs/` 是否发生变更 | 已实现 | `server/src/ops.ts`、`server/src/git.ts` |
| REQ-DOD-003 | 人工验收项 | 合并成功后将人工 DoD 置为通过并记录证据 | 已实现 | `server/src/service.ts` |
| REQ-DOD-004 | 门禁结果事件化 | 每条 DoD 结果发布事件并可在抽屉查看证据 | 已实现 | `server/src/ops.ts`、`web/src/components/Drawer.tsx` |
| REQ-DOD-005 | DoD 未过不进入 review | Solo/团队均在 DoD 全过后才允许进入 review | 已实现 | `server/src/service.ts`、`server/src/team.ts` |

## 10. 审批与验收

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-APPR-001 | 审批类型 | 支持 permission/plan/accept/merge/conflict | 已实现 | `shared/src/index.ts`、`server/src/db.ts` |
| REQ-APPR-002 | 待决列表 | 前端可查看并批准/拒绝待决审批 | 已实现 | `web/src/components/Rail.tsx`、`web/src/App.tsx` |
| REQ-APPR-003 | 决策审计 | 记录状态、选项、决策人、时间 | 已实现 | `server/src/db.ts`、`server/src/acp/manager.ts` |
| REQ-APPR-004 | 验收即决策 | 验收端点本身视为人工批准，并写入 accept 审批 | 已实现 | `server/src/service.ts` |

## 11. 可观测性与度量

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-OBS-001 | 追加式事件流 | 事件按 seq 持久化，支持增量查询与回放 | 已实现 | `server/src/db.ts`、`server/src/bus.ts` |
| REQ-OBS-002 | 实时广播 | WebSocket 连接后先回放最近事件，再广播新事件 | 已实现 | `server/src/index.ts`、`web/src/api.ts` |
| REQ-OBS-003 | 刷新不误报 | 回放历史事件不触发 Toast，只有新事件触发 | 已实现 | `web/src/api.ts`、`web/src/App.tsx` |
| REQ-OBS-004 | 流转指标 | 吞吐、进行中、阻塞、平均前置/周期时间、变更失败率、返工次数 | 已实现 | `server/src/metrics.ts`、`web/src/components/MetricsModal.tsx` |
| REQ-OBS-005 | 健康检查 | 返回服务状态与当前 agent 命令 | 已实现 | `server/src/index.ts` |

## 12. 前端交互

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-UI-001 | 看板 | 按状态分列，显示故事数、运行中标记，可打开抽屉 | 已实现 | `web/src/components/Board.tsx` |
| REQ-UI-002 | 故事抽屉 | 概览、实时、团队、DoD、Diff 五个视图 | 已实现 | `web/src/components/Drawer.tsx` |
| REQ-UI-003 | 通知 | DoD 结果、进入验收、完成、待审批产生 Toast | 已实现 | `web/src/App.tsx`、`web/src/components/Toasts.tsx` |
| REQ-UI-004 | 搜索面板 | Ctrl/Cmd+K 打开，按符号/内容/文件搜索 | 已实现 | `web/src/components/SearchPalette.tsx`、`web/src/App.tsx` |
| REQ-UI-005 | 项目画像 | 查看技术栈、架构文档、基线结果 | 已实现 | `web/src/components/ProfileModal.tsx` |
| REQ-UI-006 | 设置页 | 左侧菜单分组（全局：运行参数/向量检索/任务执行；项目：项目配置/交付与门禁/知识库/项目归档），右侧展示对应配置项并逐项说明 | 已实现 | `web/src/components/SettingsPage.tsx`、`web/src/components/settings/*` |
| REQ-UI-007 | 一键启停 | 根目录 `start.cmd` / `stop.cmd` 管理开发服务 | 已实现 | `start.cmd`、`stop.cmd`、`scripts/dev-control.mjs` |

## 13. 非功能需求

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-NFR-001 | 终端无关 | 编排层不依赖具体 agent CLI；新增终端只改适配层 | 已实现 | `server/src/acp/agents.ts` |
| REQ-NFR-002 | 最小改动分层 | 路由/服务/编排/适配职责分离 | 已实现 | `server/src/routes.ts`、`service.ts`、`team.ts`、`acp/*` |
| REQ-NFR-003 | 可恢复 | 故事、worktree、会话、事件在进程重启后可继续查询/恢复 | 已实现 | `server/src/db.ts`、`server/src/service.ts` |
| REQ-NFR-004 | 有界执行 | 所有自主循环都有轮次/时间/token 上限 | 已实现 | `server/src/team.ts`、`server/src/settings.ts` |
| REQ-NFR-005 | 单机可运行 | Windows 下一条命令启动/停止，无需外部数据库 | 已实现 | `start.cmd`、`stop.cmd`、`server/src/db.ts` |
| REQ-NFR-006 | 类型一致 | shared 类型被 server/web 共用；typecheck 通过 | 已实现 | `shared/src/index.ts`、根 `typecheck` 脚本 |
| REQ-NFR-007 | 认证与多租户 | 登录、RBAC、每人一团队、合并队列、多租户 | 挂起 | 不实现，待产品决策 |
| REQ-NFR-008 | 自动化测试入库 | 仓库内可重复执行的单元/集成/E2E 套件 | 计划中 | 当前以手工 Playwright 脚本验证 |

## 14. 需求发现轨道（P0/P1/P2 已实现）

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-DISC-001 | 需求实体与状态机 | 支持 intake/clarifying/drafting/in_review/revising/approved/decomposed/split/blocked/archived；非法迁移拒绝 | 已实现 | `shared/src/index.ts`、`server/src/db.ts` |
| REQ-DISC-002 | AI 生成故事草稿 | 从原始需求与项目上下文生成 3–8 个结构化故事、GWT 验收标准、DoD 映射 | 已实现 | `server/src/discovery.ts`、`server/src/templates.ts` |
| REQ-DISC-003 | 确定性校验与 DoR 强阻断 | 故事数、GWT、DoD、条款、规模、重复、AC 测试映射；所有 DoR 项为 error，未过不得批准 | 已实现 | `server/src/discovery.ts`、`web/src/components/RequirementsPage.tsx` |
| REQ-DISC-004 | 人工反馈与版本化 | 反馈绑定版本与故事键；最多 2 轮修订；每次修订生成不可变版本 | 已实现 | `server/src/db.ts`、`server/src/discovery.ts` |
| REQ-DISC-005 | 批准后物化与人工留痕 | 事务创建故事与 AC 证据条目；写入 `decided_by='human'` 的需求批准记录 | 已实现 | `server/src/discovery.ts` |
| REQ-DISC-006 | 只读沙箱 | 发现阶段临时 detached worktree；agent 仅可读/搜索 | 已实现 | `server/src/discovery.ts`、`server/src/acp/runner.ts` |
| REQ-DISC-007 | 需求级度量 | 反馈轮次、首版通过率、平均版本、平均周期、条款覆盖率、物化故事数 | 已实现 | `server/src/metrics.ts`、`web/src/components/RequirementsPage.tsx` |
| REQ-DISC-008 | 版本对比与定向修订 | 展示新增/修改/删除/未变；无整体意见时未反馈故事保持上一版 | 已实现 | `server/src/discovery.ts`、`web/src/components/RequirementsPage.tsx` |
| REQ-DISC-009 | 相似度去重 | 草稿内、现有故事与历史需求故事按 bigram/包含关系检查，高度重复阻断 | 已实现 | `server/src/discovery.ts`、`server/src/scripts/discovery-check.ts` |
| REQ-DISC-010 | Critic 独立自检 | 生成后由独立评审提示词检查 INVEST、GWT、重复、范围与 DoD；问题进入版本 | 已实现 | `server/src/templates.ts`、`server/src/discovery.ts` |
| REQ-DISC-011 | 故事来源追踪 | stories 持久化 `requirement_id/source_version/source_version_id/source_story_key/source_clause` | 已实现 | `server/src/db.ts`、`server/src/discovery.ts` |
| REQ-DISC-012 | 术语表注入 | 项目级术语表注入需求提示词，统一术语 | 已实现 | `server/src/db.ts`、`server/src/templates.ts`、`web/src/components/SettingsPage.tsx` |
| REQ-DISC-013 | 批准依据说明 | 工作台展示目标/条款覆盖/DoR 通过数与待确认项，解释故事充分性 | 已实现 | `web/src/components/RequirementsPage.tsx` |
| REQ-DISC-014 | AC 测试映射与逐条证据门禁 | 每条 AC 持久化 test 映射；实现后 DoD 输出命中测试名才 pass；详情展示证据 | 已实现 | `server/src/db.ts`、`server/src/ops.ts`、`web/src/components/Drawer.tsx` |
| REQ-DISC-015 | 已批准需求变更请求与影响分析 | 新版本对未开始/进行中/已完成故事给建议，人工决定 | 已实现 | `/api/requirements/:id/change-request`、`RequirementsPage.tsx` |
| REQ-DISC-016 | 外部需求源 | 文档/Issue 接入并转为需求 intake | 计划中 | `discovery-track.md` P2 |
| REQ-DISC-017 | Eval harness 与 golden set | 一键回归 schema/GWT/测试映射/条款/DoR 指标；期望错误码可断言 | 已实现 | `evals/discovery/cases`、`server/src/scripts/eval-discovery.ts` |
| REQ-DISC-018 | 生成任务可靠性 | 任务租约/心跳；单次与总超时；Critic 超时降级；取消 API/UI；重启清理僵尸任务与孤儿 worktree | 已实现 | `server/src/discovery.ts`、`server/src/db.ts`、`RequirementsPage.tsx` |
| REQ-DISC-019 | 结构化 intake 与澄清轮次 | 目标/用户/约束/非目标/成功指标/示例；v1 有开放问题时进入 clarifying；回答后重新生成 | 已实现 | `shared/src/index.ts`、`server/src/templates.ts`、`RequirementsPage.tsx` |
| REQ-DISC-021 | 对话式 intake 与常驻会话 | 一句话创建；逐轮问答；消息持久化/回放；会话复用与空闲回收；ready 门控；确认后生成+零错误自动物化 | 已实现 | `server/src/intake.ts`、`requirement_messages`、`RequirementsPage.tsx` |
| REQ-DISC-022 | 需求层级与 AI 拆分草案 | 需求最多 3 层；故事是叶子；AI 只生成 2–6 个子需求草案；人工勾选/改标题后确认；父需求转 split | 已实现 | `server/src/split.ts`、`split_drafts`、`SplitDraftModal.tsx` |
| REQ-DISC-023 | 分类与标签 | 单一主分类树 ≤3 级、筛选含子孙；多标签；需求/故事分配；列表/看板/图筛选 | 已实现 | `categories`/`tags`/`entity_tags`、`CategoryPicker.tsx`、`TagPicker.tsx` |
| REQ-DISC-024 | 依赖 DAG 与启动门禁 | 需求/故事统一 FS 依赖；环/自依赖/重复拒绝；故事启动校验前置；原因 override 审计；需求交付按故事/子需求递归判定 | 已实现 | `server/src/dependencies.ts`、`service.ts`、`Drawer.tsx` |
| REQ-DISC-025 | 结构化 Handoff | 故事验收写入 diff/关键文件/契约/迁移/DoD/AC/决策；前置上下文优先读取；历史 done 可回填 | 已实现 | `handoffs` 表、`service.ts`、`dependencies.ts` |
| REQ-DISC-026 | 依赖图与关键路径 | DAG 状态/分类着色、等待前置、环告警、关键路径高亮、Epic 折叠、Mermaid 导出 | 已实现 | `DependencyGraphModal.tsx` |
| REQ-DISC-027 | 用例图与活动图 | 需求范围 actor/用例图；故事活动图含开始/结束 | 已实现 | `ScopeDiagramModal.tsx`、`DependencyGraphModal.tsx` |
| REQ-DISC-028 | AI 分类树/标签/归类治理 | 打开先展示现有词表，人工重新生成 AI 建议；≤3 级分类、标签/归类确认后应用；草稿分类/标签批准时自动应用 | 已实现 | `server/src/taxonomy.ts`、`TaxonomyModal.tsx` |
| REQ-DISC-029 | 需求/故事语义搜索 | 标题/rawInput/intake/AC/分类标签/Handoff 混合检索；设置页配置 embedding，未配置词法回退；点击打开详情 | 已实现 | `server/src/semantic.ts`、`SearchPalette.tsx`、`SettingsPage.tsx` |
| REQ-DISC-030 | AI 依赖建议 | 语义候选 + 理由/置信度；DAG 校验；人工勾选后建边 | 已实现 | `server/src/dependency-suggest.ts`、`DependencySuggestModal.tsx` |
| REQ-DISC-031 | 依赖事项详情 | 依赖 chip/图节点弹出摘要、状态、分类标签、依赖与 Handoff，可打开完整详情 | 已实现 | `DependencyPeekModal.tsx` |

## 15. 追踪矩阵（关键链路）
| 链路 | 入口 | 核心实现 | 验证 |
| --- | --- | --- | --- |
| 项目注册 → 入驻 | `POST /api/projects`、`POST /api/projects/:id/onboard` | `routes.ts` → `onboard.ts` → `scanner.ts` | Playwright Suite D（入驻 + 画像） |
| 故事创建 → 就绪 | `POST /api/stories`、`POST /api/stories/:id/approve` | `db.ts` → `service.ts` | Playwright Suite A |
| 启动 → 实现 → DoD | `POST /api/stories/:id/start` | `service.ts` → `manager.ts` → `runner.ts` → `ops.ts` | Playwright Suite A/C |
| 团队编排 | 启动且项目开启 teamMode | `team.ts` → `templates.ts` → `manager.ts` | Playwright Suite B |
| 权限审批 | ACP `request_permission` | `runner.ts` → `manager.ts` → `policy.ts` → Rail | 手工 + E2E |
| 验收合并 | `POST /api/stories/:id/accept` | `service.ts` → `git.ts` | Playwright Suite A |
| 事件回放 | `/ws` | `index.ts` → `bus.ts` → `db.ts` → `api.ts` | 刷新不回放提醒修复验证 |
| 需求生成 → 修订 → 物化 | `POST /api/requirements/:id/*` | `routes.ts` → `discovery.ts` → `templates.ts` → `db.ts` | opencode 真实需求 E2E：5 故事、0 错误、Critic 6 条告警、批准留痕 human |
| 需求度量 | `GET /api/requirements/metrics` | `metrics.ts` | API 实测 + 工作台展示（含条款覆盖率） |
| 需求工作台 | `/api/requirements` | `RequirementsPage.tsx` | Playwright 11 项断言（DoR 8/8、批准依据、版本 diff） |
| AC 证据门禁 | `GET /api/stories` | `discovery.ts` → `db.ts` → `ops.ts` → `Drawer.tsx` | 实现故事 AC1/AC2 pass 且证据命中测试名 |
| 生成可靠性 | `POST /api/requirements/:id/cancel` | `discovery.ts` → `requirement_jobs` → 启动清理 | 取消后 job=cancelled；强杀重启后 job=failed、需求 blocked、无临时目录 |
| 结构化 intake/澄清 | `POST /api/requirements`、`/feedback` | `templates.ts`、`discovery.ts`、工作台 | v1 clarifying（3 故事/4 问题）→ 回答 → v2 in_review（0 错误） |
| 对话式 intake | `POST /api/requirements/intake`、`:id/intake` | `intake.ts`、`requirement_messages`、`RequirementsPage.tsx` | 真实 3 轮会话复用同一 session；ready 后确认生成 6 故事并物化 |
| 拆分草案确认 | `POST /api/requirements/:id/split/draft`、`/split/confirm` | `split.ts`、`SplitDraftModal.tsx` | 草案不落子需求；取消 1 个、改标题后确认仅创建 3 个 |
| 分类/标签 | `/api/categories`、`/api/tags`、`.../category`、`.../tags` | `db.ts`、`CategoryPicker.tsx`、`TagPicker.tsx` | 第四级分类 400；标签筛选返回对应需求/故事 |
| 依赖与门禁 | `/api/dependencies`、`POST /stories/:id/start` | `dependencies.ts`、`service.ts` | 反向依赖 400；前置未完成启动 400；done 前置注入 Handoff |
| 图视图 | `/api/graph` | `DependencyGraphModal.tsx`、`ScopeDiagramModal.tsx` | 关键路径/活动图/Mermaid 下载/用例图浏览器断言通过 |
| AI 分类/标签 | `/api/taxonomy/preview`、`/apply` | `taxonomy.ts`、`TaxonomyModal.tsx` | 真实 AI 生成 14 分类/15 标签/54 条归类；预览后才应用 |
| 语义搜索 | `/api/search/entities` | `semantic.ts`、`SearchPalette.tsx` | 关键词命中需求/故事，点击打开详情 |
| AI 依赖建议 | `/api/dependencies/suggest` | `dependency-suggest.ts`、`DependencySuggestModal.tsx` | 真实 AI 生成建议，人工勾选后建边并刷新 |
| 依赖详情 | 依赖 chip/图节点 | `DependencyPeekModal.tsx` | chip 弹层与“打开完整详情”E2E 通过 |
| 发现轨道评测 | `npm run eval:discovery` | `eval-discovery.ts` + `evals/discovery/cases` | 5 用例 100% 通过；输出 schema/GWT/测试映射/条款指标 |
| 度量 | `GET /api/metrics` | `metrics.ts` | Playwright Suite D |
| Task 规划 → 执行 → DoD | `POST /api/stories/:id/start` | `task-plan.ts` → `task-runner.ts` → `context.ts` | 真实 E2E：3 Task 按 T1→T2→T3 执行，Story DoD 通过并合并 |
| 计划审批 → 编辑 → 并行 | `POST /api/stories/:id/tasks/plan`、`PATCH .../tasks/:taskId`、`/api/approvals/:id/decide` | `task-plan.ts`、`task-runner.ts` | E2E：plan 审批暂停；T1/T3 在独立 worktree 并行执行并串行合并；5 Task 全 done |
| Task 重规划 | `POST /api/stories/:id/tasks/replan` | `task-plan.ts`、`task_*` 表 | E2E：已完成 T1 保留，T2–T4 重新规划并执行到 review |
| Team Task 一致性 | `POST /api/stories/:id/start`（teamMode） | `team.ts`、`task-runner.ts` | E2E：Lead 规划 → Dev 执行 3 Task → QA pass → DoD pass → review/合并 |
| Task 上下文 | `GET /api/stories/:id/context` | `context.ts` | API 实测包含当前 Task/上游产出/项目档案/架构/代码索引 |
| Task 失败/恢复 | `POST /api/stories/:id/tasks/:taskId/retry`、`/stories/:id/resume` | `task-runner.ts` | 失败 Task 重置、resume 从首个未完成 Task 继续（脚本/API 验证） |
| Task 度量 | `GET /api/metrics/tasks` | `db.ts`、`TaskTab.tsx` | 一次通过率/尝试/周期/token 返回并在任务页展示 |
| 需求迭代 | `POST /api/requirements/:id/change-requests`、`/change-requests/:id/*` | `changes.ts`、`ChangeRequestPanel.tsx` | E2E：影响 6 故事 → 批准 increment → 派生需求；revision/action/度量通过 |
| Bug 反馈 → 修复 | `POST /api/stories/:id/bugs`、`/bugs/:id/*` | `bugs.ts`、`BugReportModal.tsx`、`BugInbox.tsx` | E2E：done 故事 Bug → 修复故事 4 Task → DoD → accepted→fixed→verified→closed |
| Bug 重复/外部来源 | `/bugs/import`、`/change-requests/import`、`duplicate_of` | `bugs.ts`、`changes.ts` | E2E：外部 ID 保留；相似 Bug 97% 命中并标记 duplicate |
| 反馈 UI | 需求页/故事 Drawer/TopBar | `ChangeRequestPanel.tsx`、`BugInbox.tsx`、`BugReportModal.tsx` | Playwright：创建/分析/批准/物化、Bug 上报/建议/分诊，无控制台错误 |
| 反馈度量 | `/metrics/changes`、`/metrics/bugs` | `db.ts`、`changes.ts`、`bugs.ts` | 变更 total/approved/materialized/impact；Bug open/overdue/MTTR/reopen |
| 文档注册与生成 | `/api/projects/:id/documents`、`/documents/:id/regenerate` | `documents.ts`、`document-generator.ts`、`DocsPage.tsx` | E2E：入驻生成概览/架构/代码图谱/需求基线；AI 重新生成并校验章节 |
| 需求落文档 | `POST /api/requirements/:id/approve` | `discovery.ts` → `documents.ts` | E2E：5 故事批准后生成 req-80cd44aa + index，含追溯矩阵 |
| 文档同步与冲突 | `/api/projects/:id/documents/sync` | `documents.ts` | E2E：new→written→unchanged；外部编辑→conflict→跳过，force 覆盖 |
| 文档上下文 | `GET /api/stories/:id/context` | `document-context.ts`、`context.ts` | E2E：上下文含文档地图与 requirements/req-* 章节引用 |
| 新鲜度与版本 | `/documents/refresh`、`/documents/:id/rollback` | `documents.ts`、`service.ts` | E2E：提交变更后 architecture stale；编辑/发布/回滚生成 v3；pinned 生效 |
| 文档 UI | TopBar“项目文档” | `DocsPage.tsx` | Playwright 8 项断言：分类/详情/追溯/版本/同步/一致性/缺失生成，无 console 错误 |

> 说明：上述 E2E 为本地 Playwright 脚本与截图验证，尚未作为可重复测试套件提交到仓库，因此 REQ-NFR-008 仍为“计划中”。

## 16. 交付、评审与运营能力（P1/P2）

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-REL-001 | 人工发布 | done 故事由人工触发发布命令，记录状态、输出与事件 | 已实现 | `server/src/release.ts`、`Drawer.tsx` |
| REQ-REL-002 | 人工回滚 | 仅对最近成功发布回滚；失败记录 rollback_failed | 已实现 | `server/src/release.ts` |
| REQ-INT-001 | 契约检查门禁 | 合并前在 worktree 执行契约命令，失败阻止合并 | 已实现 | `server/src/service.ts` |
| REQ-INT-002 | 合并串行化 | 并发验收通过进程内合并队列串行执行 | 已实现 | `server/src/service.ts` |
| REQ-SEC-008 | 安全/质量策略门禁 | 项目可配置 block/warn 策略命令，block 失败阻止 review | 已实现 | `server/src/db.ts`、`server/src/ops.ts`、设置页 |
| REQ-REVIEW-001 | 评审工作台 | AC 清单与逐条证据、风险 diff 摘要、按 AC 退回反馈 | 已实现 | `Drawer.tsx`、`server/src/ops.ts` |
| REQ-DISC-020 | 生产反馈与变更影响 | 反馈转需求；已批准需求变更返回故事影响与建议，不覆盖已交付 | 已实现 | `server/src/routes.ts`、`RequirementsPage.tsx` |
| REQ-KNOW-001 | 知识库与检索 | ADR/规范/失败记忆 CRUD；轻量语义检索注入发现与交付提示词 | 已实现 | `server/src/knowledge.ts`、`server/src/db.ts`、设置页 |
| REQ-MET-001 | 质量/成本度量 | 一次通过率、评审耗时、每接受故事 tokens、返工次数 | 已实现 | `server/src/metrics.ts`、`MetricsModal.tsx` |
| REQ-MODEL-001 | 阶段模型路由 | 发现模型与交付模型可独立配置，留空回退 | 已实现 | `server/src/discovery.ts`、设置页 |

## 17. Story Task 执行轨道（P0/P1/P2 已实现）

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-TASK-001 | Task 数据模型与状态 | Task 归属 Story，持久化 key/seq/files/AC/verify/attempts/evidence/worktree/tokens；状态 pending/in_progress/done/failed/skipped；不进入看板/WIP | 已实现 | `shared/src/index.ts`、`server/src/db.ts`（story_tasks/task_dependencies/story_task_plans） |
| REQ-TASK-002 | AI 任务规划与 DAG 校验 | 启动时生成 2–8 个 Task，校验 DAG、AC 覆盖、重复/占位；失败修复一次，仍失败降级单 Task | 已实现 | `server/src/task-plan.ts`、`server/src/templates.ts`、`server/src/scripts/task-plan-check.ts` |
| REQ-TASK-003 | 拓扑调度与串行执行 | 平台按拓扑序选择可执行 Task；同一时刻串行模式只执行一个；Agent 只收到当前 Task | 已实现 | `server/src/task-runner.ts`、`server/src/task-plan.ts` |
| REQ-TASK-004 | Context Pack | 注入当前 Task/Story/AC、上游 Task、前置故事/需求 Handoff、当前需求 intake、兄弟/下游故事、项目画像/架构/术语表、代码索引、知识库；按预算裁剪 | 已实现 | `server/src/context.ts`、`GET /api/stories/:id/context` |
| REQ-TASK-005 | Task 级验证与证据 | 配置 verifyCommand 时在对应 worktree 执行；失败不标记 done，输出进入重试提示词；事件记录 task.verify | 已实现 | `server/src/task-runner.ts`、`web/src/components/TaskTab.tsx` |
| REQ-TASK-006 | 失败重试、阻塞与恢复 | 单 Task 最多 maxTaskAttempts 次；超限 Story blocked；resume 从第一个未完成 Task 继续；重启恢复 in_progress 与孤儿 worktree | 已实现 | `server/src/task-runner.ts`、`server/src/service.ts` |
| REQ-TASK-007 | 计划编辑与人工审批 | 可编辑标题/描述/文件/AC/verify/依赖；编辑后复校验；taskPlanReview=never/risky/always，拒绝后 blocked | 已实现 | `server/src/task-plan.ts`、`server/src/routes.ts`、`TaskTab.tsx`、设置页 |
| REQ-TASK-008 | Task 度量 | 返回计划规模、一次通过率、平均尝试、平均周期、token；Drawer 任务页展示 | 已实现 | `server/src/db.ts`（storyTaskMetrics）、`GET /api/metrics/tasks` |
| REQ-TASK-009 | 并行 worktree 与合并 | 无依赖、文件不冲突的 Task 在独立 worktree 并行；完成后串行合并回故事分支；冲突安全中止并 blocked | 已实现 | `server/src/task-runner.ts`、设置页 |
| REQ-TASK-010 | 关键路径与 Task token 归因 | Task DAG 计算关键路径并在 API/UI 展示；按 ACP usage 事件归因 Task tokens | 已实现 | `server/src/task-plan.ts`、`server/src/task-runner.ts`、`TaskTab.tsx` |
| REQ-TASK-011 | 自适应重规划 | 保留已完成 Task，只重规划 pending/failed；新计划通过 DAG/AC 复校验 | 已实现 | `server/src/task-plan.ts`、`POST /api/stories/:id/tasks/replan`、`TaskTab.tsx` |
| REQ-TASK-012 | Team/Solo 一致性 | Team 与 Solo 共用 Task Plan、执行器、验证与状态 | 已实现 | `server/src/team.ts`、`server/src/task-runner.ts` |
| REQ-TASK-013 | 跨 Story Task 依赖 | 不开放；跨故事继续使用 Story DAG，避免绕过 Story 门禁 | 挂起 | `docs/task-execution.md` |

## 18. 需求迭代与 Bug 反馈轨道（P0/P1/P2 已实现）

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-FB-001 | RequirementChangeRequest | 已批准/已交付需求可发起变更；记录基线版本、类型、来源、原因；原需求不被直接修改 | 已实现 | `server/src/changes.ts`、`requirement_change_requests`、`ChangeRequestPanel.tsx` |
| REQ-FB-002 | 变更影响分析 | 列出受影响故事及 adjust/rework/add_increment/add_regression 建议；人工可修改动作 | 已实现 | `server/src/changes.ts`、`POST /change-requests/:id/analyze` |
| REQ-FB-003 | 变更决策与物化 | 批准 revision/increment；物化创建 `derived_from_requirement` 新需求，不改变需求树父子关系 | 已实现 | `server/src/changes.ts`、`POST /change-requests/:id/materialize` |
| REQ-FB-004 | 变更度量与迭代 | 变更总数/批准/物化/影响故事/周期；支持 iteration 过滤 | 已实现 | `server/src/db.ts`、`server/src/changes.ts`、`GET /metrics/changes` |
| REQ-FB-005 | Bug 上报与分诊 | 基于故事上报复现步骤/期望/实际/环境/证据/AC；人工分诊 severity/priority/reproducibility | 已实现 | `server/src/bugs.ts`、`BugReportModal.tsx`、`BugInbox.tsx` |
| REQ-FB-006 | Bug 修复故事 | done 故事接受 Bug 后创建关联修复故事，带原故事、Bug、AC、回归测试；review/in_dev 关联返工 | 已实现 | `server/src/bugs.ts`、`stories.bug_id/source_story_id` |
| REQ-FB-007 | Bug 生命周期 | fixing→fixed→verified→closed；重开计数；人工验证/关闭，不自动关闭 | 已实现 | `server/src/bugs.ts`、`POST /bugs/:id/verify\|close\|reopen` |
| REQ-FB-008 | AI/规则分诊与重复 | 只读 AI 建议 severity/priority/duplicates；失败回退规则；人工确认后写入 | 已实现 | `server/src/acp/utility.ts`、`bugTriagePrompt`、`server/src/bugs.ts` |
| REQ-FB-009 | 回归门禁 | 修复故事创建时生成回归 AC 与测试映射；仍走 Story DoD/AC/人工验收 | 已实现 | `server/src/bugs.ts`、`createAcceptance` |
| REQ-FB-010 | Bug 度量 | 未关闭/已关闭/逾期/MTTR/重开率/严重度分布 | 已实现 | `server/src/db.ts`、`GET /metrics/bugs`、`BugInbox.tsx` |
| REQ-FB-011 | 外部来源与 SLA | Bug/变更可携带 externalId/externalUrl；Bug 上报计算 SLA 截止时间并统计逾期 | 已实现 | `/api/bugs/import`、`/api/change-requests/import`、设置页 `bugSlaDays` |
| REQ-FB-012 | 基线不可变 | 不对 approved 需求或 done 故事直接覆盖；变更/修复均派生新工作项 | 已实现 | `server/src/changes.ts`、`server/src/bugs.ts` |

## 19. 项目文档轨道（P0/P1/P2 已实现）

| ID | 需求 | 验收标准 | 状态 | 实现证据 |
| --- | --- | --- | --- | --- |
| REQ-DOC-001 | 文档注册表与分类 | 按 10 类文档（概览/需求/架构/编码规范/代码图谱/数据库/API/测试/运维/安全）管理；记录状态、版本、来源、checksum、autoUpdate、watchedGlobs、pinned | 已实现 | `shared/src/index.ts`、`server/src/db.ts`（project_documents/document_versions/document_sections） |
| REQ-DOC-002 | 旧档案迁移与确定性文档 | 旧 `project_profiles.architecture` 自动迁入文档；入驻生成项目概览与代码图谱（模块/文件依赖、Mermaid、入口、符号统计） | 已实现 | `server/src/documents.ts`、`server/src/indexer.ts`、`server/src/onboard.ts` |
| REQ-DOC-003 | 规范需求文档 | 已批准需求按固定结构编译，包含元数据、目标、条款、故事、GWT/AC/测试映射、依赖、变更历史、追溯矩阵；批准/拆分/变更后自动更新 | 已实现 | `server/src/documents.ts`、`server/src/discovery.ts`、`server/src/split.ts`、`server/src/changes.ts` |
| REQ-DOC-004 | 老项目需求基线 | 首次入驻只读分析代码并生成“现状需求基线（代码推断）”，明确标注待人工确认，不冒充已批准需求 | 已实现 | `server/src/document-generator.ts`、`legacyRequirementsBaselinePrompt` |
| REQ-DOC-005 | AI 文档生成与任务治理 | 架构/规范/数据库/API/测试/运维/安全在临时 detached worktree 中只读生成；job 有心跳、超时、取消、错误状态与必需章节校验 | 已实现 | `server/src/document-generator.ts`、`document_jobs`、`DOC_GENERATION_TIMEOUT_MS` |
| REQ-DOC-006 | docs 同步 | 预览 new/modified/unchanged/conflict；外部修改默认冲突，需 force；原子写入 `docs/riccon/<type>/<slug>.md`，不自动 commit | 已实现 | `server/src/documents.ts`、`/documents/sync`、`DocsPage.tsx` |
| REQ-DOC-007 | 文档驱动上下文 | 需求/规划/执行/QA 阶段按权重注入文档地图 + 章节正文 + 版本/引用/过期提示；预算裁剪；优先级写入提示词 | 已实现 | `server/src/document-context.ts`、`server/src/context.ts`、`server/src/discovery.ts` |
| REQ-DOC-008 | 新鲜度与自动更新 | `sourceCommit + watchedGlobs` 标记 stale；概览/代码图谱/需求文档可自动重建；故事验收合并后刷新索引与文档 | 已实现 | `server/src/documents.ts`、`server/src/service.ts` |
| REQ-DOC-009 | 版本、回滚与人工锁定 | 每次内容变化生成版本；支持查看历史与回滚为新草稿；人工编辑设置 pinned，重新生成不静默覆盖 | 已实现 | `server/src/documents.ts`、`/documents/:id/versions\|rollback\|pinned`、`DocsPage.tsx` |
| REQ-DOC-010 | 一致性检查 | 需求文档 ↔ 需求/故事；代码图谱 ↔ 入口；API 文档 ↔ 路由；数据库文档 ↔ 迁移表/模型；返回可定位问题 | 已实现 | `server/src/documents.ts`、`/documents/consistency`、`DocsPage.tsx` |
| REQ-DOC-011 | 变更文档影响 | 需求变更面板展示受影响文档（需求主文档、索引、架构/规范/数据库/API/测试/运维） | 已实现 | `server/src/documents.ts`、`ChangeRequestPanel.tsx` |
| REQ-DOC-012 | 文档度量与入口 | 展示总数/发布/草稿/过期/同步/自动更新/锁定；TopBar“项目文档”替代旧项目档案入口；缺失类型可一键生成 | 已实现 | `server/src/documents.ts`、`DocsPage.tsx`、`TopBar.tsx` |
| REQ-DOC-013 | 安全与预算 | 生成只读、路径白名单、证据脱敏、禁止输出真实密钥；文档上下文受 `taskContextChars` 预算约束 | 已实现 | `server/src/document-generator.ts`、`server/src/document-context.ts` |
| REQ-DOC-014 | 可验证性 | 提供 `npm run check:documents` 覆盖章节解析、版本、同步冲突、上下文与注册表；UI Playwright 验证通过 | 已实现 | `server/src/scripts/document-check.ts`、`docs/document-track.md` |
