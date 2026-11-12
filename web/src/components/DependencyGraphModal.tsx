import { useEffect, useMemo, useState } from 'react';
import type {
  Category,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  RequirementStatus,
} from '@riccon-scrum/shared';
import { api } from '../api';
import { Icon } from '../icons';
import { categoryName, CategoryFilter } from './CategoryPicker';

const REQ_COLOR: Record<RequirementStatus, string> = {
  intake: 'var(--text-low)',
  clarifying: 'var(--amber)',
  drafting: 'var(--cyan)',
  in_review: 'var(--amber)',
  revising: 'var(--cyan)',
  approved: 'var(--green)',
  decomposed: 'var(--green)',
  split: 'var(--indigo-bright)',
  blocked: 'var(--red)',
  archived: 'var(--text-low)',
};

const STORY_COLOR: Record<string, string> = {
  draft: 'var(--text-low)',
  ready: 'var(--cyan)',
  in_dev: 'var(--indigo-bright)',
  review: 'var(--amber)',
  done: 'var(--green)',
  blocked: 'var(--red)',
};

const NODE_W = 230;
const NODE_H = 64;
const GAP_X = 90;
const GAP_Y = 28;
const MARGIN = 36;

interface Positioned {
  node: DependencyGraphNode;
  x: number;
  y: number;
}

function layout(nodes: DependencyGraphNode[], graph: DependencyGraph): { positioned: Positioned[]; width: number; height: number } {
  const ids = new Set(nodes.map((node) => node.id));
  const deps = graph.edges.filter((edge) => edge.kind === 'dependency' && ids.has(edge.from) && ids.has(edge.to));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of deps) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }
  const layer = new Map<string, number>();
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  for (const id of queue) layer.set(id, 0);
  let cursor = 0;
  while (cursor < queue.length) {
    const id = queue[cursor++];
    const nextLayer = (layer.get(id) ?? 0) + 1;
    for (const next of outgoing.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, nextLayer));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  const cyclic = nodes.filter((node) => !layer.has(node.id));
  for (const node of cyclic) layer.set(node.id, Math.max(0, ...layer.values()) + 1);

  const byLayer = new Map<number, DependencyGraphNode[]>();
  for (const node of nodes) {
    const l = layer.get(node.id) ?? 0;
    const list = byLayer.get(l) ?? [];
    list.push(node);
    byLayer.set(l, list);
  }
  const positioned: Positioned[] = [];
  let maxRows = 1;
  for (const [l, list] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.title.localeCompare(b.title));
    maxRows = Math.max(maxRows, list.length);
    list.forEach((node, index) => {
      positioned.push({
        node,
        x: MARGIN + l * (NODE_W + GAP_X),
        y: MARGIN + index * (NODE_H + GAP_Y),
      });
    });
  }
  const maxLayer = Math.max(0, ...layer.values());
  return {
    positioned,
    width: MARGIN * 2 + maxLayer * (NODE_W + GAP_X) + NODE_W,
    height: MARGIN * 2 + Math.max(0, maxRows - 1) * (NODE_H + GAP_Y) + NODE_H,
  };
}

export function DependencyGraphModal({
  projectId,
  kind,
  onClose,
  onSelect,
}: {
  projectId: string;
  kind: 'requirement' | 'story';
  onClose: () => void;
  onSelect?: (node: DependencyGraphNode) => void;
}) {
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [topOnly, setTopOnly] = useState(false);
  const [showCritical, setShowCritical] = useState(true);
  const [activityView, setActivityView] = useState(false);

  const load = () => {
    api
      .graph(projectId, kind)
      .then(setGraph)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    load();
    api.categories(projectId).then(setCategories).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, kind]);

  const nodes = useMemo(() => {
    let list = graph?.nodes ?? [];
    if (categoryId) {
      const selected = categories.find((category) => category.id === categoryId);
      const scope = selected
        ? new Set(categories.filter((category) => category.path.startsWith(selected.path)).map((category) => category.id))
        : new Set([categoryId]);
      list = list.filter((node) => node.categoryId && scope.has(node.categoryId));
    }
    if (kind === 'requirement' && topOnly) list = list.filter((node) => !node.parentId);
    return list;
  }, [graph, categoryId, categories, kind, topOnly]);

  const activityModel = useMemo(() => {
    if (!graph || kind !== 'story' || !activityView) {
      return { nodes, edges: graph?.edges ?? [] };
    }
    const nodeIds = new Set(nodes.map((node) => node.id));
    const dependencies = graph.edges.filter(
      (edge) => edge.kind === 'dependency' && nodeIds.has(edge.from) && nodeIds.has(edge.to),
    );
    const incoming = new Set(dependencies.map((edge) => edge.to));
    const outgoing = new Set(dependencies.map((edge) => edge.from));
    const start: DependencyGraphNode = {
      id: '__start__',
      type: 'story',
      title: '开始',
      status: 'start',
      categoryId: null,
      parentId: null,
      depth: 0,
      blockedBy: [],
    };
    const end: DependencyGraphNode = {
      id: '__end__',
      type: 'story',
      title: '结束',
      status: 'end',
      categoryId: null,
      parentId: null,
      depth: 0,
      blockedBy: [],
    };
    const syntheticEdges: DependencyGraphEdge[] = [
      ...nodes.filter((node) => !incoming.has(node.id)).map((node) => ({ from: start.id, to: node.id, kind: 'dependency' as const })),
      ...nodes.filter((node) => !outgoing.has(node.id)).map((node) => ({ from: node.id, to: end.id, kind: 'dependency' as const })),
    ];
    return { nodes: [start, ...nodes, end], edges: [...graph.edges, ...syntheticEdges] };
  }, [graph, kind, activityView, nodes]);

  const view = useMemo(() => {
    if (!graph) return null;
    return layout(activityModel.nodes, { ...graph, edges: activityModel.edges });
  }, [graph, activityModel]);

  const positions = useMemo(() => new Map((view?.positioned ?? []).map((item) => [item.node.id, item])), [view]);
  const dependencyEdges = activityModel.edges.filter(
    (edge) => edge.kind === 'dependency' && positions.has(edge.from) && positions.has(edge.to),
  );
  const containmentEdges = activityModel.edges.filter(
    (edge) => edge.kind === 'containment' && positions.has(edge.from) && positions.has(edge.to),
  );

  const critical = useMemo(() => {
    const nodeIds = nodes.map((node) => node.id);
    const inDegree = new Map(nodeIds.map((id) => [id, 0]));
    const outgoing = new Map<string, string[]>();
    for (const edge of dependencyEdges) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      const list = outgoing.get(edge.from) ?? [];
      list.push(edge.to);
      outgoing.set(edge.from, list);
    }
    const distance = new Map(nodeIds.map((id) => [id, 1]));
    const previous = new Map<string, string>();
    const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      for (const next of outgoing.get(id) ?? []) {
        if ((distance.get(id) ?? 1) + 1 > (distance.get(next) ?? 1)) {
          distance.set(next, (distance.get(id) ?? 1) + 1);
          previous.set(next, id);
        }
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
        if ((inDegree.get(next) ?? 0) === 0) queue.push(next);
      }
    }
    if (distance.size === 0) return { nodes: new Set<string>(), edges: new Set<string>() };
    const end = [...distance.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const path: string[] = [];
    let cursor: string | undefined = end;
    while (cursor) {
      path.unshift(cursor);
      cursor = previous.get(cursor);
    }
    if (path.length < 2) return { nodes: new Set<string>(), edges: new Set<string>() };
    const pathNodes = new Set(path);
    const pathEdges = new Set(path.slice(1).map((id, index) => `${path[index]}|${id}`));
    return { nodes: pathNodes, edges: pathEdges };
  }, [activityModel.nodes, dependencyEdges]);

  const exportMermaid = () => {
    const ids = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
    const lines = ['flowchart LR'];
    for (const node of nodes) {
      const id = ids.get(node.id);
      const title = node.title.replace(/"/g, "'").replace(/\n/g, ' ');
      lines.push(`  ${id}["${title}<br/>${node.status}"]`);
    }
    for (const edge of graph?.edges ?? []) {
      const from = ids.get(edge.from);
      const to = ids.get(edge.to);
      if (!from || !to) continue;
      lines.push(edge.kind === 'containment' ? `  ${from} -.-> ${to}` : `  ${from} --> ${to}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${kind === 'requirement' ? 'requirements' : 'stories'}-dependencies.mmd`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-wide graph-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="依赖关系图">
        <div className="modal-head">
          <Icon name="layers" size={18} style={{ color: 'var(--cyan)', marginRight: 10 }} />
          <h3>{kind === 'requirement' ? '需求依赖图' : '故事依赖图'}</h3>
          <span className="badge cyan">{nodes.length} 个节点</span>
          <button className="btn icon ghost" onClick={onClose} aria-label="关闭" style={{ marginLeft: 'auto' }}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="graph-toolbar">
            <CategoryFilter categories={categories} value={categoryId} onChange={setCategoryId} />
            {kind === 'requirement' && (
              <label className="graph-toggle">
                <input type="checkbox" checked={topOnly} onChange={(e) => setTopOnly(e.target.checked)} />
                仅显示顶层需求
              </label>
            )}
            {kind === 'story' && (
              <label className="graph-toggle">
                <input type="checkbox" checked={activityView} onChange={(e) => setActivityView(e.target.checked)} />
                活动图（含开始/结束）
              </label>
            )}
            <label className="graph-toggle">
              <input type="checkbox" checked={showCritical} onChange={(e) => setShowCritical(e.target.checked)} />
              高亮关键路径
            </label>
            <span className="spacer" />
            <button className="btn small ghost" onClick={exportMermaid}>
              <Icon name="code" size={12} />
              导出 Mermaid
            </button>
            <button className="btn small ghost" onClick={load}>
              <Icon name="refresh" size={12} />
              刷新
            </button>
          </div>
          {error && <div className="req-note warn">{error}</div>}
          {!graph && !error && <div className="rail-empty">加载中…</div>}
          {graph && graph.cycles.length > 0 && (
            <div className="req-note warn">检测到依赖循环：{graph.cycles.map((cycle) => cycle.join(' → ')).join('；')}</div>
          )}
          {view && nodes.length === 0 && <div className="rail-empty">当前筛选下没有节点。</div>}
          {view && nodes.length > 0 && (
            <div className="graph-scroll">
              <svg width={view.width} height={view.height} role="img" aria-label="依赖关系图">
                <defs>
                  <marker id="dep-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L0,6 L9,3 z" fill="var(--cyan)" />
                  </marker>
                </defs>
                {containmentEdges.map((edge) => {
                  const from = positions.get(edge.from);
                  const to = positions.get(edge.to);
                  if (!from || !to) return null;
                  return (
                    <path
                      key={`c-${edge.from}-${edge.to}`}
                      className="graph-edge containment"
                      d={`M ${from.x + NODE_W / 2} ${from.y + NODE_H} C ${from.x + NODE_W / 2} ${from.y + NODE_H + 24}, ${to.x + NODE_W / 2} ${to.y - 24}, ${to.x + NODE_W / 2} ${to.y}`}
                    />
                  );
                })}
                {dependencyEdges.map((edge) => {
                  const from = positions.get(edge.from);
                  const to = positions.get(edge.to);
                  if (!from || !to) return null;
                  const sx = edge.from === '__start__' ? from.x + NODE_W / 2 + 22 : from.x + NODE_W;
                  const sy = from.y + NODE_H / 2;
                  const tx = edge.to === '__end__' ? to.x + NODE_W / 2 - 22 : to.x;
                  const ty = to.y + NODE_H / 2;
                  const curve = Math.max(40, Math.abs(tx - sx) / 2);
                  return (
                    <path
                      key={`d-${edge.from}-${edge.to}`}
                      className={`graph-edge ${showCritical && critical.edges.has(`${edge.from}|${edge.to}`) ? 'critical' : ''}`}
                      markerEnd="url(#dep-arrow)"
                      d={`M ${sx} ${sy} C ${sx + curve} ${sy}, ${tx - curve} ${ty}, ${tx} ${ty}`}
                    />
                  );
                })}
                {(view.positioned ?? []).map(({ node, x, y }) => {
                  if (node.id === '__start__' || node.id === '__end__') {
                    return (
                      <g key={node.id} transform={`translate(${x + NODE_W / 2}, ${y + NODE_H / 2})`}>
                        <circle r={22} className="activity-terminal" />
                        <text y={4} textAnchor="middle" className="activity-terminal-label">
                          {node.title}
                        </text>
                      </g>
                    );
                  }
                  const color = node.type === 'requirement' ? REQ_COLOR[node.status as RequirementStatus] ?? 'var(--text-low)' : STORY_COLOR[node.status] ?? 'var(--text-low)';
                  const blocked = node.blockedBy.length > 0;
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${x}, ${y})`}
                      onClick={() => onSelect?.(node)}
                      style={{ cursor: onSelect ? 'pointer' : 'default' }}
                    >
                      <foreignObject width={NODE_W} height={NODE_H}>
                        <div
                          className={`graph-node ${blocked ? 'blocked' : ''} ${showCritical && critical.nodes.has(node.id) ? 'critical' : ''} ${activityView ? 'activity' : ''}`}
                          style={{ ['--node-color' as string]: color }}
                        >
                          <div className="graph-node-title">{node.title}</div>
                          <div className="graph-node-meta">
                            <span>{node.status}</span>
                            <span>{categoryName(categories, node.categoryId)}</span>
                            {blocked && <span className="graph-node-blocked">等待前置</span>}
                          </div>
                        </div>
                      </foreignObject>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
          <div className="graph-legend">
            <span><i style={{ background: 'var(--cyan)' }} />依赖（前置 → 后续）</span>
            <span><i className="dashed" />包含（父需求 → 子需求）</span>
            <span><i style={{ background: 'var(--red)' }} />等待前置</span>
            <span><i style={{ background: 'var(--amber)' }} />关键路径</span>
          </div>
        </div>
        <div className="modal-foot">
          <span className="hint" style={{ marginRight: 'auto', fontSize: 11.5, color: 'var(--text-low)' }}>
            依赖为 DAG；循环依赖会被门禁拒绝。
          </span>
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
