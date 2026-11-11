import { useState } from 'react';
import type { Project } from '@acp-scrum/shared';
import { Icon } from '../icons';

export function SettingsModal({
  project,
  busy,
  onClose,
  onSave,
}: {
  project: Project;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: { agentKind: string; teamMode: boolean }) => void;
}) {
  const [agentKind, setAgentKind] = useState(project.agentKind);
  const [teamMode, setTeamMode] = useState(project.teamMode);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="项目设置">
        <div className="modal-head">
          <Icon name="layers" size={18} style={{ color: 'var(--indigo-bright)', marginRight: 10 }} />
          <h3>项目设置</h3>
          <span className="badge" style={{ marginLeft: 'auto' }}>{project.name}</span>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Agent 终端（ACP）</label>
            <div className="seg">
              <button className={agentKind === 'opencode' ? 'on' : ''} onClick={() => setAgentKind('opencode')}>opencode</button>
              <button className={agentKind === 'claude-code' ? 'on' : ''} onClick={() => setAgentKind('claude-code')}>Claude Code</button>
            </div>
            <div className="help">通过 ACP 协议接入，编排逻辑与终端无关。Claude Code 需另行鉴权。</div>
          </div>
          <div className="field">
            <label>开发模式</label>
            <div className="toggle-row">
              <div className="desc">
                <div className="t">{teamMode ? '团队模式（Lead + Dev + QA）' : 'Solo 模式（单 agent）'}</div>
                <div className="d">{teamMode ? '规划→实现→评审→门禁四阶段编排，含冲突预检与预算熔断。' : '单 agent 直接实现，DoD 门禁后人工验收。'}</div>
              </div>
              <button className={`switch ${teamMode ? 'on' : ''}`} onClick={() => setTeamMode(!teamMode)} aria-label="切换团队模式" />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy} onClick={() => onSave({ agentKind, teamMode })}>
            <Icon name="check" size={14} />
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}