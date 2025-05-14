import { EventSourceParserStream, type ParsedEvent } from 'eventsource-parser/stream';
import { asyncGeneratorWithLastValue } from 'iter-fest';
import pRetry, { type Options as PRetryOptions } from 'p-retry';
import { maxValue, minValue, number, parse, pipe, safeParse } from 'valibot';
import { parseBotResponse } from '../../../private/types/BotResponse';
import { parseConversationId, type ConversationId } from '../../../private/types/ConversationId';
import { type Activity } from '../../../types/Activity';
import type { StrategyRequestInit } from '../../../types/Strategy';
import { type Telemetry } from '../../../types/Telemetry';
import {
  directToEngineChatAdapterAPIInitSchema,
  type DirectToEngineChatAdapterAPIInit
} from '../DirectToEngineChatAdapterAPIInit';
import { CONVERSATION_ID_HEADER_NAME } from './Constants';
import createFetchArguments from './createFetchArguments';

const MAX_CONTINUE_TURN = 999;
const RETRY_AFTER_SCHEMA = pipe(number(), minValue(100), maxValue(60_000));

class APISession {
  constructor(init: DirectToEngineChatAdapterAPIInit) {
    const { retry, signal, telemetry } = parse(directToEngineChatAdapterAPIInitSchema, init);

    this.#retry = retry;
    this.#signal = signal;
    this.#telemetry = telemetry;
  }

  #conversationId: string | undefined;
  #retry: PRetryOptions & { retries: number };
  #signal: AbortSignal | undefined;
  #telemetry: Telemetry | undefined;

  get conversationId() {
    return this.#conversationId;
  }

  post({
    baseURL,
    body,
    headers,
    initialBody,
    subPath,
    transport
  }: StrategyRequestInit &
    Readonly<{
      initialBody?: Record<string, unknown> | undefined;
      subPath?: string | undefined;
    }>): AsyncIterableIterator<Activity> {
    return async function* (this: APISession) {
      const typingMap = new Map<string, string>();

      for (let numTurn = 0; numTurn < MAX_CONTINUE_TURN; numTurn++) {
        const isContinueTurn = !!numTurn;
        let currentResponse: Response;

        const activityGeneratorPromise = pRetry(
          async (): Promise<AsyncGenerator<Activity, 'continue' | 'end'>> => {
            const [url, requestInit] = createFetchArguments(
              {
                baseURL,
                body: isContinueTurn ? body : { ...body, ...initialBody },
                headers,
                transport
              },
              {
                conversationId: this.#conversationId,
                correlationId: this.#telemetry?.correlationId,
                pathSuffixes: [subPath, isContinueTurn && 'continue'].filter((value): value is string => !!value)
              }
            );

            currentResponse = await fetch(url, { ...requestInit, signal: this.#signal });

            if (!currentResponse.ok) {
              const error = new Error(`Server returned ${currentResponse.status} while calling the service.`);

              this.#telemetry?.trackException?.(error, { handledAt: 'DirectToEngineChatAdapterAPI.#post' });

              throw error;
            }

            const contentType = currentResponse.headers.get('content-type');

            if (contentType === 'application/json') {
              const botResponse = parseBotResponse(await currentResponse.json());

              if (!this.#conversationId) {
                const conversationIdInResponse = currentResponse.headers.has(CONVERSATION_ID_HEADER_NAME)
                  ? (currentResponse.headers.get(CONVERSATION_ID_HEADER_NAME) as ConversationId)
                  : botResponse.conversationId;

                if (!conversationIdInResponse) {
                  const error = new Error(
                    `HTTP REST response from start new conversation must have "${CONVERSATION_ID_HEADER_NAME}" in the header or "conversationId" in the body.`
                  );

                  this.#telemetry?.trackException?.(error, { handledAt: 'DirectToEngineChatAdapterAPI.#post' });

                  throw error;
                }

                this.#conversationId = conversationIdInResponse;
              }

              return (async function* (): AsyncGenerator<Activity, 'continue' | 'end'> {
                for (const activity of botResponse.activities) {
                  yield activity;
                }

                return botResponse.action === 'continue' ? botResponse.action : 'end';
              })();
            } else if (contentType === 'text/event-stream') {
              if (transport === 'rest') {
                const error = new Error(
                  'Protocol mismatch. Server returning Server-Sent Events while client requesting REST API.'
                );

                this.#telemetry?.trackException?.(error, { handledAt: 'DirectToEngineChatAdapterAPI.#post' });

                throw error;
              }

              if (!this.#conversationId) {
                const conversationId = currentResponse.headers.get(CONVERSATION_ID_HEADER_NAME);

                if (!conversationId) {
                  const error = new Error(
                    `HTTP SSE response from start new conversation must have "${CONVERSATION_ID_HEADER_NAME}" in the header.`
                  );

                  this.#telemetry?.trackException?.(error, { handledAt: 'DirectToEngineChatAdapterAPI.#post' });

                  throw error;
                }

                this.#conversationId = parseConversationId(conversationId);
              }

              const { body } = currentResponse;

              if (!body) {
                const error = new Error(`Server did not respond with body in event stream mode.`);

                this.#telemetry?.trackException?.(error, { handledAt: 'DirectToEngineChatAdapterAPI.#post' });

                throw error;
              }

              const readableStream = body
                .pipeThrough(new TextDecoderStream(), { signal: this.#signal })
                .pipeThrough(new EventSourceParserStream(), { signal: this.#signal })
                .pipeThrough(
                  new TransformStream<ParsedEvent, Activity>({
                    transform: ({ data, event }, controller) => {
                      if (event === 'end') {
                        controller.terminate();
                      } else if (event === 'activity') {
                        const activity = JSON.parse(data);

                        // TODO: Should be replaced by something in HTTP header or "init" event.
                        if (!this.#conversationId && activity.conversation?.id) {
                          this.#conversationId = activity.conversation.id;
                        }

                        // Specific to DtE SSE protocol, this will accumulate intermediate result by concatenating with previous result.
                        if (
                          activity.type === 'typing' &&
                          activity.text &&
                          activity.channelData?.streamType === 'streaming' &&
                          activity.channelData?.chunkType === 'delta'
                        ) {
                          const streamId = activity.channelData?.streamId || activity.id;
                          const accumulated = (typingMap.get(streamId) || '') + activity.text;

                          typingMap.set(streamId, accumulated);
                          activity.text = accumulated;
                        }

                        controller.enqueue(activity);
                      }
                    }
                  }),
                  { signal: this.#signal }
                );

              return async function* (this: APISession) {
                try {
                  const reader = readableStream.getReader();

                  this.#signal?.addEventListener('abort', () => reader.cancel(), { once: true });

                  for (;;) {
                    let result: ReadableStreamReadResult<Activity>;

                    try {
                      result = await reader.read();
                    } catch (error) {
                      if (error && error instanceof TypeError && error.message === 'Invalid state: Releasing reader') {
                        break;
                      }

                      throw error;
                    }

                    if (result.done) {
                      break;
                    }

                    yield result.value;
                  }
                } catch (error) {
                  if (error && typeof error === 'object' && 'message' in error && error.message !== 'Aborted') {
                    throw error;
                  }
                }

                return 'end' as const;
              }.call(this);
            }

            const error = new Error(`Received unknown HTTP header "Content-Type: ${contentType}".`);

            this.#telemetry?.trackException?.(error, { handledAt: 'DirectToEngineChatAdapterAPI.#post' });

            throw error;
          },
          {
            ...this.#retry,
            signal: this.#signal,
            onFailedAttempt: async (error: unknown) => {
              if (currentResponse) {
                const { headers, status } = currentResponse;

                if (status === 429) {
                  const retryAfterResult = safeParse(RETRY_AFTER_SCHEMA, parseInt(headers.get('retry-after') || ''));

                  await new Promise(resolve =>
                    setTimeout(resolve, retryAfterResult.success ? retryAfterResult.output : 1_000)
                  );
                } else if (status < 500) {
                  throw error;
                }
              }
            }
          }
        );

        const telemetry = this.#telemetry;

        telemetry &&
          activityGeneratorPromise.catch((error: unknown) => {
            // TODO [hawo]: We should rework on this telemetry for a couple of reasons:
            //              1. We did not handle it, why call it "handledAt"?
            //              2. We should indicate this error is related to the protocol
            error instanceof Error &&
              telemetry.trackException?.(error, {
                handledAt: 'DirectToEngineChatAdapterAPI.withRetries',
                retryCount: this.#retry.retries + 1 + ''
              });
          });

        const activities = asyncGeneratorWithLastValue(await activityGeneratorPromise);

        for await (const activity of activities) {
          yield activity;
        }

        if (activities.lastValue() === 'end') {
          break;
        }
      }
    }.call(this);
  }
}

export default APISession;
