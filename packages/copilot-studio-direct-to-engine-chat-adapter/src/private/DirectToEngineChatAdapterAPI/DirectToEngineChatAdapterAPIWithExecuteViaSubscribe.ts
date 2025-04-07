import { readableStreamValuesWithSignal } from 'iter-fest';
import { function_, object, optional, parse, pipe, transform, type InferInput } from 'valibot';
import isAbortError from '../../private/isAbortError';
import { type StartNewConversationInit } from '../../private/types/HalfDuplexChatAdapterAPI';
import { type Activity } from '../../types/Activity';
import { type Strategy } from '../../types/Strategy';
import { type Telemetry } from '../../types/Telemetry';
import { DirectToEngineChatAdapterAPIImpl } from './DirectToEngineChatAdapterAPI';
import { directToEngineChatAdapterAPIInitSchema } from './DirectToEngineChatAdapterAPIInit';
import APISession from './private/APISession';
import asyncIteratorWithDrain from './private/asyncIteratorWithDrain';

type StrategySupportExperimentalSubscribeActivities = Strategy & {
  experimental_prepareSubscribeActivities: Exclude<Strategy['experimental_prepareSubscribeActivities'], undefined>;
};

const directToEngineChatAdapterAPIWithExecuteViaSubscribeInitSchema = object({
  ...directToEngineChatAdapterAPIInitSchema.entries,
  onActivity: optional(
    pipe(
      function_(),
      transform(value => value as () => void)
    )
  )
});

type DirectToEngineChatAdapterAPIWithExecuteViaSubscribeInit = InferInput<
  typeof directToEngineChatAdapterAPIWithExecuteViaSubscribeInitSchema
>;

export default class DirectToEngineChatAdapterAPIWithExecuteViaSubscribe extends DirectToEngineChatAdapterAPIImpl {
  constructor(
    strategy: StrategySupportExperimentalSubscribeActivities,
    init?: DirectToEngineChatAdapterAPIWithExecuteViaSubscribeInit
  ) {
    const { onActivity, retry, signal, telemetry } = parse(
      directToEngineChatAdapterAPIWithExecuteViaSubscribeInitSchema,
      init
    );

    if (!strategy.experimental_prepareSubscribeActivities) {
      const error = new Error(`This strategy does not support subscribe activities.`);

      telemetry?.trackException(error, {
        handledAt: 'DirectToEngineChatAdapterAPIWithExecuteViaSubscribe.constructor'
      });

      throw error;
    }

    const session = new APISession({ retry, signal, telemetry });

    super(strategy, telemetry, session);

    this.#onActivity = onActivity;
    this.#session = session;
    this.#strategy = strategy;
    this.#signal = signal;
    this.#telemetry = telemetry;

    let controller: ReadableStreamDefaultController | undefined;

    this.#subscribingActivities = new ReadableStream({
      start(c) {
        controller = c;
      }
    });

    if (!controller) {
      throw new Error('ASSERTION ERROR: ReadableStreamDefaultController should be assigned');
    }

    this.#subscribingActivitiesController = controller;
  }

  #onActivity: (() => void) | undefined;
  #session: APISession;
  #subscribeRejectReason: unknown;
  #signal: AbortSignal | undefined;
  #strategy: StrategySupportExperimentalSubscribeActivities;
  #subscribingActivities: ReadableStream<Activity>;
  #subscribingActivitiesController: ReadableStreamDefaultController<Activity>;
  #telemetry: Telemetry | undefined;

  async #startSubscribe() {
    const { baseURL, body, headers } = await this.#strategy.experimental_prepareSubscribeActivities!();

    try {
      // We cannot use `new EventSource()` because we need to send headers.
      const iterator = this.#session.post(baseURL, {
        body,
        headers,
        subPath: 'subscribe',
        transport: 'auto' // Only works over SSE.
      });

      for await (const activity of iterator) {
        this.#subscribingActivitiesController.enqueue(activity);
        this.#onActivity?.();
      }
    } catch (error) {
      // Abort may cause fetch() to throw.
      if (!isAbortError(error)) {
        this.#telemetry?.trackException(error, {
          handledAt: 'DirectToEngineChatAdapterAPI.experimental_subscribeActivities'
        });

        this.#subscribingActivitiesController.error(error);
        this.#subscribeRejectReason = error;
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

  public executeTurn(activity?: Activity | undefined): AsyncIterableIterator<Activity> {
    const executeTurn_ = super.executeTurn.bind(this);

    return async function* (this: DirectToEngineChatAdapterAPIWithExecuteViaSubscribe) {
      if (this.#subscribeRejectReason) {
        throw this.#subscribeRejectReason;
      }

      const abortController = new AbortController();

      this.#signal?.addEventListener('abort', () => abortController.abort(), {
        once: true,
        signal: abortController.signal
      });

      if (activity) {
        (async () => {
          try {
            for await (const _ of executeTurn_(activity)) {
              // Ignore activities return by execute turn.
            }
          } finally {
            abortController.abort();
          }
        })();
      }

      const abortAfterDrain = !activity;

      try {
        yield* asyncIteratorWithDrain(
          readableStreamValuesWithSignal(this.#subscribingActivities, {
            // TODO: Add test to prove preventCancel is important.
            //       1. While subscribe
            //       2. Run execute, then end it
            //       3. Add an activity to subscribe
            //       4. Run execute again
            //       5. EXPECT: Should get activities from /subscribe
            preventCancel: true,
            signal: abortController.signal
          }),
          () => abortAfterDrain && abortController.abort()
        );
      } catch (error) {
        if (!isAbortError(error)) {
          this.#telemetry?.trackException(error, {
            handledAt: 'DirectToEngineChatAdapterAPIWithExecuteViaSubscribe.executeTurn'
          });

          throw error;
        }
      }
    }.call(this);
  }
}
