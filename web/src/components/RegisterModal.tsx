import { useState } from 'react';
import { Icon } from '../icons';

export interface RegisterInput {
  name: string;
  repoPath: string;
  defaultBranch: string;
  agentKind: string;
  teamMode: boolean;
}

export function RegisterModal({
  busy,
  onClose,
  onRegister,
}: {
  busy: boolean;
  onClose: () => void;
  onRegister: (input: RegisterInput) => void;
}) {
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [agentKind, setAgentKind] = useState('opencode');
  const [teamMode, setTeamMode] = useState(false);
  const valid = name.trim().length > 0 && repoPath.trim().length > 0;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="注册项目">
        <div className="modal-head">
          <Icon name="branch" size={18} style={{ color: 'var(--indigo-bright)', marginRight: 10 }} />
          <h3>注册项目</h3>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>项目名称 *</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：用户中心服务" />
          </div>
          <div className="field">
            <label>Git 仓库绝对路径 *</label>
            <input value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="例如：D:\Development\my-service" style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }} />
            <div className="help">需为已存在的本地 git 仓库（含至少一次提交）。</div>
          </div>
          <div className="field">
            <label>默认分支</label>
            <input value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} placeholder="main" />
          </div>
          <div className="field">
            <label>Agent 终端（ACP）</label>
            <div className="seg">
              <button className={agentKind === 'opencode' ? 'on' : ''} onClick={() => setAgentKind('opencode')}>opencode</button>
              <button className={agentKind === 'claude-code' ? 'on' : ''} onClick={() => setAgentKind('claude-code')}>Claude Code</button>
            </div>
          </div>
          <div className="field">
            <label>开发模式</label>
            <div className="toggle-row">
              <div className="desc">
                <div className="t">{teamMode ? '团队模式（Lead + Dev + QA）' : 'Solo 模式（单 agent）'}</div>
                <div className="d">{teamMode ? '四阶段编排，含冲突预检与预算熔断。' : '单 agent 实现，DoD 门禁后人工验收。'}</div>
              </div>
              <button className={`switch ${teamMode ? 'on' : ''}`} onClick={() => setTeamMode(!teamMode)} aria-label="切换团队模式" />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button
            className="btn primary"
            disabled={!valid || busy}
            onClick={() => onRegister({ name: name.trim(), repoPath: repoPath.trim(), defaultBranch: defaultBranch.trim() || 'main', agentKind, teamMode })}
          >
            <Icon name="plus" size={14} />
            注册项目
          </button>
        </div>
      </div>
    </div>
  );
}