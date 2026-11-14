import { useState } from 'react';
import { Icon } from '../icons';
import { FolderPickerModal } from './FolderPickerModal';
import { confirmAction } from './ConfirmDialog';

export interface RegisterInput {
  name: string;
  repoPath: string;
  agentKind: string;
  teamMode: boolean;
}

function folderName(folder: string): string {
  return folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
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
  const [agentKind, setAgentKind] = useState('opencode');
  const [teamMode, setTeamMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const valid = name.trim().length > 0 && repoPath.trim().length > 0;

  return (
    <>
      <div className="modal-scrim" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="新建项目">
          <div className="modal-head">
            <Icon name="branch" size={18} style={{ color: 'var(--indigo-bright)', marginRight: 10 }} />
            <h3>新建项目</h3>
          </div>
          <div className="modal-body">
            <div className="field">
              <label>项目名称 *</label>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：用户中心服务" />
            </div>
            <div className="field">
              <label>项目文件夹 *</label>
              <div className="path-picker">
                <input
                  readOnly
                  value={repoPath}
                  onClick={() => setPickerOpen(true)}
                  placeholder="点击选择文件夹"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, cursor: 'pointer' }}
                />
                <button className="btn small" onClick={() => setPickerOpen(true)}>
                  <Icon name="folder" size={13} />
                  选择文件夹
                </button>
              </div>
              <div className="help">可选择任意文件夹；无需已存在 Git 仓库，创建后可一键创建本地仓库。</div>
            </div>
            <div className="field">
              <label>Agent 终端（ACP）</label>
              <div className="seg">
                <button className={agentKind === 'opencode' ? 'on' : ''} onClick={() => setAgentKind('opencode')}>opencode</button>
                <button className={agentKind === 'claude-code' ? 'on' : ''} onClick={() => setAgentKind('claude-code')}>Claude Code</button>
                <button className={agentKind === 'qoder-cli' ? 'on' : ''} onClick={() => setAgentKind('qoder-cli')}>Qoder CLI</button>
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
              onClick={async () => {
                const ok = await confirmAction({
                  title: '创建项目',
                  message: '将监听代码文件夹并初始化项目数据、Git 分支与平台配置。',
                  detail: `${name.trim()}\n${repoPath.trim()}\n终端：${agentKind} · ${teamMode ? '团队模式' : 'Solo 模式'}`,
                  confirmText: '创建项目',
                });
                if (!ok) return;
                onRegister({ name: name.trim(), repoPath: repoPath.trim(), agentKind, teamMode });
              }}
            >
              <Icon name="plus" size={14} />
              新建项目
            </button>
          </div>
        </div>
      </div>
      {pickerOpen && (
        <FolderPickerModal
          initialPath={repoPath || undefined}
          onClose={() => setPickerOpen(false)}
          onSelect={(folder) => {
            setRepoPath(folder);
            if (!name.trim()) setName(folderName(folder));
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}
