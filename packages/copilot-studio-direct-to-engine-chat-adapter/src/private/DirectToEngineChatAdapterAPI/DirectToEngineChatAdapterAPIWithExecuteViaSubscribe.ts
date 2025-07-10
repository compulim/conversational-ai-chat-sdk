import { parse } from 'valibot';
import isAbortError from '../../private/isAbortError';
import {
  type ExperimentalResumeConversationInit,
  type StartNewConversationInit
} from '../../private/types/HalfDuplexChatAdapterAPI';
import { type Activity } from '../../types/Activity';
import { type Strategy } from '../../types/Strategy';
import { type Telemetry } from '../../types/Telemetry';
import { DirectToEngineChatAdapterAPIImpl } from './DirectToEngineChatAdapterAPI';
import directToEngineChatAdapterAPIWithExecuteViaSubscribeInitSchema, {
  type DirectToEngineChatAdapterAPIWithExecuteViaSubscribeInit
} from './DirectToEngineChatAdapterAPIWithExecuteViaSubscribeInit';
import APISession from './private/APISession';
import QueueWithAvailable from './private/QueueWithAvailable';

type StrategySupportExperimentalSubscribeActivities = Strategy & {
  experimental_prepareSubscribeActivities: Exclude<Strategy['experimental_prepareSubscribeActivities'], undefined>;
};

const ACTIVITY_AVAILABLE = Symbol('activity available');
const EXECUTE_FINISHED = Symbol('execute finished');
const MAX_ACTIVITY_PER_TURN = 1_000;

async function iterate<T>(iterable: AsyncIterableIterator<T>, onIterate: (value: T) => void): Promise<void> {
  for await (const value of iterable) {
    onIterate(value);
  }
}

export default class DirectToEngineChatAdapterAPIWithExecuteViaSubscribe extends DirectToEngineChatAdapterAPIImpl {
  constructor(
    strategy: StrategySupportExperimentalSubscribeActivities,
    init?: DirectToEngineChatAdapterAPIWithExecuteViaSubscribeInit
  ) {
    const { onActivity, retry, signal, telemetry, subscribeSilenceTimeout } = parse(
      directToEngineChatAdapterAPIWithExecuteViaSubscribeInitSchema,
      init
    );

    if (!strategy.experimental_prepareSubscribeActivities) {
      const error = new Error(`This strategy does not support subscribe activities.`);

      telemetry?.trackException?.(error, {
        handledAt: 'DirectToEngineChatAdapterAPIWithExecuteViaSubscribe.constructor'
      });

      throw error;
    }

    const session = new APISession({ retry, signal, telemetry });

    super(strategy, telemetry, session);

    this.#onActivity = onActivity;
    this.#session = session;
    this.#strategy = strategy;
    this.#telemetry = telemetry;
    this.#subscribeSilenceTimeout = subscribeSilenceTimeout;
  }

  #onActivity: (() => void) | undefined;
  #session: APISession;
  #strategy: StrategySupportExperimentalSubscribeActivities;
  #subscribingQueue: QueueWithAvailable<Activity> = new QueueWithAvailable<Activity>();
  #telemetry: Telemetry | undefined;
  #subscribeSilenceTimeout: number;

  async #startSubscribe() {
    try {
      // We cannot use `new EventSource()` because we need to send headers.
      const iterator = this.#session.post({
        ...(await this.#strategy.experimental_prepareSubscribeActivities!()),
        subPath: 'subscribe',
        transport: 'auto' // Force SSE as it only works over SSE.
      });

      for await (const activity of iterator) {
        this.#subscribingQueue.enqueue(activity);
        this.#onActivity?.();
      }
    } catch (error) {
      // Abort may cause fetch() to throw.
      if (!isAbortError(error)) {
        this.#telemetry?.trackException?.(error, {
          handledAt: 'DirectToEngineChatAdapterAPI.experimental_subscribeActivities'
        });

        this.#subscribingQueue.error(error);
      }
    }
  }

  public startNewConversation(init: StartNewConversationInit): AsyncIterableIterator<Activity> {
    const superStartNewConversation = super.startNewConversation.bind(this);

    return async function* (this: DirectToEngineChatAdapterAPIWithExecuteViaSubscribe) {
      const iterator = superStartNewConversation(init);

      for await (const activity of iterator) {
        yield activity;
      }

      // After first startNewConversation() is done, start the subscribe.
      this.#startSubscribe();
    }.call(this);
  }

  /** @deprecated Experimental */
  public async experimental_resumeConversation(init: ExperimentalResumeConversationInit): Promise<void> {
    await super.experimental_resumeConversation(init);

    this.#startSubscribe();
  }

  public executeTurn(activity?: Activity | undefined): AsyncIterableIterator<Activity> {
    const executeTurn_ = super.executeTurn.bind(this);

    return async function* (this: DirectToEngineChatAdapterAPIWithExecuteViaSubscribe) {
      try {
        const unblockResolvers = Promise.withResolvers<void>();

        const executePromise = activity
          ? iterate(executeTurn_(activity), () => unblockResolvers.resolve())
          : Promise.resolve();

        await Promise.race([executePromise, unblockResolvers.promise]);

        for (let index = 0; index < MAX_ACTIVITY_PER_TURN; index++) {
          const nextActivity = this.#subscribingQueue.shift();

          if (nextActivity) {
            yield nextActivity;

            continue;
          }

          const result = await Promise.race([
            // Execute will finish after 1 second of silence from /subscribe, regardless of next() is called or not.
            // For simplicity, we only do the 1 second silence countdown on the call to next().
            executePromise
              .then(() => new Promise(resolve => setTimeout(resolve, this.#subscribeSilenceTimeout)))
              .then(() => EXECUTE_FINISHED),
            this.#subscribingQueue.available().then(() => ACTIVITY_AVAILABLE)
          ]);

          if (result === EXECUTE_FINISHED) {
            break;
          }
        }
      } catch (error) {
        // Network error in /subscribe, we will throw this.
        this.#telemetry?.trackException?.(error, {
          handledAt: 'DirectToEngineChatAdapterAPIWithExecuteViaSubscribe.executeTurn'
        });

        throw error;
      }
    }.call(this);
  }
}
