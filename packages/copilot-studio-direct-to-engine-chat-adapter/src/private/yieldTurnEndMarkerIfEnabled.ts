import { v4 } from 'uuid';
import { type Activity } from '../types/Activity';
import { type ActivityId } from '../types/DirectLineJSBotConnection';
import { type Strategy } from '../types/Strategy';

export default async function* yieldTurnEndMarkerIfEnabled(strategy: Strategy): AsyncGenerator<Activity> {
  if (strategy.emitTurnEndMarker) {
    yield {
      channelData: { isTurnEndMarker: true },
      from: { id: 'bot', role: 'bot' },
      id: v4() as ActivityId,
      name: 'copilot-studio:turn-end',
      type: 'event',
      value: undefined
    } as Activity;
  }
}
