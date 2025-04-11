import DirectToEngineChatAdapterAPI from './private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPI';
import { type ExecuteTurnInit, type HalfDuplexChatAdapterAPI } from './private/types/HalfDuplexChatAdapterAPI';
import { type Activity } from './types/Activity';
import { type Strategy } from './types/Strategy';
import { type Telemetry } from './types/Telemetry';

type ExecuteTurnFunction = (activity: Activity, init?: ExecuteTurnInit | undefined) => TurnGenerator;

type CreateHalfDuplexChatAdapterInit = {
  emitStartConversationEvent?: boolean | undefined;
  locale?: string | undefined;
  retry?:
    | Readonly<{
        factor?: number | undefined;
        minTimeout?: number | undefined;
        maxTimeout?: number | undefined;
        randomize?: boolean | undefined;
        retries?: number | undefined;
      }>
    | undefined;
  telemetry?: Telemetry | undefined;
};

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

    yield* api.startNewConversation({
      emitStartConversationEvent: init.emitStartConversationEvent ?? true,
      locale: init.locale
    });

    return createExecuteTurn(api, init);
  })();
}

export type { CreateHalfDuplexChatAdapterInit, ExecuteTurnFunction, TurnGenerator };
