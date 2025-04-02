import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import createHalfDuplexChatAdapter, {
  type ExecuteTurnFunction,
  type TurnGenerator
} from '../../experimental/createHalfDuplexChatAdapterWithSubscribe';
import createReadableStreamWithController from '../../private/createReadableStreamWithController';
import ignoreUnhandledRejection from '../../private/tests/private/ignoreUnhandledRejection';
import { type BotResponse } from '../../private/types/BotResponse';
import { parseConversationId } from '../../private/types/ConversationId';
import { type DefaultHttpResponseResolver } from '../../private/types/DefaultHttpResponseResolver';
import { type JestMockOf } from '../../private/types/JestMockOf';
import { type Activity } from '../../types/Activity';
import { type Strategy } from '../../types/Strategy';
import { type Telemetry } from '../../types/Telemetry';

const server = setupServer();

const throwOnCall =
  <
    T extends (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...args: any[]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => any
  >(
    message: string
  ) =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (..._: Parameters<T>): ReturnType<T> => {
    throw new Error(message);
  };

// For debugging only one permutation.
const DEBUG_SINGLE_PERMUTATION = true;

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe.each(['auto' as const, 'rest' as const].slice(0, DEBUG_SINGLE_PERMUTATION ? 1 : Infinity))(
  'Using "%s" transport',
  transport => {
    let abortController: AbortController;
    let strategy: Strategy & {
      experimental_prepareSubscribeActivities: Exclude<Strategy['experimental_prepareSubscribeActivities'], undefined>;
    };

    beforeEach(() => {
      abortController = new AbortController();

      strategy = {
        async experimental_prepareSubscribeActivities() {
          return Promise.resolve({
            baseURL: new URL('http://test/?api=subscribe#3'),
            body: { dummy: 'dummy' },
            headers: new Headers({ 'x-dummy': 'dummy' }),
            transport
          });
        },
        async prepareExecuteTurn() {
          return Promise.resolve({
            baseURL: new URL('http://test/?api=execute#2'),
            body: { dummy: 'dummy' },
            headers: new Headers({ 'x-dummy': 'dummy' }),
            transport
          });
        },
        async prepareStartNewConversation() {
          return Promise.resolve({
            baseURL: new URL('http://test/?api=start#1'),
            body: { dummy: 'dummy' },
            headers: new Headers({ 'x-dummy': 'dummy' }),
            transport
          });
        }
      };
    });

    describe.each([true, false].slice(0, DEBUG_SINGLE_PERMUTATION ? 1 : Infinity))(
      'With emitStartConversationEvent of %s',
      emitStartConversationEvent => {
        describe.each(
          [
            ['With', true],
            ['Without', false]
          ].slice(0, DEBUG_SINGLE_PERMUTATION ? 1 : Infinity)
        )('%s correlation ID set', (_, shouldSetCorrelationId) => {
          let generator: TurnGenerator;
          let getCorrelationId: JestMockOf<() => string | undefined>;
          let httpPostContinue: JestMockOf<DefaultHttpResponseResolver>;
          let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
          let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;
          let httpPostSubscribe: JestMockOf<DefaultHttpResponseResolver>;
          let onActivity: JestMockOf<() => void>;
          let trackException: JestMockOf<Telemetry['trackException']>;

          beforeEach(() => {
            getCorrelationId = jest.fn(() => undefined);
            httpPostContinue = jest.fn(throwOnCall<DefaultHttpResponseResolver>('httpPostContinue is not mocked.'));
            httpPostConversation = jest.fn(
              throwOnCall<DefaultHttpResponseResolver>('httpPostConversation is not mocked')
            );
            httpPostExecute = jest.fn(throwOnCall<DefaultHttpResponseResolver>('httpPostExecute is not mocked'));
            httpPostSubscribe = jest.fn(throwOnCall<DefaultHttpResponseResolver>('httpPostSubscribe is not mocked'));
            onActivity = jest.fn<void, []>(() => {});
            trackException = jest.fn(throwOnCall<Telemetry['trackException']>('trackException is not mocked'));

            server.use(http.post('http://test/conversations', httpPostConversation));
            server.use(http.post('http://test/conversations/c-00001', httpPostExecute));
            server.use(http.post('http://test/conversations/c-00001/continue', httpPostContinue));
            server.use(http.post('http://test/conversations/c-00001/subscribe', httpPostSubscribe));

            generator = createHalfDuplexChatAdapter(strategy, {
              emitStartConversationEvent,
              onActivity,
              retry: { factor: 1, minTimeout: 0, retries: 1 },
              signal: abortController.signal,
              telemetry: {
                get correlationId() {
                  return getCorrelationId();
                },
                trackException
              }
            });
          });

          describe('When conversation started and bot returned no activities', () => {
            test('should not POST to /conversations', () => expect(httpPostConversation).toHaveBeenCalledTimes(0));
            test('should not POST to /subscribe', () => expect(httpPostSubscribe).toHaveBeenCalledTimes(0));

            describe('after iterate once', () => {
              let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;
              let mockHTTPPostSubscribeReadableStream: JestMockOf<
                () => {
                  controller: ReadableStreamDefaultController<ArrayBuffer>;
                  readableStream: ReadableStream<ArrayBuffer>;
                }
              >;

              beforeEach(async () => {
                if (transport === 'auto') {
                  httpPostConversation.mockImplementationOnce(
                    () =>
                      new HttpResponse(
                        Buffer.from(`event: end
data: end

`),
                        { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
                      )
                  );
                } else if (transport === 'rest') {
                  httpPostConversation.mockImplementationOnce(() =>
                    HttpResponse.json({
                      action: 'waiting',
                      activities: [],
                      conversationId: parseConversationId('c-00001')
                    } satisfies BotResponse)
                  );
                }

                mockHTTPPostSubscribeReadableStream = jest.fn(() => createReadableStreamWithController<ArrayBuffer>());

                httpPostSubscribe.mockImplementationOnce(() => {
                  return new HttpResponse(mockHTTPPostSubscribeReadableStream().readableStream, {
                    headers: { 'content-type': 'text/event-stream' }
                  });
                });

                shouldSetCorrelationId && getCorrelationId.mockImplementation(() => 't-00001');

                iteratorResult = await generator.next();
              });

              test('should complete and return the next execute function', () =>
                expect(iteratorResult).toEqual({ done: true, value: expect.any(Function) }));

              describe('should POST to /subscribe', () => {
                test('once', () => expect(httpPostSubscribe).toHaveBeenCalledTimes(1));

                test('with query "api" of "subscribe"', () =>
                  expect(new URL(httpPostSubscribe.mock.calls[0][0].request.url)).toHaveProperty(
                    'search',
                    '?api=subscribe'
                  ));

                test('with hash of "#3"', () =>
                  expect(new URL(httpPostSubscribe.mock.calls[0][0].request.url)).toHaveProperty('hash', '#3'));

                test('with header "Content-Type" of "application/json"', () =>
                  expect(httpPostSubscribe.mock.calls[0][0].request.headers.get('content-type')).toBe(
                    'application/json'
                  ));

                test('with header "x-dummy" of "dummy"', () =>
                  expect(httpPostSubscribe.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

                test('with header "x-ms-conversationid" of "c-00001"', () =>
                  expect(httpPostSubscribe.mock.calls[0][0].request.headers.get('x-ms-conversationid')).toBe(
                    'c-00001'
                  ));

                if (shouldSetCorrelationId) {
                  test('with header "x-ms-correlation-id" of "t-00001"', () =>
                    expect(httpPostSubscribe.mock.calls[0][0].request.headers.get('x-ms-correlation-id')).toBe(
                      't-00001'
                    ));
                } else {
                  test('without header "x-ms-correlation-id"', () =>
                    expect(httpPostSubscribe.mock.calls[0][0].request.headers.has('x-ms-correlation-id')).toBe(false));
                }

                test('with JSON body of { dummy: "dummy" }', () =>
                  expect(httpPostSubscribe.mock.calls[0][0].request.json()).resolves.toEqual({
                    dummy: 'dummy'
                  }));
              });

              test('should create a readable stream', () =>
                expect(mockHTTPPostSubscribeReadableStream).toHaveBeenCalledTimes(1));
              test('should NOT have called onActivity', () => expect(onActivity).toHaveBeenCalledTimes(0));

              describe('when two activities are sent over /subscribe', () => {
                beforeEach(() => {
                  const result = mockHTTPPostSubscribeReadableStream.mock.results[0];

                  expect(result).toHaveProperty('type', 'return');

                  if (result.type !== 'return') {
                    throw new Error();
                  }

                  result.value.controller?.enqueue(
                    Buffer.from(`event: activity
data: ${JSON.stringify({ from: { id: 'bot' }, text: 'Bot first message', type: 'message' })}

`)
                  );
                });

                test('should have called onActivity twice', () => expect(onActivity).toHaveBeenCalledTimes(1));
                test('should not POST to /conversations/c-0001', () =>
                  expect(httpPostExecute).toHaveBeenCalledTimes(0));

                describe('when the second activity is sent over /subscribe', () => {
                  beforeEach(() => {
                    const result = mockHTTPPostSubscribeReadableStream.mock.results[0];

                    expect(result).toHaveProperty('type', 'return');

                    if (result.type !== 'return') {
                      throw new Error();
                    }

                    result.value.controller?.enqueue(
                      Buffer.from(`event: activity
data: ${JSON.stringify({ from: { id: 'bot' }, text: 'Bot second message', type: 'message' })}

`)
                    );
                  });

                  test('should have called onActivity twice', () => expect(onActivity).toHaveBeenCalledTimes(2));
                  test('should not POST to /conversations/c-0001', () =>
                    expect(httpPostExecute).toHaveBeenCalledTimes(0));

                  // --------------------------------------------------------------

                  describe.each([
                    [
                      'execute turn',
                      {
                        from: { id: 'u-00001' },
                        text: 'User first message',
                        type: 'message' as const
                      }
                    ],
                    ['give up the turn', undefined]
                  ])('when %s', (_, outgoingActivity: Activity | undefined) => {
                    let executeTurnGenerator: TurnGenerator;

                    beforeEach(() => {
                      shouldSetCorrelationId && getCorrelationId.mockReset().mockImplementation(() => 't-00002');
                      executeTurnGenerator = (iteratorResult.value as ExecuteTurnFunction)(outgoingActivity);
                    });

                    describe('after iterate once', () => {
                      let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;
                      let completeExecuteResolvers: PromiseWithResolvers<void>;

                      beforeEach(async () => {
                        completeExecuteResolvers = Promise.withResolvers();

                        if (outgoingActivity) {
                          // Execute turn is only called when there is an outgoing activity.
                          if (transport === 'auto') {
                            httpPostExecute.mockImplementationOnce(async () => {
                              await completeExecuteResolvers.promise;

                              return new HttpResponse(
                                Buffer.from(`event: end
data: end

`),
                                { headers: { 'content-type': 'text/event-stream' } }
                              );
                            });
                          } else if (transport === 'rest') {
                            httpPostExecute.mockImplementationOnce(async () => {
                              await completeExecuteResolvers.promise;

                              return HttpResponse.json({
                                action: 'waiting',
                                activities: []
                              } satisfies BotResponse);
                            });
                          }
                        }

                        iteratorResult = await executeTurnGenerator.next();
                      });

                      if (outgoingActivity) {
                        // Execute turn is only called when there is an outgoing activity.
                        describe('should have POST to /conversations/c-00001', () => {
                          test('once', () => expect(httpPostExecute).toHaveBeenCalledTimes(1));

                          test('with query "api" of "execute"', () =>
                            expect(new URL(httpPostExecute.mock.calls[0][0].request.url)).toHaveProperty(
                              'search',
                              '?api=execute'
                            ));

                          test('with hash of "#2"', () =>
                            expect(new URL(httpPostExecute.mock.calls[0][0].request.url)).toHaveProperty('hash', '#2'));

                          test('with header "Content-Type" of "application/json"', () =>
                            expect(httpPostExecute.mock.calls[0][0].request.headers.get('content-type')).toBe(
                              'application/json'
                            ));

                          test('with header "x-dummy" of "dummy"', () =>
                            expect(httpPostExecute.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

                          test('with header "x-ms-conversationid" of "c-00001"', () =>
                            expect(httpPostExecute.mock.calls[0][0].request.headers.get('x-ms-conversationid')).toBe(
                              'c-00001'
                            ));

                          if (shouldSetCorrelationId) {
                            test('with header "x-ms-correlation-id" of "t-00002"', () =>
                              expect(httpPostExecute.mock.calls[0][0].request.headers.get('x-ms-correlation-id')).toBe(
                                't-00002'
                              ));
                          } else {
                            test('without header "x-ms-correlation-id"', () =>
                              expect(httpPostExecute.mock.calls[0][0].request.headers.has('x-ms-correlation-id')).toBe(
                                false
                              ));
                          }

                          test('with JSON body of { dummy: "dummy" }', () =>
                            expect(httpPostExecute.mock.calls[0][0].request.json()).resolves.toEqual({
                              activity: {
                                from: { id: 'u-00001' },
                                text: 'User first message',
                                type: 'message'
                              },
                              dummy: 'dummy'
                            }));
                        });
                      }

                      test('should return the activity from /subscribe', () =>
                        expect(iteratorResult).toEqual({
                          done: false,
                          value: { from: { id: 'bot' }, text: 'Bot first message', type: 'message' }
                        }));

                      describe('after iterate again', () => {
                        let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

                        beforeEach(async () => {
                          iteratorResult = await executeTurnGenerator.next();
                        });

                        test('should return the second activity', () =>
                          expect(iteratorResult).toEqual({
                            done: false,
                            value: { from: { id: 'bot' }, text: 'Bot second message', type: 'message' }
                          }));

                        describe('after iterate again', () => {
                          let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

                          beforeEach(async () => {
                            const result = mockHTTPPostSubscribeReadableStream.mock.results[0];

                            expect(result).toHaveProperty('type', 'return');

                            if (result.type !== 'return') {
                              throw new Error();
                            }

                            mockHTTPPostSubscribeReadableStream.mock.results[0].value.controller.enqueue(
                              Buffer.from(`event: activity
data: ${JSON.stringify({ from: { id: 'bot' }, text: 'Bot third message', type: 'message' })}

`)
                            );

                            iteratorResult = await executeTurnGenerator.next();
                          });

                          test('should return the activity from the latest subscribe', () =>
                            expect(iteratorResult).toEqual({
                              done: false,
                              value: { from: { id: 'bot' }, text: 'Bot third message', type: 'message' }
                            }));

                          describe('when execute turn resolved and after iterate again', () => {
                            let iteratorResultPromise: Promise<IteratorResult<Activity, ExecuteTurnFunction>>;

                            beforeEach(async () => {
                              completeExecuteResolvers.resolve();
                              iteratorResultPromise = executeTurnGenerator.next();
                            });

                            test('should complete', async () => {
                              expect(iteratorResultPromise).resolves.toEqual({
                                done: true,
                                value: expect.any(Function)
                              });
                            });
                          });
                        });

                        describe('when /subscribe has closed abruptly during iteration', () => {
                          beforeEach(() => {
                            trackException.mockImplementation(() => {});

                            const result = mockHTTPPostSubscribeReadableStream.mock.results[0];

                            expect(result).toHaveProperty('type', 'return');

                            if (result.type !== 'return') {
                              throw new Error('ASSERTION ERROR');
                            }

                            result.value.controller.error(new Error('Something went wrong'));
                          });

                          test('next() should throw', async () => {
                            const nextPromise = ignoreUnhandledRejection(executeTurnGenerator.next());

                            await expect(nextPromise).rejects.toEqual(new Error('Something went wrong'));
                          });
                        });
                      });
                    });
                  });
                });
              });

              describe('when /subscribe has closed abruptly before executeTurn()', () => {
                beforeEach(() => {
                  trackException.mockImplementation(() => {});

                  const result = mockHTTPPostSubscribeReadableStream.mock.results[0];

                  expect(result).toHaveProperty('type', 'return');

                  if (result.type !== 'return') {
                    throw new Error('ASSERTION ERROR');
                  }

                  result.value.controller.error(new Error('Something went wrong'));
                });

                describe.each([['give up' as const], ['send activity' as const]])(
                  'when calling executeTurn() to %s',
                  type => {
                    test('should throw on next()', async () => {
                      const executeTurnGenerator = (iteratorResult.value as ExecuteTurnFunction)(
                        type === 'give up'
                          ? undefined
                          : {
                              from: { id: 'user', role: 'user' },
                              text: 'Good morning!',
                              type: 'message'
                            }
                      );

                      const nextPromise = ignoreUnhandledRejection(executeTurnGenerator.next());

                      await expect(nextPromise).rejects.toEqual(new Error('Something went wrong'));
                    });
                  }
                );
              });

              describe('when signal is aborted', () => {
                beforeEach(async () => {
                  trackException.mockImplementationOnce(() => {});

                  abortController.abort();
                });

                test('should close the request of /subscribe', () => {
                  expect(httpPostSubscribe.mock.calls[0][0].request.signal).toHaveProperty('aborted', true);
                });
              });
            });
          });
        });
      }
    );
  }
);
