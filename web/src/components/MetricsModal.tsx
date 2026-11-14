import { useEffect, useState } from 'react';
import type { FlowMetrics, Project, QualityMetrics } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon, type IconName } from '../icons';

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  const min = ms / 60000;
  if (min < 60) return `${min.toFixed(1)} 分钟`;
  const hr = min / 60;
  if (hr < 24) return `${hr.toFixed(1)} 小时`;
  return `${(hr / 24).toFixed(1)} 天`;
}

function fmtRate(r: number | null): string {
  return r == null ? '—' : `${(r * 100).toFixed(0)}%`;
}

function MetricCard({ icon, label, value, color, sub }: { icon: IconName; label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="metric-card">
      <span className="mc-ico" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
        <Icon name={icon} size={16} />
      </span>
      <div className="mc-value" style={{ color }}>{value}</div>
      <div className="mc-label">{label}</div>
      {sub && <div className="mc-sub">{sub}</div>}
    </div>
  );
}

export function MetricsModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [m, setM] = useState<FlowMetrics | null>(null);
  const [quality, setQuality] = useState<QualityMetrics | null>(null);
  useEffect(() => {
    api.metrics(project.id).then(setM).catch(() => undefined);
    api.qualityMetrics(project.id).then(setQuality).catch(() => undefined);
  }, [project.id]);

  const total = m ? m.done + m.inProgress + m.blocked : 0;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="流动度量">
        <div className="modal-head">
          <Icon name="activity" size={18} style={{ color: 'var(--cyan)', marginRight: 10 }} />
          <h3>流动与 DORA 度量</h3>
          <span className="badge cyan" style={{ marginLeft: 10 }}>{project.name}</span>
          <button className="btn icon ghost" onClick={onClose} aria-label="关闭" data-tip="关闭流动与 DORA 度量弹窗" style={{ marginLeft: 'auto' }}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          {!m && <div className="rail-empty">加载中…</div>}
          {m && (
            <>
              <div className="metric-grid">
                <MetricCard icon="merge" label="吞吐量（已完成）" value={String(m.throughput)} color="var(--green)" />
                <MetricCard icon="bot" label="进行中 WIP" value={String(m.inProgress)} color="var(--cyan)" />
                <MetricCard icon="alert" label="阻塞" value={String(m.blocked)} color="var(--red)" />
                <MetricCard icon="refresh" label="返工次数" value={String(m.reworkCount)} color="var(--amber)" />
                <MetricCard icon="clock" label="平均 Lead Time" value={fmtDuration(m.avgLeadTimeMs)} color="var(--indigo-bright)" sub="创建 → 完成" />
                <MetricCard icon="clock" label="平均 Cycle Time" value={fmtDuration(m.avgCycleTimeMs)} color="var(--magenta)" sub="就绪 → 完成" />
                <MetricCard icon="shield" label="变更失败率" value={fmtRate(m.changeFailRate)} color="var(--amber)" sub="曾阻塞 / 已结束" />
              </div>

              {quality && (
                <>
                  <div className="section-label" style={{ marginTop: 20 }}>质量与成本</div>
                  <div className="metric-grid">
                    <MetricCard icon="check" label="一次验收通过率" value={fmtRate(quality.firstPassAcceptanceRate)} color="var(--green)" sub={`${quality.acceptedWithoutRework}/${quality.accepted} 个已接受故事`} />
                    <MetricCard icon="clock" label="平均人工评审耗时" value={fmtDuration(quality.avgReviewMs)} color="var(--amber)" sub="进入 Review → Done" />
                    <MetricCard icon="activity" label="每接受故事 tokens" value={quality.avgTokensPerAccepted == null ? '—' : Math.round(quality.avgTokensPerAccepted).toLocaleString()} color="var(--cyan)" />
                    <MetricCard icon="layers" label="已接受故事 tokens" value={quality.totalTokens.toLocaleString()} color="var(--indigo-bright)" />
                  </div>
                </>
              )}

              <div className="section-label" style={{ marginTop: 20 }}>状态分布</div>
              <div className="dist-bar">
                <span style={{ width: `${pct(m.done)}%`, background: 'var(--st-done)' }} title={`Done ${m.done}`} />
                <span style={{ width: `${pct(m.inProgress)}%`, background: 'var(--st-indev)' }} title={`In Dev ${m.inProgress}`} />
                <span style={{ width: `${pct(m.blocked)}%`, background: 'var(--st-blocked)' }} title={`Blocked ${m.blocked}`} />
              </div>
              <div className="dist-legend">
                <span><i style={{ background: 'var(--st-done)' }} /> Done {m.done}</span>
                <span><i style={{ background: 'var(--st-indev)' }} /> In Dev {m.inProgress}</span>
                <span><i style={{ background: 'var(--st-blocked)' }} /> Blocked {m.blocked}</span>
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="hint" style={{ marginRight: 'auto', fontSize: 11.5, color: 'var(--text-low)' }}>
            基于故事状态机与事件流实时计算
          </span>
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}