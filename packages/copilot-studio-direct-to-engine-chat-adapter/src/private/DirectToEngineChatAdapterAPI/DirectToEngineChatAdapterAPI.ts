import { parse } from 'valibot';
import {
  type HalfDuplexChatAdapterAPI,
  type StartNewConversationInit
} from '../../private/types/HalfDuplexChatAdapterAPI';
import { type Activity } from '../../types/Activity';
import { type Strategy } from '../../types/Strategy';
import { type Telemetry } from '../../types/Telemetry';
import {
  directToEngineChatAdapterAPIInitSchema,
  type DirectToEngineChatAdapterAPIInit
} from './DirectToEngineChatAdapterAPIInit';
import APISession from './private/APISession';

export class DirectToEngineChatAdapterAPIImpl implements HalfDuplexChatAdapterAPI {
  constructor(strategy: Strategy, telemetry: Telemetry, session: APISession) {
    this.#session = session;
    this.#strategy = strategy;
    this.#telemetry = telemetry;
  }

  #busy: boolean = false;
  #session: APISession;
  #strategy: Strategy;
  #telemetry: Telemetry | undefined;

  public startNewConversation({
    emitStartConversationEvent,
    locale
  }: StartNewConversationInit): AsyncIterableIterator<Activity> {
    if (this.#busy) {
      const error = new Error('Another operation is in progress.');

      this.#telemetry?.trackException(error, { handledAt: 'DirectToEngineChatAdapterAPI.startNewConversation' });

      throw error;
    }

    this.#busy = true;

    return async function* (this: DirectToEngineChatAdapterAPI) {
      try {
        if (this.#session.conversationId) {
          const error = new Error('startNewConversation() cannot be called more than once.');

          this.#telemetry?.trackException(error, { handledAt: 'DirectToEngineChatAdapterAPI.startNewConversation' });

          throw error;
        }

        const { baseURL, body, headers, transport } = await this.#strategy.prepareStartNewConversation();

        yield* this.#session.post(baseURL, {
          body,
          headers,
          initialBody: { emitStartConversationEvent, locale },
          transport
        });
      } finally {
        this.#busy = false;
      }
    }.call(this);
  }

  public executeTurn(activity: Activity): AsyncIterableIterator<Activity> {
    if (this.#busy) {
      const error = new Error('Another operation is in progress.');

      this.#telemetry?.trackException(error, { handledAt: 'DirectToEngineChatAdapterAPI.executeTurn' });

      throw error;
    }

    this.#busy = true;

    return async function* (this: DirectToEngineChatAdapterAPI) {
      try {
        if (!this.#session.conversationId) {
          const error = new Error(`startNewConversation() must be called before executeTurn().`);

          this.#telemetry?.trackException(error, { handledAt: 'DirectToEngineChatAdapterAPI.executeTurn' });

          throw error;
        }

        const { baseURL, body, headers, transport } = await this.#strategy.prepareExecuteTurn();

        yield* this.#session.post(baseURL, {
          body,
          headers,
          initialBody: { activity },
          transport
        });
      } finally {
        this.#busy = false;
      }
    }.call(this);
  }
}

// NOTES: This class must work over RPC and cross-domain:
//        - If need to extends this class, only add async methods (which return Promise)
//        - Do not add any non-async methods or properties
//        - Do not pass any arguments that is not able to be cloned by the Structured Clone Algorithm
//        - After modifying this class, always test with a C1-hosted PVA Anywhere Bot
export default class DirectToEngineChatAdapterAPI extends DirectToEngineChatAdapterAPIImpl {
  constructor(strategy: Strategy, init?: DirectToEngineChatAdapterAPIInit) {
    const { retry, signal, telemetry } = parse(directToEngineChatAdapterAPIInitSchema, init);

    super(strategy, telemetry, new APISession({ retry, signal, telemetry }));
  }
}
