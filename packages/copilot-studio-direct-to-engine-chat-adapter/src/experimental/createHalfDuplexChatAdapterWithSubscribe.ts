import type { CreateHalfDuplexChatAdapterInit } from '../createHalfDuplexChatAdapter';
import DirectToEngineChatAdapterAPIWithExecuteViaSubscribe from '../private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPIWithExecuteViaSubscribe';
import { type ExecuteTurnInit, type HalfDuplexChatAdapterAPI } from '../private/types/HalfDuplexChatAdapterAPI';
import { type Activity } from '../types/Activity';
import { type Strategy } from '../types/Strategy';

type ExecuteTurnFunction = (activity: Activity | undefined, init?: ExecuteTurnInit | undefined) => TurnGenerator;

type CreateHalfDuplexChatAdapterWithSubscribeInit = CreateHalfDuplexChatAdapterInit & {
  onActivity?: (() => void) | undefined;
  signal?: AbortSignal | undefined;
};

type TurnGenerator = AsyncGenerator<Activity, ExecuteTurnFunction, undefined>;

const createExecuteTurn = (
  api: HalfDuplexChatAdapterAPI,
  init: CreateHalfDuplexChatAdapterWithSubscribeInit | undefined
): ExecuteTurnFunction => {
  let obsoleted = false;

  return (activity: Activity | undefined): TurnGenerator => {
    if (obsoleted) {
      const error = new Error('This executeTurn() function is obsoleted. Please use a new one.');

      init?.telemetry?.trackException(error, { handledAt: 'createHalfDuplexChatAdapter.createExecuteTurn' });

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
      telemetry: init.telemetry
    });

    yield* api.startNewConversation({
      emitStartConversationEvent: init.emitStartConversationEvent ?? true,
      locale: init.locale
    });

    return createExecuteTurn(api, init);
  })();
}

export type { CreateHalfDuplexChatAdapterWithSubscribeInit, ExecuteTurnFunction, TurnGenerator };
