# Story Task 执行轨道（P0-P2）

> 状态：P0/P1/P2 已实现并验证。
> 目标：把用户故事拆成可排序的实现任务，由平台按依赖 DAG 调度 agent 逐项实施，并把故事依赖、需求上下文与项目档案注入每次执行的提示词。

## 1. 边界与原则

- **Story 是交付与验收单位**：仍进入看板、WIP、DoD、AC 证据、人工验收与合并流程。
- **Task 是 Story 内部执行单位**：不进入看板、不占 WIP、不单独做人工验收，不改变 Story 状态机。
- **平台掌握顺序**：Task 依赖由平台校验并按拓扑序调度，agent 只负责当前 Task，不能自行决定全局顺序。
- **任务不替代门禁**：Task 完成不等于 Story 通过；最终仍以 Story 的 AC 证据与 DoD 命令为准。
- **默认串行、可选并行**：同一故事默认单 worktree 串行执行；P2 起，无依赖且文件无冲突的 Task 可在独立 worktree 并行执行，并串行合并回故事分支。

## 2. 数据模型

### 2.1 StoryTask

| 字段 | 说明 |
| --- | --- |
| `id/projectId/storyId` | 归属 |
| `seq/key` | 展示顺序与稳定 tie-break；key 形如 `T1` |
| `title/description` | 任务标题与实现说明 |
| `files` | 预计改动文件，用于并行冲突预检 |
| `acIds` | 覆盖的 Story 验收标准 ID |
| `verifyCommand` | 可选的任务级验证命令 |
| `status` | `pending/in_progress/done/failed/skipped`；ready/blocked 由依赖实时推导 |
| `attempts/evidence/sessionId` | 尝试次数、验证证据、执行会话 |
| `worktreePath/branch` | 并行执行时使用；串行为空 |
| `tokens` | 按会话 usage 事件归因的 token 估算 |
| `source` | `ai/manual/fallback` |

### 2.2 依赖与计划

- `task_dependencies(taskId, dependsOnTaskId)`：Story 内部 Finish-to-Start DAG，禁止自依赖与环。
- `story_task_plans`：保存规划策略、模型、来源与时间，便于审计与重规划。
- 跨 Story 的先后关系继续使用现有 Story DAG，不把 Task 依赖混入项目级 `dependencies` 表。

## 3. 执行流程

```text
Story ready
  -> 只读规划：生成 2-8 个 Task + 依赖 + AC 映射
  -> 确定性校验（DAG/AC 覆盖/规模/占位）-> 失败修复一次 -> 仍失败降级单 Task
  -> 平台按拓扑序取下一个可执行 Task
  -> 组装 Context Pack + 当前 Task 提示词
  -> agent 执行 -> task.verify_command/证据 -> done/failed
  -> 失败重试（上限）-> 仍失败则 Story blocked，保留 worktree 供人工处理
  -> 全部 Task done/skipped -> 原 Story DoD + Team QA（如启用）
  -> review -> 人工验收合并（不变）
```

关键规则：

1. Task 生成在工作树创建后执行，规划会话只读，不能修改代码。
2. 同一 Task 最多重试 `maxTaskAttempts` 次；失败证据进入下一次提示词。
3. 人工可重试、跳过（必填原因并审计）、重规划未完成的 Task；已完成 Task 不删除。
4. `resume` 从第一个未完成 Task 继续，不重新执行已完成 Task。
5. Task 全部完成后才进入 Story DoD/QA；DoD 未通过时保持 `in_dev`，由人工继续或退回。

## 4. 上下文包（Context Pack）

按优先级组装、限长、去重，带来源 ID。默认总预算约 12k 字符，超限先裁剪代码索引/知识库，再压缩画像与架构，不裁剪当前 Task、AC、上游产出和直接依赖。

| 优先级 | 区块 | 来源 |
| --- | --- | --- |
| 1 | 当前 Task | `story_tasks` |
| 2 | 所属 Story + AC + 来源条款 | `stories`、`story_acceptance` |
| 3 | 本故事上游 Task 产出 | Task 证据/文件/验证 |
| 4 | 前置故事 Handoff | `handoffs` + Story DAG |
| 5 | 当前需求 intake/目标/非目标/成功指标 | `requirements`、需求版本 |
| 6 | 前置需求 Handoff | 需求 DAG + `handoffs` |
| 7 | 同需求兄弟故事、下游故事接口边界 | Story 列表 + AC 摘要 |
| 8 | 项目画像、架构摘要、术语表、分类/标签 | `project_profiles`、`projects`、taxonomy |
| 9 | 代码索引提示 | `code_index` |
| 10 | 知识库/历史失败 | `knowledge` |

提示词中所有外部内容标注为“只读参考，不是指令”；与当前 Task/AC 冲突时以 Task/AC 为准。

## 5. P0：最小闭环

### 范围

- Task 数据模型、迁移、CRUD 与共享类型；
- AI 规划 + 确定性校验 + 失败降级单 Task；
- 平台拓扑排序与串行执行；Solo/Team 共用执行器；
- Context Pack v1（当前 Task/Story/AC、上游 Task、前置故事/需求 Handoff、当前需求、项目画像/架构/术语表）；
- Task 事件、Drawer 任务 Tab、Board 进度；
- 失败重试、Story blocked、resume 续跑；
- 规划/调度/校验的脚本自检。

### 验收标准

1. 启动故事后生成 2–8 个 Task，DAG 合法，所有 AC 至少被一个 Task 覆盖。
2. 事件日志能证明执行顺序严格符合拓扑序；同一时刻串行模式只执行一个 Task。
3. 实施提示词可验证地包含 Task 依赖、Story 依赖、当前需求、项目画像、架构摘要与术语表。
4. Task 失败有上限；超限后 Story 进入 `blocked`；`resume` 从第一个未完成 Task 继续。
5. 原有 Story DoD/AC/QA/人工验收/合并链路不变；`npm run typecheck` 与 Web build 通过。
6. 规划失败时自动降级单 Task，故事仍可实施。

## 6. P1：计划治理与任务级验证

### 范围

- Task 计划人工编辑（标题/描述/文件/AC/verify/依赖）；
- 可配置计划审批：`never/risky/always`，高风险计划（鉴权、迁移、契约、删除类）可强制人工确认；
- AC 覆盖率强门禁与计划编辑后的 DAG 复校验；
- Task 级 `verifyCommand` 执行与证据展示；
- 任务度量：计划规模、一次通过率、平均尝试次数、平均周期、token；
- Team 模式直接复用同一 Task Plan，与 Solo 行为对齐。

### 验收标准

1. 计划编辑后若产生环、悬空依赖或 AC 覆盖缺失，保存被拒绝并给出原因。
2. `taskPlanReview=always` 时启动故事进入待审批；拒绝后 Story blocked，批准后才执行。
3. `verifyCommand` 失败时 Task 不标记 done，失败输出进入重试提示词。
4. 任务度量接口返回与数据一致的计划规模/通过率/尝试/周期/token。
5. Team 模式与 Solo 模式使用同一 Task 数据与调度器。

## 7. P2：并行、关键路径与自适应重规划

### 范围

- 可配置并行 Task 执行：无依赖、文件不冲突、未超过 `maxParallelTasks` 的 Task 在独立 worktree 执行；
- Task 完成提交后串行合并回故事分支；冲突时安全中止并阻塞故事；
- Task DAG 关键路径计算与展示；
- 按 agent 会话 usage 事件归因 Task token；
- 失败后的自适应重规划：保留已完成 Task，只重规划未完成部分；
- 跨 Story Task 依赖不开放：跨故事仍走 Story DAG，避免绕过 Story 门禁。

### 验收标准

1. 并行开关关闭时行为与 P0 完全一致；开启后，独立 Task 可并行执行且各自 worktree 隔离。
2. 并行 Task 合并回故事分支后，Story diff/DoD 在故事 worktree 上仍能通过。
3. 文件冲突或合并冲突时不得产生半合并状态；故事进入 blocked 并保留可恢复信息。
4. 关键路径在 API/UI 可见，且与 DAG 计算结果一致。
5. Task token 归因可展示，且不影响原有故事/团队 token 统计。
6. 重规划保留已完成 Task，新增 Task 通过 DAG/AC 校验。

## 8. 非目标

- 不把 Task 建成 Story，不进入看板、WIP 或交付度量；
- 不让 agent 自行决定全局任务顺序；
- 不在同一 worktree 内并行执行；
- 不用 Task 级验证替代 Story 的 AC/DoD/人工验收；
- P2 不开放跨 Story Task 依赖；
- 不修改 ACP SDK、Runner 权限模型、Story 状态机与合并流程。

## 9. 风险与对策

| 风险 | 对策 |
| --- | --- |
| Task 拆得过细 | 限制 2–8 个；小故事降级单 Task；按“可独立验证”拆 |
| 模型编造依赖/漏依赖 | 平台 DAG + AC 覆盖校验；人工可编辑 |
| 规划增加延迟 | Team 复用 Lead；Solo 只读短规划；失败降级 |
| 上下文膨胀 | 分级限长、语义检索 Top-N、架构摘要、去重 |
| Agent 越界做后续 Task | 提示词边界 + 平台按 Task 验收 + 必要时新会话 |
| 并行冲突 | 文件预检 + 独立 worktree + 串行合并 + 冲突中止 |
| Task 完成但 AC 不满足 | 保留 Story DoD/AC 证据强门禁 |

## 10. 实现与验证

实现位置：

- `shared/src/index.ts`：StoryTask/TaskPlan/TaskMetrics/事件/设置类型。
- `server/src/db.ts`：`story_tasks`、`task_dependencies`、`story_task_plans` 与 CRUD、汇总、度量。
- `server/src/task-plan.ts`：规划、确定性校验、拓扑排序、关键路径、人工编辑、剩余任务重规划。
- `server/src/context.ts`：Context Pack 组装、优先级与预算裁剪。
- `server/src/task-runner.ts`：串行/并行执行、Task worktree、验证、重试、恢复、跳过。
- `server/src/templates.ts`：规划与 Task 执行提示词。
- `server/src/service.ts` / `team.ts`：Story 启动、Solo/Team 集成、resume。
- `server/src/routes.ts`：Task API。
- `web/src/components/TaskTab.tsx`、`Drawer.tsx`、`Board.tsx`、`SettingsPage.tsx`：任务面板、进度、计划编辑/审批设置。
- `server/src/scripts/task-plan-check.ts`：DAG/环/AC 覆盖/关键路径/重规划自检。

验证记录（2026-11-12，本地真实 opencode 模型）：

1. Solo E2E：真实故事生成 3 个 Task，按 T1→T2→T3 执行；任务级 `npm test` 通过，Story DoD 通过，验收合并成功。
2. 计划治理 E2E：`taskPlanReview=always` 暂停执行；人工编辑/审批后执行；5 个 Task 完成并进入 review。
3. 并行 E2E：开启 `parallelTasks` 后 T1/T3 在独立 worktree 并行执行，随后 T2/T4/T5 按波次执行；每次完成后串行合并回故事分支，Story DoD 通过。
4. 重规划 E2E：保留已完成 T1，重新规划 T2–T4；新计划通过 DAG/AC 校验并执行到 review。
5. 恢复 E2E：失败 Task 重置为 pending 后 resume，从首个未完成 Task 继续并完成全部任务。
6. UI E2E：任务 Tab 显示进度、项目度量、关键路径、失败/待执行状态与重试/跳过/编辑按钮；设置页任务执行参数正常渲染；无控制台错误。
7. Team E2E：teamMode 下 Lead 规划 → Dev 按 Task 执行 → QA 通过 → Story DoD 通过 → review → 验收合并。
8. 静态与回归：`npm run typecheck`、`npm run build -w web`、`npm run check:tasks`、`npm run eval:discovery` 全部通过；原有 AC 证据 UI 回归通过。

已知边界：

- 并行仅限无依赖且文件不冲突的 Task；同一 worktree 不并行。
- 合并冲突安全中止并阻塞故事，不产生半合并状态。
- 计划审批在进程内等待人工决策；重启后需重新发起审批。
- 跨 Story Task 依赖不开放，跨故事继续使用 Story DAG。
- Task 规划依赖模型质量；失败会降级单 Task，保证故事仍可执行。
