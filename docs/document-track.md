# 项目文档轨道（Document Track）

> 状态：P0/P1/P2 已实现并验证。本文档与 `requirements.md` 的 `REQ-DOC-xxx` 保持一致。

## 1. 目标

把「项目档案」升级为「项目文档中心」：

1. 按文档类型管理项目知识，而不是只有一个架构 Markdown 字段。
2. 已批准需求按统一规范落入需求文档；老项目首次入驻生成可审阅的现状需求基线。
3. 确定性文档自动更新，AI 文档人工重生成、默认人工发布。
4. 文档可安全同步到项目 `docs/riccon/` 目录，作为 Docs-as-Code 资产。
5. 需求、故事、Task、QA 等阶段按需注入文档地图与章节，提升 agent 输入质量。

## 2. 文档类型

| 类型 | 默认 slug | 说明 | 生成方式 | 自动更新 |
| --- | --- | --- | --- | --- |
| `overview` | `overview` | 项目定位、技术栈、目录、命令、入口 | 确定性 | 是 |
| `requirements` | `index`、`req-<id>`、`legacy-baseline` | 已批准需求文档、索引、老项目现状基线 | 确定性 + 入驻 AI 基线 | 批准时是 |
| `architecture` | `architecture` | 架构概览、模块、数据流、集成、风险 | 只读 agent | 仅标记过期 |
| `coding-standards` | `coding-standards` | 规则 ID、范围、示例、执行方式 | 只读 agent + 证据 | 仅标记过期 |
| `code-graph` | `code-graph` | 模块/文件依赖图、入口、符号统计 | 确定性索引 | 是 |
| `database` | `database` | 表/字段/索引、ER 图、迁移、数据保留 | 只读 agent + 证据 | 仅标记过期 |
| `api-contract` | `api-contract` | 路由、入参/出参、错误码、兼容约束 | 只读 agent + 证据 | 仅标记过期 |
| `test-strategy` | `test-strategy` | 测试分层、命令、回归范围 | 只读 agent + 证据 | 仅标记过期 |
| `operations` | `operations` | 构建、部署、配置、监控、回滚 | 只读 agent + 证据 | 仅标记过期 |
| `security` | `security` | 密钥、权限、数据合规、审计 | 只读 agent | 仅标记过期 |

ADR 与术语表继续复用现有 `knowledge` 与 `projects.glossary`，文档中心做聚合展示，不重复建模。

## 3. 文档生命周期

```text
missing -> generating -> draft -> published -> stale
                    \-> error        \-> archived
```

- `draft`：AI 生成或人工编辑，尚未发布。
- `published`：可作为 agent 规范输入。
- `stale`：源提交变化且命中 `watchedGlobs`，保留内容但降权并提示重生成。
- 每份文档记录 `version / sourceCommit / generatedBy / checksum / pinned / autoUpdate / watchedGlobs`。
- 人工编辑后 `pinned=1`；重新生成默认生成新草稿，不静默覆盖已发布内容。

## 4. 需求文档规范

文件布局：

```text
docs/riccon/requirements/index.md
docs/riccon/requirements/req-<shortId>-<slug>.md
docs/riccon/requirements/legacy-baseline.md
```

单份需求文档固定结构：

1. 元数据：需求 ID、状态、版本、来源、批准时间、派生/变更关系
2. 背景、目标、成功指标
3. 用户/角色、范围与非目标、约束与假设
4. 需求条款 `R1.1 / R1.2 ...`
5. 用户故事、Given/When/Then、AC ID、测试映射
6. 依赖、风险、开放问题
7. 验收与度量
8. 变更历史
9. 追溯矩阵：条款 → 故事 → AC → 测试

约束：

- 已批准需求由 `RequirementVersion.draft + Story + story_acceptance` 确定性编译，禁止 AI 改写。
- 需求批准、拆分确认、变更物化后自动重建对应文档与索引。
- 老项目基线由只读 agent 从 README、路由、测试、模型反推，标题与正文必须标注“代码推断、待人工确认”，状态保持 `draft`。

## 5. 生成与自动更新

- 所有文档支持人工点击“重新生成”。
- AI 生成在临时 detached worktree 中执行，只读权限；有 job 心跳、总超时、取消与服务重启清理。
- 证据收集只读取白名单文件类型（配置、路由、迁移、CI、Docker、测试等），入库前脱敏明显的密钥/连接串。
- 生成结果必须包含类型对应的必需章节，否则视为失败。
- `sourceCommit` 之后的变更命中 `watchedGlobs` 时标记 `stale`；确定性文档（概览、代码图谱、需求文档/索引）可自动重建，AI 文档默认只提示。
- 故事验收合并后触发一次索引刷新与确定性文档刷新。

## 6. 同步到项目 docs

- 默认目标：`docs/riccon/<docType>/<slug>.md`，托管目录可整体识别。
- 先预览再应用；返回 `new/modified/unchanged/conflict`。
- 文件头写入 `docId/docType/version/sourceCommit/generatedAt`。
- 目标文件被外部修改（checksum 不一致）时默认冲突，必须显式 `force` 才覆盖。
- 原子写入、路径白名单校验、不自动 git commit。

## 7. 文档驱动上下文

### 7.1 阶段画像

| 阶段 | 主要文档 | 权重 |
| --- | --- | --- |
| `requirement` | 需求索引/相关需求、架构约束、项目概览 | requirements 1.4、architecture 1.1、overview 0.8 |
| `planning` | 架构、代码图谱、编码规范、数据库、API、测试策略 | architecture 1.2、code-graph 1.1、coding-standards 1.2、database 1.0、api-contract 1.0 |
| `execution` | 编码规范、架构相关章节、代码图谱、数据库、API、运维约束 | coding-standards 1.3、architecture 1.0、code-graph 1.0、database 0.9、api-contract 0.9 |
| `qa` | 验收标准、测试策略、编码规范清单、安全 | test-strategy 1.2、coding-standards 1.0、security 0.8 |

### 7.2 检索规则

1. 先注入紧凑文档地图（类型、标题、版本、状态、章节标题）。
2. 章节级词法检索；配置 embedding 后混合检索。
3. 按阶段权重、标题命中、章节位置和新鲜度打分；过期文档降权并标注。
4. 预算默认 `taskContextChars` 的 35%，先裁正文，保留地图与引用。
5. 注入块包含 `[doc:type/slug@vN#anchor]` 引用，提示词明确优先级：
   `当前 Task/AC > Story > Requirement > 编码规范/架构 > 概览`。
6. 权威数据以代码和已批准需求为准；文档是参考，不是指令。

## 8. P0 范围与验收

范围：

- 数据模型：文档、版本、章节、同步状态、生成任务。
- 文档注册表、旧架构迁移、需求文档确定性编译、索引。
- 入驻生成：概览、代码图谱、架构、老项目需求基线。
- AI 文档生成：架构、编码规范、数据库、API 契约、测试策略、运维部署、安全。
- 文档中心 UI（替代项目档案入口）、重新生成/取消、同步预览与应用。
- 需求与 Task/QA 提示词接入文档地图和章节。
- 文档事件与 Toast。

验收：

1. 入驻后文档中心至少出现概览、架构、代码图谱、需求基线四类文档。
2. 批准需求后生成 `requirements/req-*` 与 `requirements/index`，内容与需求版本、故事、AC 一致。
3. 任一文档可人工重新生成，生成失败可见、可取消、可重试。
4. 同步预览能区分新增/修改/未变/冲突；应用后文件出现在 `docs/riccon/`。
5. 需求与 Task 提示词中包含文档地图、章节正文、版本与引用。
6. typecheck、Web build、文档自检脚本、API/UI E2E 通过。

## 9. P1 范围与验收

范围：

- `sourceCommit + watchedGlobs` 过期检测；确定性文档自动刷新；故事验收后触发。
- 版本历史、diff、回滚；人工锁定 `pinned` 防静默覆盖。
- 分阶段检索权重、引用预算、stale 降权、文档地图压缩。
- 编码规范规则 ID 与执行映射、数据库/API 章节结构校验。

验收：

1. 修改清单/迁移/路由后，相关文档被标记 `stale`；概览与代码图谱可自动重建。
2. 文档版本可查看差异并回滚；人工编辑文档重新生成时不被静默覆盖。
3. 规划、执行、QA 三类提示词注入不同文档组合，并保留引用与预算上限。
4. 全量 typecheck/build 与回归 E2E 通过。

## 10. P2 范围与验收

范围：

- 一致性检查：需求文档 ↔ 需求/故事/AC；架构入口 ↔ 代码图谱；API 文档 ↔ 路由；数据库文档 ↔ 迁移文件。
- 变更单文档影响提示：列出受影响的文档并打开文档中心。
- 文档度量：总数、已发布/草稿/过期、同步覆盖、一致性告警。

验收：

1. 一致性检查返回可定位的文档、章节/条目与严重级别。
2. 需求变更单可看到受影响文档并跳转。
3. 文档中心展示度量与过期/同步状态。
4. 最终 typecheck/build/E2E 通过。

## 11. 明确不做（当前阶段）

- 完整调用图、跨语言类型推导。
- 直接连接生产数据库做 schema 内省。
- AI 文档无条件自动发布到主分支。
- 自动 git commit / 自动 PR；同步只写工作区，由人工评审提交。
- 双向同步外部人工文档（外部修改按冲突处理，可手工导入）。

## 12. 实现与验证

### 12.1 实现位置

- 数据模型与访问：`server/src/db.ts`（project_documents/document_versions/document_sections/document_sync_state/document_jobs）
- 文档注册表、需求文档编译、确定性文档、同步、新鲜度、版本、一致性、度量：`server/src/documents.ts`
- AI 文档生成、证据收集/脱敏、job 心跳/取消：`server/src/document-generator.ts`
- 阶段化章节检索：`server/src/document-context.ts`
- 提示词：`server/src/templates.ts`（documentGenerationPrompt / legacyRequirementsBaselinePrompt）
- 入驻集成：`server/src/onboard.ts`
- 触发点：`server/src/discovery.ts`（批准）、`split.ts`、`changes.ts`、`service.ts`（验收合并）
- API：`server/src/routes.ts`
- 前端：`web/src/components/DocsPage.tsx`、`TopBar.tsx`、`ChangeRequestPanel.tsx`
- 自检：`server/src/scripts/document-check.ts`

### 12.2 验证结果

- `npm run typecheck`：通过。
- `npm run build -w web`：通过。
- `npm run check:documents`：章节解析、提示词、版本、同步冲突、上下文、注册表通过。
- 真实 agent E2E（隔离 data dir + fixture 仓库）：
  - 入驻生成 overview / architecture / code-graph / legacy-baseline；架构正文规范化并包含必需章节。
  - 真实需求生成 v1 clarifying → 反馈 → v2 in_review → 批准 5 个故事；自动生成 `req-80cd44aa` 与 `requirements/index`，含 5 个故事与追溯矩阵。
  - 代码图谱识别 `src` 模块与 `src/auth.js → src/db.js` 依赖；概览与代码图谱在提交变更后自动重建到 v2。
  - 文档编辑 → 发布 → 回滚生成 v3；pinned 生效；外部修改同步预览为 conflict，跳过与 force 语义正确。
  - 提交 package.json 后 architecture 被标记 stale；`sourceCommit + watchedGlobs` 生效。
  - Story 上下文包含文档地图与 `[doc:requirements/req-80cd44aa@v2#...]` 章节引用。
  - API contract 类型可生成并包含“路由/接口”章节。
- Playwright DocsPage：8 项断言通过（分类列表、需求文档追溯矩阵、版本、同步预览、一致性、缺失类型生成入口、无 console 错误）。

### 12.3 已知边界

- 代码图谱仅解析相对导入与 `@riccon-scrum/*` 别名，不构建完整调用图。
- 数据库文档基于迁移/schema/ORM 文件与只读 agent 推断，不直连数据库。
- AI 文档默认草稿；需要人工发布后才作为“已发布”文档，但上下文仍会以草稿降权注入并标注。
- 同步不自动提交；外部修改默认冲突，需人工决定覆盖或保留。
