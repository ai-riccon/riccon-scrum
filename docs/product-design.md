# riccon·scrum 产品设计（现状基线）

> 状态：As-built，描述当前代码的实际行为，不是未来愿景。
> 基线日期：2026-11-12。上游需求发现为规划能力，见 [discovery-track.md](./discovery-track.md)。

## 1. 产品定位

riccon·scrum 是一个以 ACP（Agent Client Protocol）为终端抽象层的敏捷交付平台：

- 把一个 git 仓库注册为项目；
- 用用户故事驱动 AI agent 在**独立 worktree** 中实现；
- 用**机器可执行的 DoD 门禁**判定完成质量；
- 用**人工审批**控制就绪、权限、冲突与合并；
- 全流程事件化、可回放、可度量。

它解决的不是“让 agent 写代码”，而是“让 agent 的产出可被组织安全地验收”。因此平台侧始终掌握编排、门禁、隔离和审计，agent 只是可替换的执行终端。

## 2. 目标用户与角色

### 2.1 人类角色

| 角色 | 关注点 | 在系统中的动作 |
| --- | --- | --- |
| 项目负责人 / Tech Lead | 范围、质量、风险 | 注册项目、配置 DoD、批准故事就绪、验收合并、处理权限与冲突 |
| 开发者 | 任务进度与返工 | 查看 diff、实时转录、给出返工原因、恢复会话 |
| 观察者 | 交付度量 | 查看看板、事件流、指标、项目画像与代码搜索 |

当前版本没有登录与 RBAC，默认单用户、单机、单团队使用。

### 2.2 Agent 角色

| 角色 | 职责 | 产生方式 |
| --- | --- | --- |
| `solo` | 单 agent 完成实现与自测 | 非团队模式 |
| `lead` | 拆解任务、给出实现计划与文件范围 | 团队模式 plan 阶段 |
| `dev` | 按计划实现、修复 QA 问题 | 团队模式 implement 阶段 |
| `qa` | 独立评审 diff 与验收标准，给通过/不通过结论 | 团队模式 verify 阶段 |
| `po`（规划中） | 需求澄清、故事起草、DoR 自检、按反馈修订 | 需求发现轨道 |

Agent 终端通过 `AgentSpec` 适配，当前支持：

- `opencode`（默认，ACP 模式）；
- `claude-code`（`@zed-industries/claude-code-acp` 适配器）；
- `qoder-cli`（隐藏 `--acp`，剥离 `QODER*` 环境变量，空 MCP 配置）。

## 3. 设计原则

1. **人负责决策，agent 负责执行**。就绪、权限、冲突、合并都必须有人类决策记录。
2. **隔离优先**。每个故事独立分支与 worktree；agent 的数据库与用户交互式数据分离；进程环境按终端裁剪。
3. **门禁可验证**。DoD 以命令和证据为准，不以 agent 自述为准。
4. **事件即事实**。状态变化、消息、工具调用、审批、DoD 结果都写入 append-only 事件表，并通过 WebSocket 广播与回放。
5. **终端无关**。编排逻辑只在平台侧，agent 通过 ACP 接入，不把某个 CLI 的行为写进业务流程。
6. **最小权限**。只自动批准读/搜索与白名单命令；写、删、移动、执行默认必须人工批准。

## 4. 核心概念

| 概念 | 说明 |
| --- | --- |
| Project | 一个 git 仓库及其交付配置：默认分支、DoD 命令、agent 终端、模型、术语表、团队模式、自动审批策略 |
| Story | 用户故事：标题、描述、BDD 验收标准、状态、分支与 worktree |
| Story Task | 故事内部的实现任务：标题、文件范围、AC 映射、依赖、验证命令与状态；不进入看板/WIP |
| Task Plan | 一个故事的 Task DAG + 策略/模型/来源；键与依赖均持久化，可人工编辑与重规划 |
| Context Pack | 按优先级与预算组装的任务上下文：当前 Task/Story/AC、上游 Task、故事/需求依赖、项目档案、代码索引与知识库 |
| DoD Item | 完成定义条目：test/build/lint/custom/human/doc，含状态与证据 |
| Agent Session | 一次 agent 进程会话：终端、角色、模型、ACP session id、状态 |
| Approval | 待人工决策：permission/plan/accept/merge/conflict |
| Team Run | 团队编排运行：阶段、计划、QA 结论、轮次、token |
| Requirement | 需求：原始输入、状态、当前/批准版本；发现轨道的聚合根 |
| Requirement Version | 需求草稿的不可变版本：结构化故事、校验问题、模型 |
| Requirement Feedback | 人工反馈：绑定版本与故事键，记录批/驳/意见与决策人 |
| Requirement Change Request | 已批准需求的迭代反馈：基线版本、变更类型/来源、影响分析、人工决策、派生需求；不是需求子节点 |
| Bug Report | 基于已有故事的缺陷：复现/期望/实际、严重度/优先级、分诊、修复故事、验证/关闭/重开 |
| Event | 追加式事件：故事状态、消息、工具、计划、会话、审批、DoD、预算、冲突、需求、变更、Bug |
| Project Profile | 入驻产物：技术栈画像、基线测试结果；架构文档已迁入 Project Document |
| Project Document | 项目文档：类型、状态、版本、内容、来源提交、自动更新策略、人工锁定与同步状态 |
| Document Section | 文档按 Markdown 标题切分后的章节索引，用于阶段化上下文检索 |
| Document Sync | 文档与仓库 `docs/riccon/` 托管文件的 checksum 与同步记录 |
| Code Index | 仓库文件与符号索引，用于实现上下文与搜索 |

## 5. 端到端流程（现状）

### 5.1 注册与入驻

1. 用户注册项目，填写仓库路径、默认分支、agent 终端、模型、团队模式等。
2. 可选“入驻”：确定性扫描技术栈 → 建立代码索引 → 生成项目概览与代码图谱 → 在临时 detached worktree 中让 agent 生成架构文档与老项目需求基线 → 运行基线测试 → 保存画像与文档。
3. 若项目尚未配置 DoD，入驻会把发现的测试命令自动写入 DoD 配置。
4. 旧项目的 `project_profiles.architecture` 在首次打开文档中心时自动迁入 Project Document。

### 5.2 故事创建与就绪

1. 用户在“新建用户故事”中填写标题、描述、BDD 验收标准。
2. 故事以 `draft` 创建，并按项目 DoD 配置播种 DoD 条目，另加一条人工验收项。
3. 用户点“批准就绪”，平台校验：
   - 验收标准非空；
   - 若项目要求机器 DoD，至少存在一条带命令的 DoD。
4. 通过后进入 `ready`。

### 5.3 开发执行（Solo）

1. 启动时检查 WIP 上限、故事依赖与仓库有效性。
2. 从默认分支创建 `story/<shortId>-<slug>` 分支与独立 worktree。
3. 重置 DoD 状态，故事进入 `in_dev`。
4. **任务规划**：只读规划会话注入规划阶段文档地图/相关章节，生成 2–8 个 Task + 依赖 DAG + AC 映射；校验失败修复一次，仍失败降级单 Task。
5. 平台按拓扑序选择可执行 Task；每个 Task 使用 Context Pack（含执行阶段文档章节、版本引用与 stale 提示）提示词执行，完成后做任务级验证（可选 verify 命令）并标记状态。
6. 全部 Task 完成/人工跳过后执行 Story DoD：
   - 全部通过 → `review`；
   - 未通过 → 保持 `in_dev`，并提示按失败证据修复。
7. 默认串行；开启并行且 Task 无依赖、文件不冲突时，各自在独立 worktree 执行，完成后串行合并回故事分支。

### 5.4 团队编排

团队模式复用同一 Task Plan 与执行器，阶段为：

1. **Plan**：Task Planner 生成结构化任务计划、依赖与预计文件；更新 `team.plan` 事件兼容旧 UI。
2. **冲突门**：与其它 in_dev 故事的文件范围重叠时，产生 `conflict` 审批，人工拒绝则阻塞。
3. **Implement**：Dev 会话按 Task DAG 执行；每个 Task 有边界、验证与证据。
4. **QA / verify**：全部 Task 完成后独立评审 diff 与验收标准，输出 `{pass, issues}`。
5. **Gate**：QA 通过且 DoD 全过 → `review`；否则带问题返工 Dev，最多 `maxRework` 次。
6. 预算：轮次、墙钟、token 任一超限 → `blocked` 并记录 `budget.exceeded`。

### 5.4.1 Story Task 执行规则

- Task 是故事内部实现单元，不进入看板、WIP、交付度量；Story 仍是唯一验收单位。
- Task 依赖使用独立 `task_dependencies` DAG，不混入项目级需求/故事依赖表。
- 平台是顺序与状态的唯一事实来源；agent 只收到当前 Task 与只读上下文，不允许自行改写全局顺序。
- 失败重试上限由 `maxTaskAttempts` 控制；超限后故事 blocked，保留可恢复信息。
- 人工可重试、跳过（必填原因并审计）、编辑计划或重规划未完成任务；已完成 Task 不删除。
- 任务级验证不替代 Story 的 AC 证据/DoD/人工验收。

### 5.5 评审与验收

1. 故事进入 `review` 后，人工查看概览、实时转录、团队阶段、DoD 证据与 diff。
2. “退回修改”必须填写原因；平台恢复该故事的实现会话（优先 dev/solo），把原因作为新指令。
3. “验收并合并”：
   - 再次确认带命令的 DoD 全部通过；
   - 记录一条 `accept` 审批（`decidedBy=human`）；
   - 提交 worktree 改动；
   - 以 `--no-ff` 合并到默认分支；
   - 标记人工 DoD 通过，停止会话，故事 `done`，移除 worktree。

### 5.6 权限与审批

- 读/搜索：可配置自动批准。
- 执行命令：仅自动批准配置的前缀白名单；其余人工。
- 写/删除/移动/抓取：默认人工。
- 自动批准也写入审批记录，`decidedBy=policy`，保留审计。
- 所有待决审批进入右侧 Rail，可批准或拒绝。

### 5.7 需求发现轨道（P0/P1 已实现）

1. 用户创建需求：标题 + 原始输入 + 可选结构化 intake（目标、用户、约束、非目标、成功指标、示例）。
2. 生成草稿：在临时 detached worktree 中启动只读 agent，注入项目画像、架构文档、术语表、代码索引、需求阶段文档地图/相关章节与现有/历史故事，输出结构化 JSON；生成任务有心跳、总超时与取消能力。
3. 确定性校验：schema、3–8 个故事、GWT 完整性、每故事 DoD、来源条款、规模、与现有/历史故事的相似度；随后由 Critic 独立评审；error 阻断批准，warn 展示。
4. 澄清：v1 若存在开放问题，需求进入 `clarifying`；人工逐条回答后重新生成。
5. 人工评审：整体意见 + 逐故事通过/驳回/意见；提交后生成新版本。
6. 定向修订：没有整体意见时，只允许被反馈的故事变化，其余故事保留上一版内容。
7. 版本对比：展示新增/修改/删除/未变故事与变更 key。
8. 批准物化：再次校验后在单事务内创建 `ready` 故事与 `story_acceptance` 证据条目，写入需求 id、版本 id、来源故事 key 与来源条款；随后进入现有交付闭环，并确定性编译需求文档与索引。
9. 交付证据：DoD 命令通过且输出命中 AC 的 Test 名称时，该 AC 记为 pass；工作台与故事抽屉展示逐条证据，未全部通过的 AC 阻止故事进入 review。
10. 需求级度量：平均版本、首版通过率、平均周期、条款覆盖率、物化故事数。
11. 对话式 intake：用户一句话创建需求，AI 最多追问 3 轮并结构化 goal/users/successMetrics；确认后生成、零错误自动物化。
12. 需求拆分：AI 先生成 2–6 个子需求草案并持久化，人工可取消勾选、修改标题后确认；确认才创建子需求与依赖，父需求转 `split`。
13. 分类与标签：需求/故事单一主分类（≤3 级，筛选含子孙）与多标签（跨分类关注点），支持列表/看板/图筛选。
14. 依赖：需求与故事统一 Finish-to-Start DAG；建边拒绝自依赖、重复和环；故事启动前校验前置，允许填写原因 override 并记录审计；需求“交付”按故事全部完成（拆分需求递归到子需求）判定。
15. Handoff：故事验收时持久化 diff 摘要、关键文件、契约、迁移、DoD/AC 证据与评审决策；后续需求/故事生成优先读取结构化 Handoff，缺失时回退到故事字段。
16. 图视图：DAG（状态/分类着色、等待前置、环告警、关键路径）、活动图（开始/结束）、需求范围用例图；支持导出 Mermaid。
17. AI 分类/标签治理：点击入口先展示现有分类树/标签词表，不自动生成；人工点击“AI 重新生成”后才生成建议，确认后才应用；草稿输出 categoryPath/tags，批准时匹配现有分类并自动创建/复用标签。
18. 语义搜索：需求/故事统一混合检索（标题、rawInput、intake、AC、分类标签、Handoff）；可在设置页配置 OpenAI 兼容 embedding 地址/模型/API Key，未配置时词法回退；全局搜索可直接打开详情。
19. AI 依赖建议：基于检索候选输出前置/后续、理由、置信度；服务端 DAG 校验，人工勾选后创建。
20. 依赖详情：依赖 chip、图节点可点击弹出事项摘要、状态、分类标签、依赖与 Handoff，可打开完整详情。

### 5.8 需求迭代与 Bug 反馈（P0/P1/P2 已实现）

需求迭代：

1. 已批准/已交付需求发起 ChangeRequest，记录基线版本、变更类型（corrective/adaptive/perfective）、来源与原因；原需求版本保持不变。
2. 确定性影响分析列出受影响故事与建议动作（adjust/rework/add_increment/add_regression）；人工可逐故事调整。
3. 人工批准 `revision` 或 `increment`；物化后创建 `derived_from_requirement` 的新需求，不写入需求父子树。
4. 新需求沿用现有草稿/DoR/Critic/批准/物化/Story/Task 闭环；变更度量记录批准、物化、影响故事数与周期。
5. 旧 `/requirements/:id/change-request` 保留兼容，但内部走 ChangeRequest + increment + materialize，不再创建需求子节点。

Bug 反馈：

1. 在 Story Drawer 上报 Bug：原故事、AC、复现步骤、期望/实际、环境、证据、严重度、优先级、可复现性。
2. Bug 进入分诊：规则/AI 建议严重度、优先级、可复现性与重复候选；人工确认后写入，重复必须显式 `duplicate_of`。
3. `review/in_dev` 故事接受 Bug 后关联当前故事返工；`done` 故事接受后创建关联修复故事（draft），带原故事、Bug、回归 AC 与回归测试名。
4. 修复故事走现有 Story/Task/DoD/AC/人工验收；验收后 Bug 从 fixing 变 fixed。
5. 人工 verify → verified → close；可 reopen 并累计重开次数。Bug SLA 截止时间与逾期、MTTR、重开率、严重度分布可查询。

### 5.9 项目文档中心（P0/P1/P2 已实现）

1. TopBar“项目文档”替代旧“项目档案”，按 10 类文档分组：概览、需求、架构、编码规范、代码图谱、数据库、API、测试、运维、安全。
2. 入驻生成概览、代码图谱、架构与老项目需求基线；旧项目首次打开自动迁移架构文档。
3. 已批准需求确定性编译为规范需求文档与索引；批准、拆分、变更物化后自动更新，包含条款、故事、GWT/AC/测试映射、依赖、变更历史与追溯矩阵。
4. AI 文档在临时 detached worktree 中只读生成，job 有心跳、超时、取消与必需章节校验；结果默认草稿，人工发布。
5. 文档可按 `docs/riccon/<type>/<slug>.md` 同步：先预览 new/modified/unchanged/conflict；外部修改默认冲突，force 才覆盖；原子写入且不自动 commit。
6. `sourceCommit + watchedGlobs` 检测过期；概览、代码图谱、需求文档可自动重建；故事验收合并后刷新索引与文档。
7. 文档版本可查看/回滚；人工编辑设置 pinned，重新生成不静默覆盖。
8. 一致性检查覆盖需求文档 ↔ 故事、代码图谱 ↔ 入口、API 文档 ↔ 路由、数据库文档 ↔ 迁移；变更单展示受影响文档。
9. 需求/规划/执行/QA 阶段按权重注入文档地图、章节正文、版本与引用；过期文档降权并标注，预算受 `taskContextChars` 约束。

## 6. 状态机

### 6.1 故事

| 当前 | 可进入 |
| --- | --- |
| draft | ready, blocked |
| ready | in_dev, draft, blocked |
| in_dev | review, blocked, ready |
| review | done, in_dev, blocked |
| blocked | draft, ready, in_dev |
| done | 终态 |

### 6.2 会话

`starting → running → idle → stopped`，异常为 `error`。

### 6.3 团队阶段

`plan → implement → verify → gate`；gate 可回到 implement 返工，或结束于 review/blocked。

### 6.4 入驻

`idle → scanning → analyzing → baselining → done`，异常为 `error`。

### 6.5 审批

`pending → approved | denied`，记录 `decidedBy` 与 `decidedAt`。

### 6.6 需求

`intake → clarifying → drafting → in_review ⇄ revising → approved → decomposed`；`in_review`/`clarifying` 可转 `split`（子需求已创建），可转 `blocked` 或 `archived`。`clarifying` 表示 AI 已提出开放问题等待人工回答；`approved` 表示范围已批准但尚未物化；`decomposed` 表示故事已创建；`split` 表示已拆成子需求，不再物化故事。

### 6.7 需求变更单

`draft → analyzing → in_review → approved | rejected → materialized`；`materialized` 表示已派生新需求；已物化不可再改影响动作。

### 6.8 Bug

`new → triaged → fixing → fixed → verified → closed`；可 `rejected`、`duplicate`、`reopened`。`fixed` 由修复故事验收触发，`verified/closed` 必须人工确认。

### 6.9 项目文档

`missing → generating → draft → published → stale`；生成失败为 `error`，可归档为 `archived`。`stale` 由源提交变化命中 `watchedGlobs` 触发；人工编辑设置 `pinned`，重新生成默认不静默覆盖。

## 7. 功能清单

| 模块 | 当前能力 |
| --- | --- |
| 项目管理 | 注册、切换、项目级设置、默认分支、模型、团队模式 |
| 入驻 | 技术栈扫描、代码索引、概览/代码图谱、架构文档、老项目需求基线、基线测试、自动 DoD 建议 |
| 项目文档 | 10 类文档分类、版本/章节、AI/确定性生成、过期检测、人工发布/锁定/回滚、docs 同步、一致性与度量 |
| 代码理解 | 文件/符号/import 索引、符号与内容搜索、代码图谱、上下文注入 |
| 故事看板 | 按状态分列、实时运行标记、抽屉详情、新建故事 |
| 需求发现 | 对话式 intake → AI 草稿/拆分草案 → 人工反馈/确认 → 定向修订 → 版本对比 → 批准物化；DoR 清单与需求级度量 |
| 需求/故事组织 | 需求 3 层父子层级；分类 ≤3 级；多标签；列表/看板/图筛选 |
| 依赖与 Handoff | 需求/故事 Finish-to-Start DAG；启动门禁与 override 审计；结构化 Handoff 注入后续上下文 |
| 图视图 | DAG + 关键路径 + 环告警 + Mermaid；故事活动图；需求范围用例图 |
| 发布与回滚 | done 故事人工发布/回滚，记录命令输出与状态 |
| 集成门禁 | 契约检查命令、合并串行化、策略型 DoD（block/warn） |
| 知识库 | ADR/规范/失败记忆 CRUD，轻量语义检索注入发现与交付提示词 |
| 评审工作台 | AC 证据、风险 diff 摘要、按 AC 退回反馈 |
| 运营反馈 | 生产反馈转需求、需求迭代 ChangeRequest、影响分析、派生需求 |
| Bug 反馈 | 故事 Bug 上报、分诊、AI/规则建议、重复检测、修复故事、回归验证、SLA/度量 |
| 故事执行 | Solo / 团队、worktree、分支、WIP 限制、预算、返工 |
| Story Task | AI 任务规划、Task DAG 拓扑调度、任务级验证、重试/跳过/编辑/重规划、关键路径与 token 归因 |
| 任务上下文 | 注入当前 Task/Story/AC、上游 Task、故事/需求依赖 Handoff、项目画像/术语表、代码索引、知识库，以及按阶段选择的文档地图与章节 |
| 文档驱动 | 需求/规划/执行/QA 文档画像、章节检索、版本引用、stale 降权与预算裁剪 |
| 质量门禁 | DoD 命令、文档变更检查、人工验收项、证据留存 |
| 权限审批 | ACP 权限请求、分级自动批准、策略审计、冲突审批 |
| 可观测性 | 事件流、实时转录、工具调用、计划、DoD 结果、指标 |
| 设置 | 全局运行参数 + 项目交付参数（含术语表），逐项说明 |
| 辅助 | 搜索面板、项目文档、流转指标、Toast 通知、刷新不回放提醒 |

## 8. 系统架构

```
web (React + Vite)
  ├─ REST /api/*        （项目、故事、设置、指标、搜索）
  └─ WebSocket /ws      （事件回放 + 实时广播）
          │
server (Fastify + node:sqlite)
  ├─ routes             HTTP 边界
  ├─ service / team     编排与故事生命周期
  ├─ task-plan          Task 规划、DAG 校验、拓扑排序、关键路径、重规划
  ├─ task-runner        Task 调度、串行/并行 worktree、验证、恢复
  ├─ context            Context Pack 组装与预算裁剪
  ├─ documents          文档注册表、需求文档编译、确定性文档、同步、版本、新鲜度、一致性与度量
  ├─ document-generator AI 文档只读生成、证据收集/脱敏、job 心跳/超时/取消
  ├─ document-context   文档地图 + 章节检索 + 阶段权重 + stale 降权
  ├─ discovery          需求发现：草稿生成、校验、反馈、物化
  ├─ intake             对话式 intake 常驻会话、轮次级消息、ready 门控
  ├─ split              AI 拆分草案、人工确认、子需求与继承依赖
  ├─ dependencies       DAG、环检测、启动门禁、Handoff 上下文、图数据
  ├─ ops / dod          DoD 执行与状态迁移
  ├─ git                worktree、diff、commit、merge
  ├─ indexer / scanner  代码索引与技术栈扫描
  ├─ onboard            入驻流水线
  └─ acp
       ├─ agents        终端适配（opencode/claude-code/qoder-cli）
       ├─ runner        ACP 连接、提示、权限、事件
       ├─ manager       会话池、审批等待、空闲回收
       └─ policy        自动批准策略（纯函数）
          │
      ACP 子进程（agent 终端）
```

运行形态：npm workspaces（`shared` / `server` / `web`），单机单进程；SQLite WAL 持久化在 `server/data`；worktree 在 `server/data/worktrees`。

## 9. 数据模型

| 表 | 作用 | 关键字段 |
| --- | --- | --- |
| projects | 项目与交付配置 | repo_path, default_branch, dod_commands, agent_kind, team_mode, model, glossary, require_machine_dod, auto_approve_* |
| stories | 用户故事与执行位置 | status, acceptance_criteria, branch, worktree_path, requirement_id, category_id, source_version, source_version_id, source_story_key, source_clause |
| story_tasks | 故事内部 Task | story_id, key, seq, title, files_json, ac_ids_json, verify_command, status, attempts, evidence, worktree_path, branch, tokens, source |
| task_dependencies | Task Finish-to-Start DAG | task_id, depends_on_task_id；唯一约束 + 应用层环检测 |
| story_task_plans | Task 计划元数据 | story_id, strategy, model, source |
| requirement_change_requests | 需求迭代变更单 | requirement_id, baseline_version, change_type, source, status, impact_json, decision, derived_requirement_id, iteration, external_id/url |
| bug_reports | 故事缺陷与修复追踪 | story_id, requirement_id, ac_ids_json, steps/expected/actual, severity/priority/reproducibility, status, duplicate_of, fix_story_id, regression_test, reopen_count, sla_due_at, external_id/url |
| requirements | 需求与发现状态 | raw_input, intake_json, status, current_version, approved_version, parent_requirement_id, category_id |
| categories | 需求/故事主分类树 | project_id, parent_id, name, path, depth（≤3）, source, status |
| tags / entity_tags | 跨分类标签与分配 | tags(project_id, name, color, source, status)；entity_tags(entity_type, entity_id, tag_id) |
| entity_embeddings | 可选向量索引 | entity_type/id, model, content_hash, vector_json |
| dependencies | 需求/故事 Finish-to-Start 边 | predecessor_type/id, successor_type/id, kind, note；唯一约束 + 应用层环检测 |
| requirement_messages | 对话式 intake 轮次级消息 | role, content, ready |
| requirement_split_drafts | AI 拆分草案（待确认） | requirement_id, version, draft_json, model |
| handoffs | 故事结构化交付物 | entity_type/id, summary, files_json, contracts, migrations_json, dod_json, acceptance_json, decisions_json |
| requirement_jobs | 生成任务租约与心跳 | status, started_at, heartbeat_at, cancel_requested, error |
| releases | 发布/回滚记录 | status, command, output, released_by |
| knowledge | ADR/规范/失败记忆 | kind, title, content, tags |
| requirement_versions | 需求草稿不可变版本 | draft_json, issues_json, model |
| requirement_feedback | 人工反馈与决策 | version, story_key, decision, comment, decided_by |
| story_acceptance | AC 测试映射与逐条证据 | ac_id, given/when/then, test, status, evidence |
| dod_items | 完成定义条目 | kind, label, command, status, evidence |
| agent_sessions | agent 会话 | agent_kind, role, model, acp_session_id, pid, status |
| approvals | 人工决策 | kind, request_json, status, option_id, decided_by |
| events | 追加式事件流 | seq, story_id, type, payload, ts |
| team_runs | 团队编排运行 | phase, plan_json, verdict_json, turns, tokens |
| story_files | 故事计划/触达文件 | story_id, path |
| project_profiles | 入驻画像与基线（架构已迁入文档） | status, profile_json, architecture, baseline_json |
| project_documents | 项目文档注册表 | doc_type, slug, status, content, version, source, source_commit, auto_update, watched_globs, pinned, checksum, error |
| document_versions | 文档不可变版本 | document_id, version, content, source_commit, model, created_by |
| document_sections | 文档章节索引 | document_id, version, anchor, heading_path, ordinal, content, tokens |
| document_sync_state | docs 同步状态 | document_id, target_path, checksum, synced_at |
| document_jobs | 文档生成租约 | project_id, doc_type, slug, status, heartbeat_at, cancel_requested, error |
| code_index | 代码索引 | path, language, symbols_json, imports_json, mtime, size |
| app_settings | 全局设置 | key, value |

迁移策略：启动时 `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` 检查后 `ALTER TABLE ADD COLUMN`，适合当前单机阶段；进入多实例前需改为版本化迁移。

## 10. API 概览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /api/projects | 未归档项目列表（`includeArchived=1` 含归档项目） |
| POST | /api/projects | 新建项目（选择本地文件夹，不要求 git 仓库） |
| POST | /api/projects/:id/archive\|unarchive | 归档 / 恢复项目 |
| DELETE | /api/projects/:id | 永久删除已归档项目（级联清理平台数据） |
| GET | /api/projects/:id/git | 仓库状态、当前分支与本地分支列表 |
| POST | /api/projects/:id/git/init\|checkout | 创建本地仓库 / 切换分支 |
| GET | /api/fs/dirs | 新建项目时浏览文件夹 |
| POST | /api/projects/:id/settings | 更新项目设置 |
| POST | /api/projects/:id/onboard | 启动入驻 |
| GET | /api/projects/:id/profile | 入驻画像 |
| GET | /api/projects/:id/documents | 文档列表与度量入口 |
| POST | /api/projects/:id/documents/:docType/generate | 生成指定类型文档（确定性或 AI） |
| GET | /api/documents/:id | 文档详情、章节、版本、同步与 job |
| POST | /api/documents/:id/regenerate\|cancel | 重新生成 / 取消生成 |
| PUT | /api/documents/:id | 人工编辑（pinned） |
| POST | /api/documents/:id/publish\|rollback | 发布 / 回滚版本 |
| PUT | /api/documents/:id/pinned | 锁定/解锁 |
| GET | /api/documents/:id/versions | 版本历史 |
| GET/POST | /api/projects/:id/documents/sync | 同步预览 / 应用（force） |
| POST | /api/projects/:id/documents/refresh | 刷新索引与确定性文档、标记 stale |
| GET | /api/projects/:id/documents/metrics\|consistency\|impact | 文档度量 / 一致性 / 变更影响 |
| POST/GET | /api/projects/:id/index | 建立/查询代码索引 |
| GET | /api/projects/:id/search | 代码搜索 |
| GET | /api/settings | 全局设置与 agent 列表 |
| GET/POST/PUT/DELETE | /api/categories | 分类树 CRUD（≤3 级） |
| GET/POST/DELETE | /api/tags | 标签 CRUD |
| PUT | /api/requirements/:id/tags、/api/stories/:id/tags | 覆盖实体标签 |
| PUT | /api/requirements/:id/category、/api/stories/:id/category | 设置主分类 |
| GET/POST/DELETE | /api/dependencies | 依赖边查询/创建/删除 |
| GET | /api/graph?type=requirement\|story | DAG 节点、依赖/包含边、环 |
| GET/POST | /api/requirements/:id/split/draft | 读取/生成拆分草案 |
| POST | /api/requirements/:id/split/confirm | 确认选中子需求并创建 |
| GET | /api/stories/:id/handoff | 结构化交付物（done 故事可回填） |
| POST | /api/taxonomy/preview | AI 生成分类树/标签/归类提议（不落库） |
| POST | /api/taxonomy/apply | 人工确认后应用 AI 分类/标签提议 |
| GET | /api/search/entities | 需求/故事混合检索（lexical/hybrid） |
| POST | /api/dependencies/suggest | AI 依赖建议（不落库，人工确认后建边） |
| PUT | /api/settings | 更新全局设置 |
| GET | /api/stories | 故事列表（含 DoD） |
| GET/POST | /api/requirements | 需求列表 / 创建需求 |
| GET | /api/requirements/metrics | 需求级度量 |
| GET | /api/metrics/tasks | Task 度量（规模/通过率/尝试/周期/token） |
| GET/POST | /api/requirements/:id/change-requests | 需求迭代变更单列表/创建 |
| GET/POST | /api/change-requests/:id/analyze、/decide、/materialize | 影响分析、人工决策、派生需求 |
| POST | /api/change-requests/import | 外部来源变更单导入 |
| GET | /api/metrics/changes | 变更度量（支持 iteration） |
| GET/POST | /api/stories/:id/bugs、/api/bugs | 故事 Bug 列表/上报、全局 Bug 列表 |
| GET/POST | /api/bugs/:id/suggest、/triage、/accept | AI/规则分诊建议、人工分诊、接受并创建修复工作项 |
| POST | /api/bugs/:id/verify、/close、/reopen、/reject | Bug 验证/关闭/重开/拒绝 |
| POST | /api/bugs/import | 外部来源 Bug 导入 |
| GET | /api/metrics/bugs | Bug 度量（未关闭/逾期/MTTR/重开率/严重度） |
| GET | /api/requirements/:id | 需求详情、版本与反馈 |
| POST | /api/requirements/:id/generate | 生成/重新生成草稿（异步） |
| POST | /api/requirements/:id/cancel | 取消进行中的生成 |
| POST | /api/requirements/:id/feedback | 保存反馈/澄清回答并触发修订 |
| POST | /api/requirements/:id/approve | 校验并物化故事 |
| POST | /api/requirements/:id/archive | 归档需求 |
| POST | /api/stories | 创建故事 |
| GET | /api/stories/:id | 故事详情、DoD、会话 |
| GET | /api/stories/:id/dod | DoD 明细 |
| GET | /api/stories/:id/team | 团队运行、会话与 Task Plan |
| GET | /api/stories/:id/tasks | Task Plan（任务、依赖、关键路径） |
| POST | /api/stories/:id/tasks/plan | 生成/整体重规划 Task（仅未正式执行时） |
| GET | /api/stories/:id/context | 预览当前/指定 Task 的 Context Pack |
| PATCH | /api/stories/:id/tasks/:taskId | 人工编辑 Task 字段/依赖（DAG 与 AC 覆盖复校验） |
| POST | /api/stories/:id/tasks/:taskId/retry | 重置失败/跳过 Task 为待执行 |
| POST | /api/stories/:id/tasks/:taskId/skip | 人工跳过 Task（必填原因并审计） |
| POST | /api/stories/:id/tasks/replan | 保留已完成 Task，AI 重规划剩余 Task |
| GET | /api/stories/:id/diff | 当前 diff |
| POST | /api/stories/:id/approve | 批准就绪 |
| POST | /api/stories/:id/start | 启动开发 |
| POST | /api/stories/:id/rework | 退回修改 |
| POST | /api/stories/:id/resume | 带指令恢复会话 |
| POST | /api/stories/:id/accept | 验收合并（含契约检查与合并队列） |
| POST | /api/stories/:id/release | 发布 |
| POST | /api/stories/:id/rollback | 回滚 |
| GET/POST | /api/projects/:id/knowledge | 知识库列表/新增；DELETE /api/knowledge/:id |
| POST | /api/feedback | 生产反馈转需求 |
| POST | /api/requirements/:id/change-request | 变更请求与影响分析 |
| GET | /api/metrics/quality | 质量与成本度量 |
| GET | /api/approvals | 审批列表 |
| POST | /api/approvals/:id/decide | 审批决策 |
| GET | /api/events | 增量事件 |
| GET | /api/events/recent | 最近事件 |
| GET | /api/metrics | 流转指标 |
| GET | /api/health | 健康检查 |
| WS | /ws | 事件回放与广播 |

## 11. 安全与隔离

- **worktree 隔离**：所有实现写入发生在独立 worktree；验收后才合并主分支。
- **进程隔离**：agent 子进程按终端裁剪环境；qoder-cli 剥离 `QODER*`，避免继承 Desktop 的 SDK/认证模式；使用空 MCP 配置。
- **数据隔离**：平台 opencode 使用独立 DB，不污染用户交互式数据。
- **最小权限**：自动批准只覆盖读/搜索与命令前缀白名单；敏感操作等待人工。
- **参数化命令**：git 操作使用 `execFile` + argv，不拼接 shell；DoD 命令是管理员配置（等价 CI 配置），按设计使用 shell，且只在 worktree 内执行。
- **文件作用域**：runner 声明 `allowedRoots`，越界访问被拒绝。
- **审计**：审批、状态、DoD、预算、冲突全部写入事件与审批表。
- **不可自动合并**：合并只能由人工验收端点触发。
- **发现阶段只读**：需求生成在临时 detached worktree 中运行；agent 只允许读/搜索，写/删/执行/抓取一律取消；主仓库零写入。
- **物化只由批准触发**：模型输出只是数据，故事创建由平台在人工批准后的确定性事务中执行。

## 11.1 依赖与拆分规则（补充）

- 需求层级：Epic → Feature → Requirement 最多 3 层；用户故事只存在于 Requirement 叶子，不参与需求树。
- 父子是**包含**关系（图中虚线），依赖是独立 **DAG** 边（图中实线），两者不混用。
- 依赖仅支持 Finish-to-Start；进入 `in_dev` 前校验，`ready` 与草稿规划不被阻塞。
- 需求交付：`decomposed` 且所有故事 `done`；`split` 且所有子需求递归交付；`approved` 不算交付。
- 拆分草案：AI 只生成草案，人工勾选/改标题后确认；父需求 `split` 后不再物化故事。
- Handoff：故事验收时生成；字段包括 diff 文件/风险、关键文件、契约结果、迁移文件、DoD、AC 证据、审批/QA/越权决策。缺失时按状态与证据回填。

## 12. 已知限制与非目标

已知限制：

- 无登录、无 RBAC、无多租户；
- 单机 SQLite，未做多实例并发控制；
- 指标基于事件与时间戳，口径较粗；
- token 预算依赖终端上报，部分模型不上报；
- 依赖仅 Finish-to-Start，没有 lag/SS/FF/SF、资源日历与自动排期；
- Task 依赖为故事内部 DAG，不开放跨 Story Task 依赖；跨故事仍走 Story DAG；
- 并行 Task 要求无依赖且文件不冲突；同一 worktree 不并行；合并冲突会安全中止并阻塞故事；
- Task 规划依赖模型质量；校验失败会修复一次，仍失败降级单 Task，不阻断故事；
- 计划审批在进程内等待人工决策，重启后需重新发起（审批记录仍保留）；
- 需求变更单的 `revision` 与 `increment` 都通过派生需求实现，原批准需求保持不可变；`story_delta` 暂未开放 UI；
- Bug 分诊 AI 最长等待约 90 秒，超时回退规则建议；AI 不自动写入状态；
- 外部 Bug/变更导入需要提供原故事/原需求，暂不做外部系统双向同步；
- Bug 只能人工 verify/close，不自动关闭；修复故事创建为 draft，需人工批准后执行；
- 语义检索的向量模式需在设置页配置 OpenAI 兼容 Embedding 地址/模型/API Key（环境变量作为默认值）；未配置时自动回退到中文 bigram/BM25 词法检索；API Key 仅存本机 SQLite；
- AI 分类树/标签为预览确认模式，新分类不会静默创建；草稿标签可自动创建，分类仅在命中现有路径时自动应用；
- AI 依赖建议为人工勾选确认，不自动成为硬门禁；建议可能包含合理但业务上不希望的边，需要人工判断；
- 需求“完成”由故事/子需求交付推导，没有独立的手工 done 状态；
- 拆分草案为同步 AI 请求，不支持取消；同一需求只保留一份待确认草案，重新生成会覆盖；
- 图视图为自研 SVG 分层布局，支持点击/折叠/关键路径/导出 Mermaid，但无拖拽、缩放与自动布局编辑；
- 用例图/活动图是范围与流程的轻量表达，不是完整 UML 语义；
- 标签有创建/分配/筛选，删除仅提供 API，暂无独立标签管理页；
- 需求发现 P0/P1 与 P2 的反馈/变更影响已具备；外部需求源、真实模型在线评测、多租户 RBAC 尚未实现；
- 发布/回滚、契约检查、策略门禁、知识库、质量成本度量已具备；生产环境编排与可观测性仍需按项目补齐；
- 文档中心支持 10 类文档、版本/回滚/锁定、过期检测与 docs 同步；AI 文档默认草稿，需人工发布；
- 代码图谱为文件/模块 import 依赖与符号统计，不包含完整调用图或跨语言类型推导；
- 数据库文档基于迁移/schema/ORM 文件与只读 agent 推断，不直接连接数据库做 schema 内省；无法确认的字段标“待确认”；
- 编码规范区分“现状已强制”和“建议新增”，规则需人工确认发布，不自动成为门禁；
- docs 同步只写工作区 `docs/riccon/` 并保留冲突检测，不自动 git commit/PR；外部人工文档按冲突处理，暂不做双向导入同步；
- 文档一致性检查为启发式（需求↔故事、API↔路由、DB↔迁移、代码图谱↔入口），可能漏报或误报，需人工判断；
- 文档上下文按章节词法/可选 embedding 检索并受预算裁剪，不保证覆盖所有相关章节；
- 测试以手工/脚本 E2E 为主，尚无仓库内自动化测试套件；文档轨道提供 `check:documents` 自检脚本；
- Windows 下的启动/停止脚本与进程管理是当前主要开发路径。

当前非目标（挂起）：

- 多人协作 RBAC、每人一团队；
- 合并队列与多租户；
- 跨项目需求池与组合管理；
- 自动合并到主分支。

## 13. 演进路线

| 阶段 | 目标 | 状态 | 文档 |
| --- | --- | --- | --- |
| P0 | 需求发现最小闭环：原始需求 → AI 草稿 → 人工批注 → 修订 → 批准 → 物化故事 | 已实现并验证 | [discovery-track.md](./discovery-track.md) |
| P1 | 版本 diff、定向修订、去重、DoR 阻断、需求级度量 | 已实现并验证 | 同上 |
| P2 | 变更请求与影响分析、需求层级/拆分草案、分类/标签、依赖 DAG/门禁/Handoff、图视图 | 已实现并验证；外部需求源/在线评测规划中 | [discovery-track.md](./discovery-track.md) |
| Task P0/P1 | 任务规划/DAG/串行执行、Context Pack、重试/恢复、计划编辑/审批、任务级验证/度量 | 已实现并验证 | [task-execution.md](./task-execution.md) |
| Task P2 | 独立 worktree 并行执行与合并、关键路径、token 归因、剩余任务重规划 | 已实现并验证；跨 Story Task 依赖不开放 | [task-execution.md](./task-execution.md) |
| Feedback P0/P1 | 需求变更单/影响分析/派生需求；Bug 上报/分诊/修复故事/回归验证/度量 | 已实现并验证 | [feedback-track.md](./feedback-track.md) |
| Feedback P2 | 外部来源导入、迭代标签、Bug SLA/逾期、变更/Bug 分析 | 已实现并验证；双向同步与 SLA 升级引擎未实现 | [feedback-track.md](./feedback-track.md) |
| Document P0/P1 | 文档注册表/10 类文档、需求文档编译、旧档案迁移、概览/代码图谱/架构/需求基线、AI 生成 job、docs 同步、文档上下文、过期检测、版本/回滚/锁定 | 已实现并验证 | [document-track.md](./document-track.md) |
| Document P2 | 一致性检查、需求变更文档影响、文档度量与缺失类型生成 | 已实现并验证；完整调用图/数据库直连/自动 PR 未实现 | [document-track.md](./document-track.md) |

演进约束：不改变现有交付状态机与 ACP 适配层；新能力只新增聚合与编排，不绕过人工决策门。
