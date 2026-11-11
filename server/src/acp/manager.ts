import type * as acp from '@agentclientprotocol/sdk';
import type { AgentRole, AgentSession, EventPayload } from '@acp-scrum/shared';
import { bus } from '../bus';
import { addStoryFiles, createApproval, createSession, decideApproval, getSession, getTeamRun, updateSession, updateTeamRun } from '../db';
import { config } from '../config';
import { AcpRunner, type RunnerHost } from './runner';
import { getAgentSpec } from './agents';

interface DecisionWaiter {
  resolve: (d: { status: 'approved' | 'denied'; optionId?: string }) => void;
}

class AcpManager implements RunnerHost {
  private runners = new Map<string, AcpRunner>();
  private waiters = new Map<string, DecisionWaiter>();

  publish(storyId: string, payload: EventPayload): void {
    if (payload.type === 'usage' && getTeamRun(storyId)) {
      updateTeamRun(storyId, { tokens: payload.tokens });
    }
    if (payload.type === 'agent.tool' && payload.locations.length > 0) {
      addStoryFiles(storyId, payload.locations);
    }
    bus.publish(storyId, payload);
  }

  requestPermission(
    storyId: string,
    sessionId: string,
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const approval = createApproval({
      storyId,
      sessionId,
      kind: 'permission',
      title: params.toolCall.title ?? '工具执行授权',
      requestJson: JSON.stringify(params),
    });
    bus.publish(storyId, { type: 'approval.requested', approval });
    return new Promise((resolve) => {
      this.waiters.set(approval.id, {
        resolve: (d) =>
          resolve(
            d.status === 'approved' && d.optionId
              ? { outcome: { outcome: 'selected', optionId: d.optionId } }
              : { outcome: { outcome: 'cancelled' } },
          ),
      });
    });
  }

  requestDecision(
    storyId: string,
    kind: 'conflict' | 'plan',
    title: string,
    requestJson: string,
  ): Promise<{ status: 'approved' | 'denied'; optionId?: string }> {
    const approval = createApproval({ storyId, kind, title, requestJson });
    bus.publish(storyId, { type: 'approval.requested', approval });
    return new Promise((resolve) => {
      this.waiters.set(approval.id, { resolve });
    });
  }

  resolvePermission(approvalId: string, decision: { status: 'approved' | 'denied'; optionId?: string }) {
    const approval = decideApproval(approvalId, { ...decision, decidedBy: 'human' });
    bus.publish(approval.storyId, { type: 'approval.decided', approval });
    const waiter = this.waiters.get(approvalId);
    if (waiter) {
      this.waiters.delete(approvalId);
      waiter.resolve(decision);
    }
    return approval;
  }

  async startRunner(
    storyId: string,
    cwd: string,
    allowedRoots: string[],
    agentKind = 'opencode',
    role: AgentRole = 'solo',
    resumeSessionId?: string,
  ): Promise<AgentSession> {
    const session = createSession(storyId, agentKind, role);
    const spec = getAgentSpec(agentKind, { model: config.agentModel, dbPath: config.opencodeDb });
    const runner = new AcpRunner({
      storyId,
      sessionId: session.id,
      cwd,
      spec,
      host: this,
      allowedRoots,
    });
    this.runners.set(session.id, runner);
    try {
      await runner.start(resumeSessionId);
      updateSession(session.id, { pid: runner.pid ?? undefined, acpSessionId: runner.sessionId ?? undefined, status: 'running' });
    } catch (err) {
      updateSession(session.id, { status: 'error' });
      bus.publish(storyId, {
        type: 'session.status',
        sessionId: session.id,
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
      this.runners.delete(session.id);
      throw err;
    }
    return session;
  }

  async prompt(sessionId: string, text: string): Promise<{ reason: acp.StopReason; text: string }> {
    const runner = this.runners.get(sessionId);
    if (!runner) throw new Error(`no active runner: ${sessionId}`);
    updateSession(sessionId, { status: 'running' });
    const reason = await runner.prompt(text);
    updateSession(sessionId, { status: 'idle' });
    const storyId = getSession(sessionId).storyId;
    if (getTeamRun(storyId)) updateTeamRun(storyId, { addTurns: 1 });
    return { reason, text: runner.responseText };
  }

  async stopRunner(sessionId: string): Promise<void> {
    const runner = this.runners.get(sessionId);
    if (!runner) return;
    await runner.stop();
    this.runners.delete(sessionId);
    updateSession(sessionId, { status: 'stopped' });
  }

  async stopStoryRunners(storyId: string, sessions: AgentSession[]): Promise<void> {
    for (const s of sessions) {
      if (this.runners.has(s.id)) await this.stopRunner(s.id);
    }
  }

  hasRunner(sessionId: string): boolean {
    return this.runners.has(sessionId);
  }
}

export const manager = new AcpManager();