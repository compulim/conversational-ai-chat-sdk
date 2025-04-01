import { type Activity } from '../../types/Activity';

export type StartNewConversationInit = {
  correlationId?: string | undefined;
  emitStartConversationEvent: boolean;
  locale?: string | undefined;
};

export type ExecuteTurnInit = {
  correlationId?: string | undefined;
};

export interface HalfDuplexChatAdapterAPI {
  startNewConversation(init: StartNewConversationInit): AsyncIterableIterator<Activity>;
  executeTurn(activity?: Activity | undefined): AsyncIterableIterator<Activity>;
}
