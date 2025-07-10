import { boolean, minLength, object, optional, pipe, string, type InferInput } from 'valibot';
import DirectToEngineChatAdapterAPI from './private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPI';
import { directToEngineChatAdapterAPIInitSchema } from './private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPIInit';
import { type ExecuteTurnInit, type HalfDuplexChatAdapterAPI } from './private/types/HalfDuplexChatAdapterAPI';
import { type Activity } from './types/Activity';
import { type Strategy } from './types/Strategy';

type ExecuteTurnFunction = (activity: Activity, init?: ExecuteTurnInit | undefined) => TurnGenerator;

const createHalfDuplexChatAdapterInitSchema = object({
  emitStartConversationEvent: optional(boolean('"emitStartConversationEvent" must be a boolean.')),
  /** @deprecated Experimental */
  experimental_resumeConversationId: optional(
    pipe(
      string('"resumeConversationId" must be of type string'),
      minLength(1, '"resumeConversationId" must not be an empty string')
    )
  ),
  locale: optional(string('"locale" must be a string.')),
  retry: directToEngineChatAdapterAPIInitSchema.entries.retry,
  telemetry: directToEngineChatAdapterAPIInitSchema.entries.telemetry
});

type CreateHalfDuplexChatAdapterInit = InferInput<typeof createHalfDuplexChatAdapterInitSchema>;

type TurnGenerator = AsyncGenerator<Activity, ExecuteTurnFunction, undefined>;

const createExecuteTurn = (
  api: HalfDuplexChatAdapterAPI,
  init: CreateHalfDuplexChatAdapterInit | undefined
): ExecuteTurnFunction => {
  let obsoleted = false;

  return (activity: Activity): TurnGenerator => {
    if (obsoleted) {
      const error = new Error('This executeTurn() function is obsoleted. Please use a new one.');

      init?.telemetry?.trackException?.(error, { handledAt: 'createHalfDuplexChatAdapter.createExecuteTurn' });

      throw error;
    }

    obsoleted = true;

    return (async function* () {
      yield* api.executeTurn(activity);

      return createExecuteTurn(api, init);
    })();
  };
};

export default function createHalfDuplexChatAdapter(
  strategy: Strategy,
  init: CreateHalfDuplexChatAdapterInit = {}
): TurnGenerator {
  return (async function* (): TurnGenerator {
    const api = new DirectToEngineChatAdapterAPI(strategy, {
      retry: init.retry,
      telemetry: init.telemetry
    });

    // TODO: Unsure if this is the best pattern for resuming a conversation.
    //       When resuming a conversation, the caller will still need to go through the first and empty round of activities
    //       After iterating the empty round, they will receive the executeTurn() function.
    if (init.experimental_resumeConversationId) {
      await api.experimental_resumeConversation({ conversationId: init.experimental_resumeConversationId });
    } else {
      yield* api.startNewConversation({
        emitStartConversationEvent: init.emitStartConversationEvent ?? true,
        locale: init.locale
      });
    }

    return createExecuteTurn(api, init);
  })();
}

export {
  createHalfDuplexChatAdapterInitSchema,
  type CreateHalfDuplexChatAdapterInit,
  type ExecuteTurnFunction,
  type TurnGenerator
};
