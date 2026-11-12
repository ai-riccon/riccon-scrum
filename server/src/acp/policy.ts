import type * as acp from '@agentclientprotocol/sdk';

export interface AutoApprovePolicy {
  reads: boolean;
  commands: string[];
}

// Only read/search tools and whitelisted command prefixes are auto-approved.
// Writes, deletes, moves, fetches and anything else always require a human.
export function shouldAutoApprove(params: acp.RequestPermissionRequest, policy: AutoApprovePolicy): acp.PermissionOption | null {
  const allow =
    params.options.find((o) => o.kind === 'allow_once') ?? params.options.find((o) => o.kind.startsWith('allow')) ?? null;
  if (!allow) return null;
  const kind = params.toolCall.kind ?? null;
  if (policy.reads && (kind === 'read' || kind === 'search')) return allow;
  if (kind === 'execute') {
    const title = (params.toolCall.title ?? '').trim();
    const hit = policy.commands
      .map((c) => c.trim())
      .filter(Boolean)
      .some((cmd) => title.startsWith(cmd));
    if (hit) return allow;
  }
  return null;
}
