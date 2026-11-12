import { EventEmitter } from 'node:events';
import type { EventPayload, EventRow } from '@riccon-scrum/shared';
import { appendEvent } from './db';

class EventBus extends EventEmitter {
  publish(storyId: string, payload: EventPayload): EventRow {
    const row = appendEvent(storyId, payload);
    this.emit('event', row);
    return row;
  }
}

export const bus = new EventBus();
bus.setMaxListeners(100);