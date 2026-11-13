import { useState } from 'react';
import type { DodCommand } from '@riccon-scrum/shared';
import { api } from '../../api';
import { Icon } from '../../icons';
import type { ProjectConfigProps, ProjectPaneProps } from './types';
import { Help, SaveBar } from './SettingsUi';

const DOD_KINDS: DodCommand['kind'][] = ['test', 'build', 'lint', 'custom'];

export function ProjectConfigPane({ project, agentKinds, onToast, onChanged }: ProjectConfigProps) {
  const [agentKind, setAgentKind] = useState(project.agentKind);
  const [teamMode, setTeamMode] = useState(project.teamMode);
  const [model, setModel] = useState(project.model);
  const [discoveryModel, setDiscoveryModel] = useState(project.discoveryModel);
  const [glossary, setGlossary] = useState(project.glossary);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(project.id, { agentKind, teamMode, model, discoveryModel, glossary });
      onToast('success', '项目设置已保存');
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-section">
      <div className="settings-info-grid">
        <div>
          <span>项目文件夹</span>
          <code>{project.repoPath}</code>
        </div>
        <div>
          <span>默认分支</span>
          <code>{project.defaultBranch}</code>
        </div>
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
        <label>模型（留空 = 终端默认）</label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="例如 deepseek-v4.1-flash 或留空"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
        />
        <Help>钉住模型以保证结果可复现。opencode 通过 OPENCODE_MODEL 注入；Qoder CLI 通过 ACP set_config_option 设置；留空则沿用终端当前的默认模型。</Help>
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
      <SaveBar label="保存项目设置" busy={saving} onClick={save} />
    </section>
  );
}

export function DeliveryPane({ project, onToast, onChanged }: ProjectPaneProps) {
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
  const [saving, setSaving] = useState(false);

  const patchDod = (i: number, patch: Partial<DodCommand>) =>
    setDodCommands((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(project.id, {
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
      onToast('success', '交付与门禁设置已保存');
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-section">
      <div className="section-label">发布与契约</div>
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
      <div className="section-label" style={{ marginTop: 6 }}>门禁与审批</div>
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
      <div className="section-label" style={{ marginTop: 6 }}>DoD 命令</div>
      <div className="field">
        <label>机器可验证命令</label>
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
        <Help>在故事的隔离 worktree 中依次执行，全部通过才进入 Review（失败则保持 In Dev 并给出证据）。入驻分析会把扫描到的测试命令自动写入这里。</Help>
      </div>
      <SaveBar label="保存交付与门禁设置" busy={saving} onClick={save} />
    </section>
  );
}
