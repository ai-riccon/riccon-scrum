import type { GlobalPaneProps } from './types';
import { Help, SaveBar } from './SettingsUi';

export function RuntimePane({ g, onChange, agentKinds, saving, onSave }: GlobalPaneProps) {
  return (
    <section className="settings-section">
      <div className="section-label">执行与预算</div>
      <div className="settings-grid">
        <div className="field">
          <label>WIP 上限（并行故事数）</label>
          <input type="number" min={1} value={g.wipLimit} onChange={(e) => onChange({ wipLimit: Number(e.target.value) })} />
          <Help>同时处于 In Dev 的故事数量上限。超过后无法启动新故事，用于限制并行度、避免 Review 积压。</Help>
        </div>
        <div className="field">
          <label>最大循环轮次</label>
          <input type="number" min={1} value={g.maxTurns} onChange={(e) => onChange({ maxTurns: Number(e.target.value) })} />
          <Help>团队模式（Lead→Dev→QA→Gate）单故事的循环轮次上限。达到上限后故事转为 blocked，需人工介入。</Help>
        </div>
        <div className="field">
          <label>墙钟预算（分钟）</label>
          <input
            type="number"
            min={1}
            value={Math.round(g.maxWallMs / 60000)}
            onChange={(e) => onChange({ maxWallMs: Number(e.target.value) * 60000 })}
          />
          <Help>团队循环的最长耗时。超过后停止编排并转 blocked，防止任务无限拖延。</Help>
        </div>
        <div className="field">
          <label>Token 预算</label>
          <input type="number" min={1000} value={g.maxTokens} onChange={(e) => onChange({ maxTokens: Number(e.target.value) })} />
          <Help>单故事累计 token 上限，依赖终端上报 usage。部分自定义模型不报数（usage=0），此时该预算不会触发；轮次与墙钟预算仍然生效。</Help>
        </div>
        <div className="field">
          <label>空闲会话回收（分钟，0=不回收）</label>
          <input
            type="number"
            min={0}
            value={Math.round(g.idleReapMs / 60000)}
            onChange={(e) => onChange({ idleReapMs: Number(e.target.value) * 60000 })}
          />
          <Help>空闲的 agent 会话超过该时长自动结束进程并释放内存。会话记录与 ACP 会话仍保留，继续指令可正常恢复。</Help>
        </div>
      </div>
      <div className="section-label" style={{ marginTop: 6 }}>新建项目默认值</div>
      <div className="settings-grid">
        <div className="field">
          <label>新项目默认就绪门禁</label>
          <button
            className={`switch ${g.requireMachineDod ? 'on' : ''}`}
            onClick={() => onChange({ requireMachineDod: !g.requireMachineDod })}
            aria-label="默认就绪门禁"
          />
          <Help>新建项目是否默认要求「BDD 验收标准 + 至少一条机器 DoD」才能批准就绪；已有项目在项目设置中单独配置。</Help>
        </div>
      </div>
      <div className="field">
        <label>新项目默认 Agent 终端</label>
        <div className="seg">
          {agentKinds.map((k) => (
            <button key={k} className={g.defaultAgentKind === k ? 'on' : ''} onClick={() => onChange({ defaultAgentKind: k })}>
              {k}
            </button>
          ))}
        </div>
        <Help>新建项目默认使用的 ACP 编码终端。opencode 为默认测试终端；Claude Code 需 Anthropic 鉴权；Qoder CLI 需 qoderclicn login。</Help>
      </div>
      <SaveBar label="保存全局设置" busy={saving} onClick={onSave} />
    </section>
  );
}

export function EmbeddingPane({ g, onChange, saving, onSave }: GlobalPaneProps) {
  return (
    <section className="settings-section">
      <div className="settings-grid">
        <div className="field">
          <label>Embedding 接口地址</label>
          <input
            value={g.embeddingUrl}
            onChange={(e) => onChange({ embeddingUrl: e.target.value })}
            placeholder="https://api.openai.com/v1/embeddings 或本地兼容服务"
          />
          <Help>
            OpenAI 兼容的 /embeddings 接口。留空则关闭向量检索，需求/故事搜索自动回退到中文 bigram + BM25 词法检索。
            文本会发送到该接口，请确认隐私边界；保存后立即生效。
          </Help>
        </div>
        <div className="field">
          <label>Embedding 模型</label>
          <input
            value={g.embeddingModel}
            onChange={(e) => onChange({ embeddingModel: e.target.value })}
            placeholder="text-embedding-3-small"
          />
          <Help>与接口匹配的模型名；本地服务可使用 bge-m3、nomic-embed-text 等。</Help>
        </div>
        <div className="field">
          <label>Embedding API Key</label>
          <input
            type="password"
            value={g.embeddingApiKey}
            onChange={(e) => onChange({ embeddingApiKey: e.target.value })}
            placeholder="可选；本地服务通常不需要"
          />
          <Help>仅保存在本机 SQLite 的全局设置中，不会写入项目或提示词。</Help>
        </div>
      </div>
      <SaveBar label="保存全局设置" busy={saving} onClick={onSave} />
    </section>
  );
}

export function TasksPane({ g, onChange, saving, onSave }: GlobalPaneProps) {
  return (
    <section className="settings-section">
      <div className="section-label">任务规划与执行</div>
      <div className="settings-grid">
        <div className="field">
          <label>启用 AI 任务规划</label>
          <button
            className={`switch ${g.taskPlanning ? 'on' : ''}`}
            onClick={() => onChange({ taskPlanning: !g.taskPlanning })}
            aria-label="切换任务规划"
          />
          <Help>启动故事时先生成 2–8 个可排序的实现任务；关闭后降级为单任务执行，仍保留上下文注入与 DoD 门禁。</Help>
        </div>
        <div className="field">
          <label>单故事最大任务数</label>
          <input
            type="number"
            min={1}
            max={12}
            value={g.maxStoryTasks}
            onChange={(e) => onChange({ maxStoryTasks: Number(e.target.value) })}
          />
          <Help>超过上限的计划会被拒绝并触发一次修复；任务过细会增加协调成本，建议 4–8。</Help>
        </div>
        <div className="field">
          <label>单任务最大尝试次数</label>
          <input
            type="number"
            min={1}
            max={5}
            value={g.maxTaskAttempts}
            onChange={(e) => onChange({ maxTaskAttempts: Number(e.target.value) })}
          />
          <Help>任务验证失败后自动重试的次数；超过后故事转 blocked，保留 worktree 等待人工重试/跳过/重规划。</Help>
        </div>
        <div className="field">
          <label>任务计划审批</label>
          <select
            value={g.taskPlanReview}
            onChange={(e) => onChange({ taskPlanReview: e.target.value as typeof g.taskPlanReview })}
          >
            <option value="never">不审批（自动执行）</option>
            <option value="risky">高风险才审批（鉴权/迁移/契约/删除）</option>
            <option value="always">总是审批</option>
          </select>
          <Help>高风险或强制审批时，启动会创建待审批项；拒绝后故事 blocked，批准后才执行任务。</Help>
        </div>
        <div className="field">
          <label>并行执行独立任务</label>
          <button
            className={`switch ${g.parallelTasks ? 'on' : ''}`}
            onClick={() => onChange({ parallelTasks: !g.parallelTasks })}
            aria-label="切换并行任务"
          />
          <Help>开启后，无依赖且文件不冲突的 Task 在独立 worktree 并行执行，完成后串行合并回故事分支；关闭时严格串行。</Help>
        </div>
        <div className="field">
          <label>最大并行任务数</label>
          <input
            type="number"
            min={1}
            max={4}
            value={g.maxParallelTasks}
            onChange={(e) => onChange({ maxParallelTasks: Number(e.target.value) })}
          />
          <Help>仅在开启并行执行时生效；并行任务越多，合并冲突与资源占用风险越高。</Help>
        </div>
        <div className="field">
          <label>任务上下文预算（字符）</label>
          <input
            type="number"
            min={2000}
            value={g.taskContextChars}
            onChange={(e) => onChange({ taskContextChars: Number(e.target.value) })}
          />
          <Help>每次任务提示词注入上下文的总预算；超限时先裁剪代码索引/知识库，再压缩项目文档，不裁剪当前 Task、AC 与直接依赖。</Help>
        </div>
        <div className="field">
          <label>Bug SLA（天，0=不计算）</label>
          <input
            type="number"
            min={0}
            value={g.bugSlaDays}
            onChange={(e) => onChange({ bugSlaDays: Number(e.target.value) })}
          />
          <Help>Bug 上报时计算截止时间；未关闭且超过截止时间计入逾期。仅作运营提醒，不自动升级或关闭。</Help>
        </div>
      </div>
      <SaveBar label="保存全局设置" busy={saving} onClick={onSave} />
    </section>
  );
}
