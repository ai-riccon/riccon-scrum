import { useEffect, useMemo, useState } from 'react';
import type { StoryTask, StoryTaskMetrics, StoryTaskPlan } from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';
import { TASK_STATUS_META, timeOf } from '../ui';

export function TaskTab({
  storyId,
  projectId,
  storyStatus,
  acIds,
  lastEventSeq,
  onToast,
  onChanged,
}: {
  storyId: string;
  projectId: string;
  storyStatus: string;
  acIds: string[];
  lastEventSeq: number;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<StoryTaskPlan | null>(null);
  const [metrics, setMetrics] = useState<StoryTaskMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<StoryTask | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    files: '',
    acIds: '',
    verifyCommand: '',
    dependsOnKeys: [] as string[],
  });

  const refresh = async () => {
    setLoading(true);
    try {
      const [next, stats] = await Promise.all([api.storyTasks(storyId), api.taskMetrics(projectId)]);
      setPlan(next);
      setMetrics(stats);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, lastEventSeq]);

  const tasksById = useMemo(() => new Map((plan?.tasks ?? []).map((task) => [task.id, task])), [plan]);
  const dependencies = (task: StoryTask) =>
    (plan?.edges ?? [])
      .filter((edge) => edge.taskId === task.id)
      .map((edge) => tasksById.get(edge.dependsOnTaskId)?.key)
      .filter((key): key is string => Boolean(key));

  const startEdit = (task: StoryTask) => {
    setEditing(task);
    setForm({
      title: task.title,
      description: task.description,
      files: task.files.join(', '),
      acIds: task.acIds.join(', '),
      verifyCommand: task.verifyCommand ?? '',
      dependsOnKeys: dependencies(task),
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setLoading(true);
    try {
      const next = await api.updateStoryTask(storyId, editing.id, {
        title: form.title.trim(),
        description: form.description,
        files: form.files.split(',').map((item) => item.trim()).filter(Boolean),
        acIds: form.acIds.split(',').map((item) => item.trim()).filter(Boolean),
        verifyCommand: form.verifyCommand.trim() || null,
        dependsOnKeys: form.dependsOnKeys,
      });
      setPlan(next);
      setEditing(null);
      onToast('success', '任务计划已更新');
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const retry = async (task: StoryTask) => {
    setLoading(true);
    try {
      await api.retryStoryTask(storyId, task.id);
      await refresh();
      onToast('info', `任务 ${task.key} 已重置，点击「继续」重新执行`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const skip = async (task: StoryTask) => {
    const reason = window.prompt(`跳过任务 ${task.key} 的原因（会记录审计）`);
    if (!reason?.trim()) return;
    setLoading(true);
    try {
      await api.skipStoryTask(storyId, task.id, reason.trim());
      await refresh();
      onToast('info', `任务 ${task.key} 已跳过`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const replan = async () => {
    if (!window.confirm('只有未完成的任务会被替换，已完成任务会保留。继续？')) return;
    setLoading(true);
    try {
      const failure = plan?.tasks.find((task) => task.status === 'failed')?.evidence ?? '';
      const result = await api.replanStoryTasks(storyId, failure);
      setPlan(result.plan);
      onToast('success', '未完成任务已重新规划');
      await onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!plan) return <div className="rail-empty">{loading ? '加载任务计划…' : '暂无任务计划'}</div>;

  return (
    <>
      <div className="task-summary">
        <div className="team-stat">
          <span className="ts-label">任务进度</span>
          <span className="ts-value">
            {plan.tasks.filter((task) => task.status === 'done' || task.status === 'skipped').length}/{plan.tasks.length}
          </span>
        </div>
        <div className="team-stat">
          <span className="ts-label">项目一次通过率</span>
          <span className="ts-value">{metrics?.firstPassRate == null ? '—' : `${Math.round(metrics.firstPassRate * 100)}%`}</span>
        </div>
        <div className="team-stat">
          <span className="ts-label">项目平均尝试</span>
          <span className="ts-value">{metrics?.avgAttempts == null ? '—' : metrics.avgAttempts.toFixed(1)}</span>
        </div>
        <div className="team-stat">
          <span className="ts-label">本故事 Tokens</span>
          <span className="ts-value">{plan.tasks.reduce((sum, task) => sum + task.tokens, 0).toLocaleString()}</span>
        </div>
      </div>
      {plan.strategy && <div className="req-note">{plan.strategy}</div>}
      {plan.criticalPath.length > 0 && <div className="hint">关键路径：{plan.criticalPath.join(' → ')}</div>}
      <div className="section-label" style={{ marginTop: 18 }}>
        任务计划
        {plan.source === 'fallback' && <span className="badge amber" style={{ marginLeft: 8 }}>降级单任务</span>}
        <button
          className="btn small ghost"
          style={{ marginLeft: 'auto' }}
          disabled={loading || plan.tasks.some((task) => task.status === 'in_progress') || ['review', 'done'].includes(storyStatus)}
          onClick={() => void replan()}
        >
          <Icon name="refresh" size={12} />
          重规划剩余
        </button>
      </div>
      {plan.tasks.length === 0 && <div className="rail-empty">启动故事时自动生成任务计划。</div>}
      {plan.tasks.map((task) => {
        const meta = TASK_STATUS_META[task.status];
        const deps = dependencies(task);
        const isCritical = plan.criticalPath.includes(task.key);
        return (
          <div className={`task-row ${task.status}`} key={task.id}>
            <div className="task-head">
              <span className="task-key">{task.key}</span>
              <div className="task-title">
                {task.title}
                {isCritical && <span className="badge magenta" style={{ marginLeft: 8 }}>关键路径</span>}
              </div>
              <span className="badge" style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}>
                {meta.label}
              </span>
            </div>
            {task.description && <div className="task-desc">{task.description}</div>}
            <div className="task-meta">
              {deps.length > 0 && <span className="chip">前置：{deps.join('、')}</span>}
              {task.acIds.length > 0 && <span className="chip">AC：{task.acIds.join('、')}</span>}
              {task.attempts > 0 && <span className="chip">尝试：{task.attempts}</span>}
              {task.tokens > 0 && <span className="chip">{task.tokens.toLocaleString()} tokens</span>}
              {task.verifyCommand && <span className="chip">verify: {task.verifyCommand}</span>}
              {task.updatedAt && <span className="hint">{timeOf(task.updatedAt)}</span>}
            </div>
            {task.files.length > 0 && <div className="task-files">{task.files.join(' · ')}</div>}
            {task.evidence && <pre className="task-evidence">{task.evidence}</pre>}
            <div className="task-actions">
              {['failed', 'skipped'].includes(task.status) && (
                <button className="btn small" disabled={loading} onClick={() => void retry(task)}>
                  <Icon name="refresh" size={12} />
                  重试
                </button>
              )}
              {!['done', 'skipped'].includes(task.status) && (
                <button className="btn small ghost" disabled={loading} onClick={() => void skip(task)}>
                  <Icon name="x" size={12} />
                  跳过
                </button>
              )}
              {!['done', 'in_progress'].includes(task.status) && (
                <button className="btn small ghost" disabled={loading} onClick={() => startEdit(task)}>
                  <Icon name="code" size={12} />
                  编辑
                </button>
              )}
            </div>
            {editing?.id === task.id && (
              <div className="task-edit">
                <label>
                  标题
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>
                <label>
                  描述
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </label>
                <label>
                  文件（逗号分隔）
                  <input value={form.files} onChange={(e) => setForm({ ...form, files: e.target.value })} />
                </label>
                <label>
                  AC（可选：{acIds.join('、') || '无'}）
                  <input value={form.acIds} onChange={(e) => setForm({ ...form, acIds: e.target.value })} />
                </label>
                <label>
                  verify 命令
                  <input value={form.verifyCommand} onChange={(e) => setForm({ ...form, verifyCommand: e.target.value })} />
                </label>
                <div className="task-dep-edit">
                  前置任务
                  {plan.tasks.filter((item) => item.id !== task.id).map((item) => (
                    <label key={item.id} className="task-dep-option">
                      <input
                        type="checkbox"
                        checked={form.dependsOnKeys.includes(item.key)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            dependsOnKeys: e.target.checked
                              ? [...form.dependsOnKeys, item.key]
                              : form.dependsOnKeys.filter((key) => key !== item.key),
                          })
                        }
                      />
                      {item.key}
                    </label>
                  ))}
                </div>
                <div className="req-actions">
                  <button className="btn small cyan" disabled={loading} onClick={() => void saveEdit()}>
                    保存
                  </button>
                  <button className="btn small ghost" disabled={loading} onClick={() => setEditing(null)}>
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
