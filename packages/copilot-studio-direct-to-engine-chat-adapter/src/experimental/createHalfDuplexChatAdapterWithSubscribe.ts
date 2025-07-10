import {
  function_,
  instance,
  maxValue,
  minValue,
  number,
  object,
  optional,
  pipe,
  transform,
  type InferInput
} from 'valibot';
import { createHalfDuplexChatAdapterInitSchema } from '../createHalfDuplexChatAdapter';
import DirectToEngineChatAdapterAPIWithExecuteViaSubscribe from '../private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPIWithExecuteViaSubscribe';
import { type ExecuteTurnInit, type HalfDuplexChatAdapterAPI } from '../private/types/HalfDuplexChatAdapterAPI';
import { type Activity } from '../types/Activity';
import { type Strategy } from '../types/Strategy';

type ExecuteTurnFunction = (activity: Activity | undefined, init?: ExecuteTurnInit | undefined) => TurnGenerator;

const createHalfDuplexChatAdapterWithSubscribeInitSchema = object({
  ...createHalfDuplexChatAdapterInitSchema.entries,
  onActivity: optional(
    pipe(
      function_('"onActivity" must be a function'),
      transform(value => value as () => void)
    )
  ),
  signal: optional(instance(AbortSignal, '"signal" must be of type AbortSignal')),
  subscribeSilenceTimeout: optional(
    pipe(
      number('"subscribeSilenceTimeout" must be a number'),
      maxValue(60_000, '"subscribeSilenceTimeout" must be equal to or less than 60_000'),
      minValue(0, '"subscribeSilenceTimeout" must be equal to or greater than 0')
    )
  )
});

type CreateHalfDuplexChatAdapterWithSubscribeInit = InferInput<
  typeof createHalfDuplexChatAdapterWithSubscribeInitSchema
>;

type TurnGenerator = AsyncGenerator<Activity, ExecuteTurnFunction, undefined>;

const createExecuteTurn = (
  api: HalfDuplexChatAdapterAPI,
  init: CreateHalfDuplexChatAdapterWithSubscribeInit | undefined
): ExecuteTurnFunction => {
  let obsoleted = false;

  return (activity: Activity | undefined): TurnGenerator => {
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
  strategy: Strategy & {
    experimental_prepareSubscribeActivities: Exclude<Strategy['experimental_prepareSubscribeActivities'], undefined>;
  },
  init: CreateHalfDuplexChatAdapterWithSubscribeInit = {}
): TurnGenerator {
  return (async function* (): TurnGenerator {
    const api = new DirectToEngineChatAdapterAPIWithExecuteViaSubscribe(strategy, {
      onActivity: init.onActivity,
      retry: init.retry,
      signal: init.signal,
      subscribeSilenceTimeout: init.subscribeSilenceTimeout,
      telemetry: init.telemetry
    });

    // TODO: Unsure if this is the best pattern for resuming a conversation.
    //       When resuming a conversation, the caller will still need to go through the first and empty round of activities
    //       After iterating the empty round, they will receive the executeTurn() function.
    if (init.experimental_resumeConversationId) {
      await api.experimental_resumeConversation({
        conversationId: init.experimental_resumeConversationId,
        correlationId: init.telemetry?.correlationId
      });
    } else {
      yield* api.startNewConversation({
        emitStartConversationEvent: init.emitStartConversationEvent ?? true,
        locale: init.locale
      });
    }

    return createExecuteTurn(api, init);
  })();
}

export { type CreateHalfDuplexChatAdapterWithSubscribeInit, type ExecuteTurnFunction, type TurnGenerator };
