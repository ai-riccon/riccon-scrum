# 反馈轨道：需求迭代与 Bug 反馈（P0-P2）

> 状态：P0/P1/P2 已实现并验证。
> 目标：在既有需求、故事、AC、DoD、Task 与 Handoff 之上，增加两条独立反馈链路：
> 1. 已批准/已交付需求的迭代反馈 → ChangeRequest → 影响分析 → 人工决策 → 派生需求/工作项；
> 2. 基于已有用户故事的缺陷反馈 → BugReport → 分诊 → 修复故事/返工 → 回归验证 → 关闭。

## 1. 边界与领域判断

- **Bug 不是新需求**：Bug 表示现有故事/AC 的预期行为未被满足；修复必须回到既有 AC 并补回归测试。
- **ChangeRequest 不是需求子节点**：变更单是“对基线的修改提案”，不改变需求树；`parent_requirement_id` 继续只表示 Epic/Feature/Requirement 包含层级。
- **基线不可变**：已批准需求版本、`done` 故事、已合并代码不作为反馈直接修改对象；反馈产生变更单/缺陷单，人工确认后再派生新版本、增量需求、修复故事或返工。
- **人工分诊是门禁**：AI 只提供影响分析、严重度建议、重复候选；接受、拒绝、重复、关闭都必须人工确认。
- **复用现有交付链路**：变更派生需求仍走需求草稿/DoR/批准/物化；Bug 修复故事仍走 Story/Task/DoD/AC/人工验收。

## 2. 数据模型

### 2.1 RequirementChangeRequest

| 字段 | 说明 |
| --- | --- |
| `id/projectId/requirementId` | 变更单与原始需求 |
| `baselineVersion` | 反馈针对的已批准/当前基线版本 |
| `changeType` | `corrective / adaptive / perfective` |
| `source` | `production / review / bug / manual / external` |
| `title/reason` | 变更标题与反馈原文 |
| `status` | `draft / analyzing / in_review / approved / rejected / materialized / archived` |
| `impact` | 受影响故事、当前状态、建议动作与理由 |
| `decision` | `revision / increment / story_delta / null` |
| `derivedRequirementId` | 派生需求；不是需求子节点 |
| `iteration/externalId/externalUrl` | P2 迭代标签与外部来源 |
| `decidedBy/createdAt/updatedAt` | 审计 |

### 2.2 BugReport

| 字段 | 说明 |
| --- | --- |
| `id/projectId/storyId/requirementId` | 缺陷归属；必须绑定原故事 |
| `acIds` | 违反的 AC |
| `title/description/steps/expected/actual/environment` | 复现与预期/实际 |
| `evidence` | 日志、截图、命令输出等 |
| `severity/priority/reproducibility` | 严重度与优先级分离；可复现性 |
| `status` | `new / triaged / accepted / rejected / duplicate / fixing / fixed / verified / closed / reopened` |
| `duplicateOf` | 重复 Bug |
| `fixStoryId/regressionTest` | 修复故事与回归测试 |
| `rootCause/resolution/reopenCount` | 根因、结论、重开次数 |
| `reporter/slaDueAt/externalId/externalUrl` | 报告人、SLA、外部来源 |

### 2.3 关联字段

- `requirements.change_request_id`、`requirements.derived_from_requirement_id`；
- `stories.bug_id`、`stories.source_story_id`、`stories.change_request_id`；
- 事件沿用 `events.story_id` 列承载 change/bug id（无外键），与需求事件的做法一致。

## 3. P0：最小闭环

### 范围

- ChangeRequest 实体、创建、确定性影响分析、人工批准/拒绝、`increment` 派生需求与物化；
- BugReport 实体、故事上报、人工分诊、接受；`review/in_dev` 关联返工，`done` 创建关联修复故事与回归 AC；
- 修复故事验收后自动将 Bug 标记 `fixed`，人工验证/关闭；
- 需求页迭代反馈/影响/决策 UI；故事 Drawer 反馈 Bug；Bug Inbox；
- 事件、Toast、刷新回放。

### 验收标准

1. 已批准/已交付需求可发起变更；原需求版本、原故事不被直接修改。
2. 变更单可生成影响分析；批准 `increment` 后创建 `derived_from_requirement` 的新需求，原需求仍可追踪。
3. `done` 故事上报 Bug 后可创建修复故事；修复故事带原故事、Bug、AC 和回归测试映射；原故事保持 `done`。
4. `review/in_dev` 故事上报 Bug 后可关联当前故事返工，不创建重复修复故事。
5. 修复故事验收后 Bug 进入 `fixed`；人工 `verify` 后才能 `closed`。
6. 非法状态迁移、缺少复现步骤/期望/实际、重复 Bug 被拒绝或显式确认。
7. 事件可回放，刷新不误报 Toast。

## 4. P1：决策增强、分诊与度量

### 范围

- ChangeRequest 支持 `revision/increment`，逐故事动作（keep/adjust/rework/add_regression/add_increment），基线快照与影响摘要；
- Bug 规则/AI 辅助分诊建议、重复候选、验证/关闭/重开；
- 变更度量（数量、批准率、影响故事数、周期）与 Bug 度量（MTTR、重开率、逾期数）；
- 修复故事回归测试门禁与原始 AC 证据展示。

### 验收标准

1. 变更决策可选择修订或增量；逐故事动作可保存并在详情展示。
2. 变更度量与数据一致；已批准基线可回溯。
3. Bug 分诊建议包含严重度/优先级/可复现性/重复候选；人工确认后才生效。
4. 重复 Bug 需人工确认 `duplicate_of`；合并后不重复创建修复故事。
5. Bug 从 fixed 到 verified 到 closed 的状态机可审计；重开记录次数。
6. Bug MTTR、重开率、逾期数与数据一致。

## 5. P2：外部来源、迭代与 SLA

### 范围

- ChangeRequest/Bug 外部来源字段与导入 API（manual/external）；
- 变更单迭代标签（iteration），按项目/迭代聚合；
- Bug SLA 截止时间与逾期计算；按项目/严重度统计；
- 外部导入内容作为不可信数据，禁止改变系统约束。

### 验收标准

1. 外部来源变更单/Bug 可导入并保留 `externalId/externalUrl` 与来源。
2. 按迭代筛选变更单；按项目/迭代查看反馈指标。
3. Bug 超过 SLA 且在未关闭状态时计入逾期；关闭后不再计入。
4. 外部文本中的指令不能改变分诊门禁或系统约束。

## 6. 非目标

- 不实现完整 ITSM/工单平台、SLA 升级引擎或自动派单；
- 不自动修改已批准需求、`done` 故事或已合并代码；
- 不让 Bug 修复绕过 Story 的 DoD/AC/人工验收；
- P2 暂不做外部系统双向同步与自动发布关联；
- 不把 Bug 或 ChangeRequest 建成看板 Story。

## 7. 实施位置

- `shared/src/index.ts`：ChangeRequest/BugReport/度量/事件类型；
- `server/src/db.ts`：新表、列、CRUD、指标；
- `server/src/changes.ts`：变更单创建、影响分析、决策、物化、度量；
- `server/src/bugs.ts`：上报、分诊、重复候选、修复故事、验证/关闭/重开、度量；
- `server/src/templates.ts`：Bug 分诊/修复故事提示词；
- `server/src/routes.ts`：变更单、Bug、导入与指标 API；
- `web/src/components/RequirementsPage.tsx`、`Drawer.tsx`、`BugInbox.tsx`、`BugReportModal.tsx`、`SettingsPage.tsx`；
- `server/src/service.ts`：修复故事验收后标记 Bug fixed。

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 把所有反馈当 Bug/新需求 | 先判断是否违反既有 AC；再走 Bug 或 ChangeRequest |
| 变更单污染需求树 | 独立 CR 聚合 + `derived_from` 关系 |
| 直接修改已完成故事 | 保持 `done` 不可变，创建关联修复故事 |
| AI 分诊误判 | 只生成建议；人工 triage 才写入 |
| 修复缺少回归测试 | 修复故事强制回归 AC/测试映射/DoD |
| 重复 Bug 泛滥 | 语义/字符相似候选 + 人工 `duplicate_of` |
| 外部反馈注入 | 标记为只读用户数据，不能改变系统约束 |

## 9. 实现与验证

### 实现位置

- `shared/src/index.ts`：ChangeRequest/BugReport/指标/事件/Story/Requirement 关联字段。
- `server/src/db.ts`：`requirement_change_requests`、`bug_reports`、关联列、CRUD、变更/Bug 指标。
- `server/src/changes.ts`：创建、影响分析、决策、物化、逐故事动作、变更度量。
- `server/src/bugs.ts`：上报、规则/AI 分诊建议、重复候选、接受、修复故事、验证/关闭/重开、Bug 度量。
- `server/src/acp/utility.ts`：只读 AI 分诊调用，失败回退规则建议。
- `server/src/templates.ts`：Bug 分诊提示词。
- `server/src/routes.ts`：ChangeRequest、Bug、导入、度量 API；旧 change-request 入口保留兼容。
- `server/src/service.ts`：修复故事验收后标记 Bug fixed；返工/修复故事共用 Story 链路。
- `web/src/components/ChangeRequestPanel.tsx`、`BugInbox.tsx`、`BugReportModal.tsx`、`Drawer.tsx`、`TopBar.tsx`、`RequirementsPage.tsx`、`SettingsPage.tsx`。

### 验证记录（2026-11-12，本地真实 opencode 模型）

1. ChangeRequest E2E：已物化需求发起变更 → 影响 6 个故事 → 批准 increment → 派生新需求 `derived_from_requirement` 正确，原需求保持原状态。
2. P1 变更 E2E：`revision` 决策、逐故事 action（add_regression）、变更度量（total/approved/materialized/impactStories）通过。
3. Bug 闭环 E2E：done 故事上报 Bug → 分诊 → 接受创建修复故事（带原故事、Bug、回归 AC）→ 修复故事 4 个 Task 执行 → DoD 通过 → 验收后 Bug=fixing→fixed → verify→closed。
4. 重复与外部来源：相似 Bug 建议命中重复候选；`duplicate_of` 生效；外部 Bug/变更导入保留 `externalId/externalUrl`。
5. AI 分诊：真实模型返回 severity/priority/duplicates 建议；失败会回退规则建议，不阻塞人工分诊。
6. UI E2E：需求迭代面板创建/分析/批准/物化；故事 Drawer 反馈 Bug；Bug Inbox 分诊、建议、保存；无控制台错误。
7. 静态验证：`npm run typecheck`、`npm run build -w web` 通过。

### 已知边界

- AI 分诊最长等待约 90 秒，超时自动回退规则建议；不自动写入状态。
- 外部导入仍需提供原故事/原需求，暂不做外部系统双向同步。
- Bug 修复故事创建为 `draft`，需人工批准后执行；不自动合并、不自动关闭 Bug。
- `story_delta` 决策保留在类型中，当前 UI 提供 revision/increment 两种主路径。
- 完整 ITSM、SLA 升级引擎、自动派单不在当前范围。
