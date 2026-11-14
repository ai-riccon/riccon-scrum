import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalInfo } from '@riccon-scrum/shared';
import { api } from '../../api';
import { Icon } from '../../icons';
import type { ProjectConfigProps } from './types';
import { Help, SaveBar } from './SettingsUi';

function modelLabel(value: string, name: string): string {
  return name && name !== value ? `${name} · ${value}` : value;
}

export function TerminalPane({ project, agentKinds, onToast, onChanged }: ProjectConfigProps) {
  const [infos, setInfos] = useState<TerminalInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [agentKind, setAgentKind] = useState(project.agentKind);
  const [model, setModel] = useState(project.model);
  const [discoveryModel, setDiscoveryModel] = useState(project.discoveryModel);
  const [thinking, setThinking] = useState(project.thinking);
  const [saving, setSaving] = useState(false);
  const autoProbed = useRef<Set<string>>(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await api.terminals();
      if (mounted.current) setInfos(list);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const merge = useCallback((info: TerminalInfo) => {
    setInfos((prev) => (prev ? prev.map((item) => (item.kind === info.kind ? info : item)) : [info]));
  }, []);

  const probe = useCallback(
    async (kind: string, silent = false) => {
      setBusy(`${kind}:probe`);
      try {
        const info = await api.probeTerminal(kind, project.id);
        if (!mounted.current) return;
        merge(info);
        if (!silent) {
          if (info.probeError) onToast('error', `${info.label} 探测失败：${info.probeError}`);
          else onToast('success', `${info.label} 已连接，读取到 ${info.models.length} 个模型`);
        }
      } catch (err) {
        if (!silent) onToast('error', err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [merge, onToast, project.id],
  );

  const checkUpdate = useCallback(
    async (kind: string) => {
      setBusy(`${kind}:update`);
      try {
        const info = await api.checkTerminalUpdate(kind);
        if (!mounted.current) return;
        merge(info);
        if (info.updateError) onToast('error', `${info.label} 检查更新失败：${info.updateError}`);
        else if (info.updateAvailable) onToast('success', `${info.label} 有新版本 ${info.latestVersion}`);
        else onToast('success', `${info.label} 已是最新版本`);
      } catch (err) {
        onToast('error', err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [merge, onToast],
  );

  const active = infos?.find((info) => info.kind === agentKind) ?? null;
  const activeModels = active?.models ?? [];
  const thoughtOption = active?.configOptions.find(
    (option) => option.category === 'thought_level' || /thought|think|reason|思考/i.test(`${option.id} ${option.name}`),
  );
  const thoughtChoices = thoughtOption?.options ?? [];
  const modelOption = active?.configOptions.find(
    (option) => option.category === 'model' || /model|模型/i.test(`${option.id} ${option.name}`),
  );

  // The selected terminal's model list is the most useful thing on this page, so fetch it once.
  useEffect(() => {
    if (!active || !active.installed || active.probedAt || active.probeError || busy) return;
    if (autoProbed.current.has(active.kind)) return;
    autoProbed.current.add(active.kind);
    void probe(active.kind, true);
  }, [active, busy, probe]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(project.id, { agentKind, model, discoveryModel, thinking });
      onToast('success', '终端与模型设置已保存');
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !infos) return <div className="settings-loading">正在检测终端…</div>;

  return (
    <section className="settings-section">
      <div className="section-label">终端版本与更新</div>
      <div className="term-list">
        {(infos ?? []).map((info) => {
          const isActive = info.kind === agentKind;
          const probing = busy === `${info.kind}:probe`;
          const checking = busy === `${info.kind}:update`;
          const showAll = expanded[info.kind];
          const visible = showAll ? info.models : info.models.slice(0, 8);
          return (
            <div key={info.kind} className={`term-card ${isActive ? 'active' : ''}`}>
              <div className="term-head">
                <div className="term-name">
                  <Icon name="terminal" size={15} />
                  <strong>{info.label}</strong>
                  <code>{info.kind}</code>
                </div>
                <div className="term-badges">
                  <span className={`badge ${info.installed ? 'green' : 'red'}`}>{info.installed ? '已安装' : '未检测到'}</span>
                  {info.updateAvailable === true && <span className="badge amber">可更新</span>}
                  {info.updateAvailable === false && <span className="badge green">最新</span>}
                  {isActive && <span className="badge cyan">当前项目</span>}
                </div>
              </div>

              <div className="term-meta">
                <div>
                  <span>终端版本</span>
                  <code>{info.version ?? '未知'}</code>
                </div>
                <div>
                  <span>最新版本</span>
                  <code>{info.latestVersion ?? '未检查'}</code>
                </div>
                <div>
                  <span>模型数</span>
                  <code>{info.probedAt ? String(info.models.length) : '未探测'}</code>
                </div>
              </div>

              <div className="term-path" title={info.command}>
                {info.command}
              </div>
              <div className="term-desc">{info.description}</div>
              {isActive && modelOption && (
                <div className="term-hint">
                  终端当前模型：<code>{String(modelOption.currentValue)}</code>
                  {thoughtOption ? (
                    <>
                      ，思考强度：<code>{String(thoughtOption.currentValue)}</code>
                    </>
                  ) : (
                    '，未暴露思考强度配置项'
                  )}
                </div>
              )}

              {info.versionError && <div className="term-error">版本检测：{info.versionError}</div>}
              {info.updateError && <div className="term-error">检查更新：{info.updateError}</div>}
              {info.probeError && <div className="term-error">模型探测：{info.probeError}</div>}

              <div className="term-actions">
                <button className="btn sm" disabled={Boolean(busy)} onClick={() => void probe(info.kind)} data-tip="通过 ACP 探测该终端已配置的模型与思考强度选项">
                  <Icon name="refresh" size={13} />
                  {probing ? '探测中…' : '检测模型'}
                </button>
                <button className="btn sm ghost" disabled={Boolean(busy)} onClick={() => void checkUpdate(info.kind)} data-tip="查询 npm registry，判断该终端是否有新版本">
                  <Icon name="activity" size={13} />
                  {checking ? '检查中…' : '检查更新'}
                </button>
                {!isActive && (
                  <button className="btn sm ghost" onClick={() => setAgentKind(info.kind)} data-tip="把该终端设为当前项目使用的 ACP 编码终端，保存后生效">
                    <Icon name="check" size={13} />
                    设为当前终端
                  </button>
                )}
                {info.homepage && (
                  <a className="btn sm ghost" href={info.homepage} target="_blank" rel="noreferrer">
                    主页
                  </a>
                )}
              </div>

              {info.models.length > 0 ? (
                <div className="term-models">
                  <div className="term-models-label">
                    终端已配置模型
                    <span className="badge">{info.models.length}</span>
                    {info.models.length > 8 && (
                      <button className="term-link" onClick={() => setExpanded((prev) => ({ ...prev, [info.kind]: !showAll }))} data-tip={showAll ? '收起模型列表' : '展开该终端上报的全部模型'}>
                        {showAll ? '收起' : '全部'}
                      </button>
                    )}
                  </div>
                  <div className="term-chips">
                    {visible.map((choice) => (
                      <span className="chip" key={choice.value} title={choice.description ?? choice.group ?? choice.name}>
                        {choice.name && choice.name !== choice.value ? choice.name : choice.value}
                        {choice.value !== choice.name && <em>{choice.value}</em>}
                      </span>
                    ))}
                  </div>
                  {thoughtChoices.length > 0 && (
                    <div className="term-hint">
                      思考强度：{thoughtChoices.map((choice) => choice.name || choice.value).join(' / ')}
                    </div>
                  )}
                </div>
              ) : (
                <div className="term-hint">
                  {info.probedAt
                    ? '终端未上报可配置模型（可能依赖终端自身配置文件）。'
                    : '尚未探测模型列表；点击「检测模型」通过 ACP 读取终端当前配置。'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="section-label" style={{ marginTop: 20 }}>
        当前项目默认参数
      </div>
      <div className="field">
        <label>Agent 终端（ACP）</label>
        <div className="seg">
          {agentKinds.map((kind) => (
            <button key={kind} className={agentKind === kind ? 'on' : ''} onClick={() => setAgentKind(kind)} data-tip={`把 ${kind} 设为当前项目的 ACP 编码终端，保存后生效`}>
              {kind}
            </button>
          ))}
        </div>
        <Help>驱动该项目的编码终端。平台通过 ACP 协议编排，事件、审批、DoD 与 worktree 契约与终端无关。</Help>
      </div>

      <div className="settings-grid">
        <div className="field">
          <label>默认模型（留空 = 终端默认）</label>
          <input
            list="terminal-model-options"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={modelOption ? `终端当前：${modelOption.currentValue}` : '例如 deepseek-v4.1-flash 或留空'}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
          />
          <datalist id="terminal-model-options">
            {activeModels.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {modelLabel(choice.value, choice.name)}
              </option>
            ))}
          </datalist>
          <Help>
            下拉选项来自终端通过 ACP 上报的已配置模型，也可以手工输入模型 ID（支持 provider/model 形式）。
            钉住模型可保证结果可复现；留空则沿用终端当前默认模型。
          </Help>
        </div>

        <div className="field">
          <label>思考强度（留空 = 终端默认）</label>
          <input
            list="terminal-thought-options"
            value={thinking}
            onChange={(e) => setThinking(e.target.value)}
            placeholder={thoughtOption ? `终端当前：${String(thoughtOption.currentValue)}` : '终端未暴露该参数时留空'}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
          />
          <datalist id="terminal-thought-options">
            {thoughtChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {modelLabel(choice.value, choice.name)}
              </option>
            ))}
          </datalist>
          {thoughtChoices.length > 0 ? (
            <div className="term-quick">
              {thoughtChoices.map((choice) => (
                <button
                  key={choice.value}
                  className={`btn sm ghost ${thinking === choice.value ? 'on' : ''}`}
                  onClick={() => setThinking(thinking === choice.value ? '' : choice.value)}
                  data-tip={`把思考强度设为 ${choice.name || choice.value}${thinking === choice.value ? '（再次点击取消）' : ''}`}
                >
                  {choice.name || choice.value}
                </button>
              ))}
            </div>
          ) : null}
          <Help>
            思考强度会映射到终端的 `thought_level` 配置项（例如 low/medium/high）。终端未提供该配置项时会被忽略，
            会话中会记录一条平台提示，不会阻断执行。
          </Help>
        </div>
      </div>

      <div className="field">
        <label>发现模型（需求/Critic，留空 = 交付模型）</label>
        <input
          list="terminal-model-options"
          value={discoveryModel}
          onChange={(e) => setDiscoveryModel(e.target.value)}
          placeholder="例如 opencode-go/deepseek-v4.1-flash"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
        />
        <Help>仅用于需求发现、依赖建议与 Critic；交付实现使用上方默认模型。可按阶段选择更强/更便宜的模型。</Help>
      </div>

      <SaveBar label="保存终端与模型设置" busy={saving} onClick={save} />
    </section>
  );
}
