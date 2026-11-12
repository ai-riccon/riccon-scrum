import type * as acp from '@agentclientprotocol/sdk';
import { bus } from '../bus';
import type { EventPayload } from '@riccon-scrum/shared';
import type { RunnerHost } from './runner';

export function readOnlyHost(streamId: string): RunnerHost {
  return {
    publish: (storyId: string, payload: EventPayload) => {
      if (storyId !== streamId) return;
      if (payload.type !== 'session.status') return;
      bus.publish(streamId, payload);
    },
    requestPermission: async (
      _storyId: string,
      _sessionId: string,
      params: acp.RequestPermissionRequest,
    ): Promise<acp.RequestPermissionResponse> => {
      const kind = params.toolCall.kind ?? null;
      const allow = params.options.find((o) => o.kind === 'allow_once') ?? params.options.find((o) => o.kind.startsWith('allow'));
      if (allow && (kind === 'read' || kind === 'search')) {
        return { outcome: { outcome: 'selected', optionId: allow.optionId } };
      }
      return { outcome: { outcome: 'cancelled' } };
    },
  };
}
