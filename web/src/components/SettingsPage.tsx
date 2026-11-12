import { useEffect, useState } from 'react';
import type { DodCommand, GlobalSettings, KnowledgeEntry, KnowledgeKind, Project } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';

const DOD_KINDS: DodCommand['kind'][] = ['test', 'build', 'lint', 'custom'];

function Help({ children }: { children: string }) {
  return <div className="help">{children}</div>;
}

export function SettingsPage({
  project,
  onClose,
  onToast,
  onChanged,
}: {
  project: Project;
  onClose: () => void;
  onToast: (kind: 'success' | 'error', text: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [agentKinds, setAgentKinds] = useState<string[]>(['opencode', 'claude-code', 'qoder-cli']);
  const [globalForm, setGlobalForm] = useState<GlobalSettings | null>(null);
  const [saving, setSaving] = useState<'global' | 'project' | null>(null);

  const [agentKind, setAgentKind] = useState(project.agentKind);
  const [teamMode, setTeamMode] = useState(project.teamMode);
  const [model, setModel] = useState(project.model);
  const [discoveryModel, setDiscoveryModel] = useState(project.discoveryModel);
  const [glossary, setGlossary] = useState(project.glossary);
  const [releaseCommand, setReleaseCommand] = useState(project.releaseCommand);
  const [rollbackCommand, setRollbackCommand] = useState(project.rollbackCommand);
  const [contractCommand, setContractCommand] = useState(project.contractCommand);
  const [policyGateText, setPolicyGateText] = useState(
    project.policyGates.map((g) => `${g.label} | ${g.command} | ${g.blocking ? 'block' : 'warn'}`).join('\n'),
  );
  const [requireMachineDod, setRequireMachineDod] = useState(project.requireMachineDod);
  const [autoApproveReads, setAutoApproveReads] = useState(project.autoApproveReads);
  const [autoApproveCommands, setAutoApproveCommands] = useState(project.autoApproveCommands.join('\n'));
  const [dodCommands, setDodCommands] = useState<DodCommand[]>(project.dodCommands);
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [knowledgeKind, setKnowledgeKind] = useState<KnowledgeKind>('standard');
  const [knowledgeTitle, setKnowledgeTitle] = useState('');
  const [knowledgeContent, setKnowledgeContent] = useState('');
  const [knowledgeTags, setKnowledgeTags] = useState('');

  useEffect(() => {
    api
      .settings()
      .then((d) => {
        setGlobalForm(d.global);
        setAgentKinds(d.agentKinds);
      })
      .catch((err) => onToast('error', err instanceof Error ? err.message : String(err)));
  }, [onToast]);

  const saveGlobal = async () => {
    if (!globalForm) return;
    setSaving('global');
    try {
      await api.updateGlobalSettings(globalForm);
      onToast('success', '全局设置已保存（立即生效）');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  const saveProject = async () => {
    setSaving('project');
    try {
      await api.updateSettings(project.id, {
        agentKind,
        teamMode,
        model,
        discoveryModel,
        glossary,
        releaseCommand,
        rollbackCommand,
        contractCommand,
        policyGates: policyGateText
          .split('\n')
          .map((line) => line.split('|').map((part) => part.trim()))
          .filter(([label, command]) => label && command)
          .map(([label, command, mode]) => ({ label, command, blocking: mode !== 'warn' })),
        requireMachineDod,
        autoApproveReads,
        autoApproveCommands: autoApproveCommands.split('\n'),
        dodCommands: dodCommands.filter((c) => c.command.trim()),
      });
      onToast('success', '项目设置已保存');
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  useEffect(() => {
    api.knowledge(project.id).then(setKnowledgeEntries).catch(() => undefined);
  }, [project.id]);

  const addKnowledgeEntry = async () => {
    if (!knowledgeTitle.trim() || !knowledgeContent.trim()) {
      onToast('error', '请填写知识标题与内容');
      return;
    }
    try {
      await api.addKnowledge(project.id, {
        kind: knowledgeKind,
        title: knowledgeTitle.trim(),
        content: knowledgeContent.trim(),
        tags: knowledgeTags.trim(),
      });
      setKnowledgeTitle('');
      setKnowledgeContent('');
      setKnowledgeTags('');
      setKnowledgeEntries(await api.knowledge(project.id));
      onToast('success', '知识条目已添加');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const removeKnowledgeEntry = async (id: string) => {
    try {
      await api.deleteKnowledge(id);
      setKnowledgeEntries(await api.knowledge(project.id));
      onToast('success', '知识条目已删除');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const patchDod = (i: number, patch: Partial<DodCommand>) =>
    setDodCommands((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const g = globalForm;
  return (
    <div className="settings-page">
      <div className="settings-inner">
        <div className="settings-head">
          <Icon name="layers" size={18} style={{ color: 'var(--indigo-bright)' }} />
          <h2>设置</h2>
          <span className="badge">{project.name}</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            <Icon name="x" size={14} />
            返回
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-section-head">
              <h3>全局默认（服务端运行参数）</h3>
              <Help>对所有项目生效，保存后立即生效；来源于环境变量的值作为未保存时的默认值。</Help>
            </div>
            {!g ? (
              <div className="hint">加载中…</div>
            ) : (
              <>
                <div className="settings-grid">
                  <div className="field">
                    <label>WIP 上限（并行故事数）</label>
                    <input type="number" min={1} value={g.wipLimit} onChange={(e) => setGlobalForm({ ...g, wipLimit: Number(e.target.value) })} />
                    <Help>同时处于 In Dev 的故事数量上限。超过后无法启动新故事，用于限制并行度、避免 Review 积压。</Help>
                  </div>
                  <div className="field">
                    <label>最大循环轮次</label>
                    <input type="number" min={1} value={g.maxTurns} onChange={(e) => setGlobalForm({ ...g, maxTurns: Number(e.target.value) })} />
                    <Help>团队模式（Lead→Dev→QA→Gate）单故事的循环轮次上限。达到上限后故事转为 blocked，需人工介入。</Help>
                  </div>
                  <div className="field">
                    <label>墙钟预算（分钟）</label>
                    <input
                      type="number"
                      min={1}
                      value={Math.round(g.maxWallMs / 60000)}
                      onChange={(e) => setGlobalForm({ ...g, maxWallMs: Number(e.target.value) * 60000 })}
                    />
                    <Help>团队循环的最长耗时。超过后停止编排并转 blocked，防止任务无限拖延。</Help>
                  </div>
                  <div className="field">
                    <label>Token 预算</label>
                    <input type="number" min={1000} value={g.maxTokens} onChange={(e) => setGlobalForm({ ...g, maxTokens: Number(e.target.value) })} />
                    <Help>
                      单故事累计 token 上限，依赖终端上报 usage。部分自定义模型不报数（usage=0），此时该预算不会触发；轮次与墙钟预算仍然生效。
                    </Help>
                  </div>
                  <div className="field">
                    <label>空闲会话回收（分钟，0=不回收）</label>
                    <input
                      type="number"
                      min={0}
                      value={Math.round(g.idleReapMs / 60000)}
                      onChange={(e) => setGlobalForm({ ...g, idleReapMs: Number(e.target.value) * 60000 })}
                    />
                    <Help>空闲的 agent 会话超过该时长自动结束进程并释放内存。会话记录与 ACP 会话仍保留，继续指令可正常恢复。</Help>
                  </div>
                  <div className="field">
                    <label>新项目默认就绪门禁</label>
                    <button className={`switch ${g.requireMachineDod ? 'on' : ''}`} onClick={() => setGlobalForm({ ...g, requireMachineDod: !g.requireMachineDod })} aria-label="默认就绪门禁" />
                    <Help>新注册项目是否默认要求「BDD 验收标准 + 至少一条机器 DoD」才能批准就绪；已有项目在下方单独配置。</Help>
                  </div>
                </div>
                <div className="field">
                  <label>新项目默认 Agent 终端</label>
                  <div className="seg">
                    {agentKinds.map((k) => (
                      <button key={k} className={g.defaultAgentKind === k ? 'on' : ''} onClick={() => setGlobalForm({ ...g, defaultAgentKind: k })}>
                        {k}
                      </button>
                    ))}
                  </div>
                  <Help>新注册项目默认使用的 ACP 编码终端。opencode 为默认测试终端；Claude Code 需 Anthropic 鉴权；Qoder CLI 需 qoderclicn login。</Help>
                </div>

                <div className="section-label" style={{ marginTop: 6 }}>向量检索（语义搜索）</div>
                <div className="settings-grid">
                  <div className="field">
                    <label>Embedding 接口地址</label>
                    <input
                      value={g.embeddingUrl}
                      onChange={(e) => setGlobalForm({ ...g, embeddingUrl: e.target.value })}
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
                      onChange={(e) => setGlobalForm({ ...g, embeddingModel: e.target.value })}
                      placeholder="text-embedding-3-small"
                    />
                    <Help>与接口匹配的模型名；本地服务可使用 bge-m3、nomic-embed-text 等。</Help>
                  </div>
                  <div className="field">
                    <label>Embedding API Key</label>
                    <input
                      type="password"
                      value={g.embeddingApiKey}
                      onChange={(e) => setGlobalForm({ ...g, embeddingApiKey: e.target.value })}
                      placeholder="可选；本地服务通常不需要"
                    />
                    <Help>仅保存在本机 SQLite 的全局设置中，不会写入项目或提示词。</Help>
                  </div>
                </div>
                <div className="section-label" style={{ marginTop: 6 }}>任务执行（Story Task）</div>
                <div className="settings-grid">
                  <div className="field">
                    <label>启用 AI 任务规划</label>
                    <button
                      className={`switch ${g.taskPlanning ? 'on' : ''}`}
                      onClick={() => setGlobalForm({ ...g, taskPlanning: !g.taskPlanning })}
                      aria-label="切换任务规划"
                    />
                    <Help>启动故事时先生成 2–8 个可排序的实现任务；关闭后降级为单任务执行，仍保留上下文注入与 DoD 门禁。</Help>
                  </div>
                  <div className="field">
                    <label>单故事最大任务数</label>
                    <input type="number" min={1} max={12} value={g.maxStoryTasks} onChange={(e) => setGlobalForm({ ...g, maxStoryTasks: Number(e.target.value) })} />
                    <Help>超过上限的计划会被拒绝并触发一次修复；任务过细会增加协调成本，建议 4–8。</Help>
                  </div>
                  <div className="field">
                    <label>单任务最大尝试次数</label>
                    <input type="number" min={1} max={5} value={g.maxTaskAttempts} onChange={(e) => setGlobalForm({ ...g, maxTaskAttempts: Number(e.target.value) })} />
                    <Help>任务验证失败后自动重试的次数；超过后故事转 blocked，保留 worktree 等待人工重试/跳过/重规划。</Help>
                  </div>
                  <div className="field">
                    <label>任务计划审批</label>
                    <select value={g.taskPlanReview} onChange={(e) => setGlobalForm({ ...g, taskPlanReview: e.target.value as GlobalSettings['taskPlanReview'] })}>
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
                      onClick={() => setGlobalForm({ ...g, parallelTasks: !g.parallelTasks })}
                      aria-label="切换并行任务"
                    />
                    <Help>开启后，无依赖且文件不冲突的 Task 在独立 worktree 并行执行，完成后串行合并回故事分支；关闭时严格串行。</Help>
                  </div>
                  <div className="field">
                    <label>最大并行任务数</label>
                    <input type="number" min={1} max={4} value={g.maxParallelTasks} onChange={(e) => setGlobalForm({ ...g, maxParallelTasks: Number(e.target.value) })} />
                    <Help>仅在开启并行执行时生效；并行任务越多，合并冲突与资源占用风险越高。</Help>
                  </div>
                  <div className="field">
                    <label>任务上下文预算（字符）</label>
                    <input type="number" min={2000} value={g.taskContextChars} onChange={(e) => setGlobalForm({ ...g, taskContextChars: Number(e.target.value) })} />
                    <Help>每次任务提示词注入上下文的总预算；超限时先裁剪代码索引/知识库，再压缩项目档案，不裁剪当前 Task、AC 与直接依赖。</Help>
                  </div>
                  <div className="field">
                    <label>Bug SLA（天，0=不计算）</label>
                    <input type="number" min={0} value={g.bugSlaDays} onChange={(e) => setGlobalForm({ ...g, bugSlaDays: Number(e.target.value) })} />
                    <Help>Bug 上报时计算截止时间；未关闭且超过截止时间计入逾期。仅作运营提醒，不自动升级或关闭。</Help>
                  </div>
                </div>
                <div className="settings-actions">
                  <button className="btn primary" disabled={saving !== null} onClick={saveGlobal}>
                    <Icon name="check" size={14} />
                    {saving === 'global' ? '保存中…' : '保存全局设置'}
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <h3>项目设置 · {project.name}</h3>
              <Help>仅对当前项目生效。修改 DoD 命令后，待批准的故事会在批准时自动补齐新增命令。</Help>
            </div>
            <div className="field">
              <label>Agent 终端（ACP）</label>
              <div className="seg">
                {agentKinds.map((k) => (
                  <button key={k} className={agentKind === k ? 'on' : ''} onClick={() => setAgentKind(k)}>
                    {k}
                  </button>
                ))}
              </div>
              <Help>驱动该项目的编码终端。平台通过 ACP 协议编排，事件、审批、DoD 与 worktree 契约与终端无关。</Help>
            </div>
            <div className="field">
              <label>模型（留空 = 终端默认）</label><input value={model} onChange={(e) => setModel(e.target.value)} placeholder="例如 deepseek-v4.1-flash 或留空" style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }} />
              <Help>
                钉住模型以保证结果可复现。opencode 通过 OPENCODE_MODEL 注入；Qoder CLI 通过 ACP set_config_option 设置；留空则沿用终端当前的默认模型（可能随终端配置变化）。
              </Help>
            </div>
            <div className="field">
              <label>发现模型（需求/Critic，留空 = 交付模型）</label>
              <input
                value={discoveryModel}
                onChange={(e) => setDiscoveryModel(e.target.value)}
                placeholder="例如 opencode-go/deepseek-v4.1-flash"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
              />
              <Help>仅用于需求发现与 Critic；交付实现使用上方模型。可按阶段选择更强/更便宜的模型。</Help>
            </div>
            <div className="field">
              <label>项目术语表（可选）</label>
              <textarea
                value={glossary}
                onChange={(e) => setGlossary(e.target.value)}
                placeholder={'术语 = 定义\n例如：Story = 用户可验收的最小交付单元'}
                style={{ minHeight: 90, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
              />
              <Help>需求发现阶段会注入术语表，要求 AI 使用统一术语，减少“用户故事 / 需求项 / 任务”混用。</Help>
            </div>
            <div className="field">
              <label>发布命令（可选）</label>
              <input
                value={releaseCommand}
                onChange={(e) => setReleaseCommand(e.target.value)}
                placeholder="例如 npm run deploy:staging"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
              />
              <Help>故事验收合并后，人工点击“发布”在项目主仓库执行；输出与状态写入发布记录和事件。</Help>
            </div>
            <div className="field">
              <label>回滚命令（可选）</label>
              <input
                value={rollbackCommand}
                onChange={(e) => setRollbackCommand(e.target.value)}
                placeholder="例如 npm run deploy:rollback"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
              />
              <Help>仅允许对最近一次成功发布执行回滚；失败会记录为 rollback_failed 并保留证据。</Help>
            </div>
            <div className="field">
              <label>契约检查命令（可选）</label>
              <input
                value={contractCommand}
                onChange={(e) => setContractCommand(e.target.value)}
                placeholder="例如 npm run test:contracts"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
              />
              <Help>人工验收合并前在故事 worktree 中执行；失败则阻止合并。用于接口契约、跨模块集成与并行故事冲突检查。</Help>
            </div>
            <div className="field">
              <label>安全/质量策略门禁（每行：标签 | 命令 | block/warn）</label>
              <textarea
                value={policyGateText}
                onChange={(e) => setPolicyGateText(e.target.value)}
                placeholder={'secret-scan | npm run security:secrets | block\ndependency-audit | npm audit --omit=dev | warn'}
                style={{ minHeight: 90, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <Help>策略命令会作为 DoD 条目在 worktree 中执行；block 失败阻止进入 review，warn 只记录证据。可用于 secret scan、依赖审计、SAST、license、覆盖率阈值。</Help>
            </div>
            <div className="field">
              <label>开发模式</label>
              <div className="toggle-row">
                <div className="desc">
                  <div className="t">{teamMode ? '团队模式（Lead + Dev + QA）' : 'Solo 模式（单 agent）'}</div>
                  <div className="d">
                    {teamMode
                      ? 'Lead 规划 → Dev 实现 → QA 评审 → 门禁四阶段；返工续用 Dev 会话并注入 QA 问题。'
                      : '单 agent 直接实现，DoD 门禁通过后人工验收。'}
                  </div>
                </div>
                <button className={`switch ${teamMode ? 'on' : ''}`} onClick={() => setTeamMode(!teamMode)} aria-label="切换团队模式" />
              </div>
              <Help>团队模式把规划、实现、评审拆成三个角色会话，交接只用计划、diff 与评审结论等工件，避免角色上下文互相污染。</Help>
            </div>
            <div className="field">
              <label>就绪门禁</label>
              <div className="toggle-row">
                <div className="desc">
                  <div className="t">{requireMachineDod ? '已开启' : '已关闭'}</div>
                  <div className="d">批准就绪时校验 BDD 验收标准与机器 DoD 命令。</div>
                </div>
                <button className={`switch ${requireMachineDod ? 'on' : ''}`} onClick={() => setRequireMachineDod(!requireMachineDod)} aria-label="切换就绪门禁" />
              </div>
              <Help>开启后，故事必须填写 BDD 验收标准，且项目至少有一条机器可验证 DoD 命令，才能从 Draft 批准为 Ready。关闭会让质量完全依赖人工验收。</Help>
            </div>
            <div className="field">
              <label>自动审批：只读工具</label>
              <div className="toggle-row">
                <div className="desc">
                  <div className="t">{autoApproveReads ? '自动放行 read/search' : '全部人工审批'}</div>
                  <div className="d">读文件、检索类工具不打断人工；写、删除、网络仍需批准。</div>
                </div>
                <button className={`switch ${autoApproveReads ? 'on' : ''}`} onClick={() => setAutoApproveReads(!autoApproveReads)} aria-label="切换只读自动审批" />
              </div>
              <Help>每条自动批准都会写入审批记录（decidedBy=policy）可追溯，不会静默执行。</Help>
            </div>
            <div className="field">
              <label>自动审批：命令白名单（每行一条前缀）</label>
              <textarea
                rows={3}
                value={autoApproveCommands}
                onChange={(e) => setAutoApproveCommands(e.target.value)}
                placeholder={'npm test\nnode --test\ngit status'}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
              />
              <Help>agent 请求执行命令时，若命令以白名单前缀开头则自动放行（例如 npm test）。建议只放行测试与只读 git 命令；写操作、删除、网络请求不要加入。</Help>
            </div>
            <div className="field">
              <label>DoD 命令（机器可验证）</label>
              {dodCommands.map((cmd, i) => (
                <div className="dod-row" key={i}>
                  <select value={cmd.kind} onChange={(e) => patchDod(i, { kind: e.target.value as DodCommand['kind'] })}>
                    {DOD_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <input value={cmd.label} placeholder="标签，例如 单元测试" onChange={(e) => patchDod(i, { label: e.target.value })} />
                  <input
                    value={cmd.command}
                    placeholder="命令，例如 npm test"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
                    onChange={(e) => patchDod(i, { command: e.target.value })}
                  />
                  <button className="btn sm ghost" onClick={() => setDodCommands((rows) => rows.filter((_, idx) => idx !== i))} aria-label="删除 DoD 命令">
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
              <button className="btn sm" onClick={() => setDodCommands((rows) => [...rows, { kind: 'test', label: '', command: '' }])}>
                <Icon name="plus" size={13} />
                添加 DoD 命令
              </button>
              <Help>
                在故事的隔离 worktree 中依次执行，全部通过才进入 Review（失败则保持 In Dev 并给出证据）。入驻分析会把扫描到的测试命令自动写入这里。
              </Help>
            </div>
            <div className="settings-actions">
              <button className="btn primary" disabled={saving !== null} onClick={saveProject}>
                <Icon name="check" size={14} />
                {saving === 'project' ? '保存中…' : '保存项目设置'}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <h3>知识库 · ADR / 规范 / 失败记忆</h3>
              <Help>知识条目会按需求/故事文本做轻量语义检索，注入发现与交付提示词；QA 失败会自动写入失败记忆。</Help>
            </div>
            <div className="settings-grid">
              <div className="field">
                <label>类型</label>
                <select value={knowledgeKind} onChange={(e) => setKnowledgeKind(e.target.value as KnowledgeKind)}>
                  <option value="adr">ADR 架构决策</option>
                  <option value="standard">编码/团队规范</option>
                  <option value="failure">历史失败</option>
                </select>
              </div>
              <div className="field">
                <label>标签（逗号分隔）</label>
                <input value={knowledgeTags} onChange={(e) => setKnowledgeTags(e.target.value)} placeholder="例如 api,contract" />
              </div>
            </div>
            <div className="field">
              <label>标题</label>
              <input value={knowledgeTitle} onChange={(e) => setKnowledgeTitle(e.target.value)} placeholder="例如 API 变更必须保持向后兼容" />
            </div>
            <div className="field">
              <label>内容</label>
              <textarea value={knowledgeContent} onChange={(e) => setKnowledgeContent(e.target.value)} placeholder="决策、约束、失败原因与修复方式" style={{ minHeight: 80 }} />
            </div>
            <div className="settings-actions">
              <button className="btn" onClick={addKnowledgeEntry}>
                <Icon name="plus" size={13} />
                添加知识
              </button>
            </div>
            <div className="req-feedback-list" style={{ marginTop: 12 }}>
              {knowledgeEntries.length === 0 && <div className="hint">暂无知识条目。</div>}
              {knowledgeEntries.map((entry) => (
                <div className="req-feedback-row" key={entry.id}>
                  <span className="badge">{entry.kind}</span>
                  <span style={{ flex: 1 }}>{entry.title}</span>
                  {entry.tags && <span className="req-note">{entry.tags}</span>}
                  <button className="btn sm ghost" onClick={() => removeKnowledgeEntry(entry.id)} aria-label="删除知识">
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
