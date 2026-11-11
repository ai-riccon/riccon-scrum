import type { DodCommand, Story, TeamPlanTask, TeamVerdict } from '@acp-scrum/shared';

const CONSTRAINTS = `## 通用约束
- 只在当前工作目录（独立 git worktree）内读写文件。
- 不要自行合并分支或推送远端；合并由人工验收触发。
- 敏感操作会弹出权限请求，等待人工批准。
- 回答末尾如需结构化数据，必须放在 \`\`\`json 代码块中。`;

function dodBlock(dod: DodCommand[]): string {
  if (dod.length === 0) return '';
  return ['## 完成定义（DoD）门禁命令', ...dod.map((c) => `- ${c.label}: \`${c.command}\``)].join('\n');
}

export function leadPrompt(story: Story, dod: DodCommand[], codeContext = ''): string {
  return [
    `# 角色：技术负责人（Lead / 架构师）`,
    `你负责把用户故事拆解为可执行的实现计划，不要写代码。`,
    '',
    `## 用户故事：${story.title}`,
    story.description,
    '',
    '## 验收标准',
    story.acceptanceCriteria || '（未提供，请推断最小可验证行为）',
    '',
    dodBlock(dod),
    codeContext ? '\n' + codeContext : '',
    '',
    '## 任务',
    '1. 阅读当前仓库结构，理解技术栈与相关模块。',
    '2. 产出实现计划：拆成 1-5 个任务，每个任务标注预计改动的文件路径（相对仓库根）。',
    '3. 文件路径用于并行冲突预检，请尽量准确。',
    '',
    '## 输出格式（必须）',
    '在回答末尾输出一个 json 代码块：',
    '```json',
    '{"tasks":[{"id":"t1","title":"...","files":["src/a.ts"]}]}',
    '```',
    '',
    CONSTRAINTS,
  ].join('\n');
}

export function devPrompt(story: Story, dod: DodCommand[], plan: TeamPlanTask[], codeContext = ''): string {
  const planBlock = plan.length
    ? ['## 实现计划（来自 Lead）', ...plan.map((t) => `- [${t.id}] ${t.title}（文件：${t.files.join(', ') || '待定'}）`)].join('\n')
    : '## 实现计划\n（Lead 未提供结构化计划，请按故事自行实现）';
  return [
    `# 角色：开发工程师（Dev）`,
    `你负责在当前 worktree 中实现用户故事，写出可运行、可测试的代码。`,
    '',
    `## 用户故事：${story.title}`,
    story.description,
    '',
    '## 验收标准',
    story.acceptanceCriteria || '（未提供）',
    '',
    planBlock,
    '',
    dodBlock(dod),
    codeContext ? '\n' + codeContext : '',
    '',
    '## 任务',
    '1. 按计划实现功能，保持改动最小且聚焦。',
    '2. 自行运行 DoD 门禁命令并确保通过。',
    '3. 完成后用一句话总结改动。',
    '',
    CONSTRAINTS,
  ].join('\n');
}

export function qaPrompt(story: Story, dod: DodCommand[], diff: string): string {
  return [
    `# 角色：质量工程师（QA / 评审）`,
    `你负责独立评审 Dev 的改动是否满足验收标准，不要修改代码。`,
    '',
    `## 用户故事：${story.title}`,
    story.description,
    '',
    '## 验收标准',
    story.acceptanceCriteria || '（未提供）',
    '',
    dodBlock(dod),
    '',
    '## 待评审 Diff',
    '```diff',
    diff.slice(0, 12000) || '（无差异）',
    '```',
    '',
    '## 任务',
    '1. 阅读 diff 与相关代码，核对验收标准逐条是否满足。',
    '2. 运行 DoD 门禁命令验证。',
    '3. 给出结论：pass=true 仅当所有验收标准与门禁均满足。',
    '',
    '## 输出格式（必须）',
    '在回答末尾输出一个 json 代码块：',
    '```json',
    '{"pass":true,"issues":[]}',
    '```',
    '若不通过，issues 列出具体问题（每条一句话）。',
    '',
    CONSTRAINTS,
  ].join('\n');
}

export function architectPrompt(profileSummary: string): string {
  return [
    '# 角色：架构师（Architect）',
    '你负责只读分析当前仓库，产出一份结构化的架构文档，帮助团队快速理解项目现状。不要修改任何文件。',
    '',
    '## 已知项目画像（确定性扫描）',
    profileSummary,
    '',
    '## 任务',
    '1. 阅读仓库结构、入口、核心模块与依赖，理解技术栈与分层。',
    '2. 识别关键模块职责、数据流、外部集成、配置与构建/测试方式。',
    '3. 指出维护该系统时的风险点与注意事项（如缺失测试、耦合、技术债）。',
    '',
    '## 输出格式',
    '直接输出 Markdown 架构文档，包含以下小节：',
    '# 架构概览 / ## 技术栈 / ## 模块与职责 / ## 数据流与集成 / ## 构建与测试 / ## 风险与维护建议',
    '内容务实、基于代码事实，不要臆测。',
    '',
    CONSTRAINTS,
  ].join('\n');
}

export function parseJsonBlock<T>(text: string): T | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(blocks[i][1].trim()) as T;
    } catch {
      // try next block
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export function normalizePlan(raw: unknown): TeamPlanTask[] {
  const tasks = (raw as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t, i) => ({
      id: String(t.id ?? `t${i + 1}`),
      title: String(t.title ?? `任务 ${i + 1}`),
      files: Array.isArray(t.files) ? t.files.map(String) : [],
    }));
}

export function normalizeVerdict(raw: unknown): TeamVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { pass?: unknown; issues?: unknown };
  if (typeof r.pass !== 'boolean') return null;
  return { pass: r.pass, issues: Array.isArray(r.issues) ? r.issues.map(String) : [] };
}