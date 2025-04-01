import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import { type Activity } from '../../types/Activity';
import { type Strategy } from '../../types/Strategy';
import { type Telemetry } from '../../types/Telemetry';
import DirectToEngineChatAdapterAPI from '../DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPI';
import { type BotResponse } from '../types/BotResponse';
import { parseConversationId } from '../types/ConversationId';
import { type DefaultHttpResponseResolver } from '../types/DefaultHttpResponseResolver';
import { type JestMockOf } from '../types/JestMockOf';

const server = setupServer();

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const NOT_MOCKED = <T extends (...args: any[]) => any>(..._: Parameters<T>): ReturnType<T> => {
  throw new Error('This function is not mocked.');
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe.each(['auto' as const, 'rest' as const])('Using "%s" transport', transport => {
  let strategy: Strategy;

  beforeEach(() => {
    strategy = {
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

  describe.each([true, false])('With emitStartConversationEvent of %s', emitStartConversationEvent => {
    describe.each([
      ['With', true],
      ['Without', false]
    ])('%s correlation ID set', (_, shouldSetCorrelationId) => {
      let adapter: DirectToEngineChatAdapterAPI;
      let getCorrelationId: JestMockOf<() => string | undefined>;
      let httpPostContinue: JestMockOf<DefaultHttpResponseResolver>;
      let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
      let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;
      let trackException: JestMockOf<Telemetry['trackException']>;

      beforeEach(() => {
        getCorrelationId = jest.fn(() => undefined);
        httpPostContinue = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
        httpPostConversation = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
        httpPostExecute = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
        trackException = jest.fn(NOT_MOCKED<Telemetry['trackException']>);

        server.use(http.post('http://test/conversations', httpPostConversation));
        server.use(http.post('http://test/conversations/c-00001', httpPostExecute));
        server.use(http.post('http://test/conversations/c-00001/continue', httpPostContinue));

        adapter = new DirectToEngineChatAdapterAPI(strategy, {
          retry: { factor: 1, minTimeout: 0 },
          telemetry: {
            get correlationId() {
              return getCorrelationId();
            },
            trackException
          }
        });
      });

      describe('When conversation started and bot returned with 3 activities in 3 turns', () => {
        let startNewConversationResult: ReturnType<DirectToEngineChatAdapterAPI['startNewConversation']>;

        beforeEach(() => {
          shouldSetCorrelationId && getCorrelationId.mockImplementation(() => 't-00001');
          startNewConversationResult = adapter.startNewConversation({ emitStartConversationEvent, locale: 'ja-JP' });
        });

        test('should not POST to /conversations', () => expect(httpPostConversation).toHaveBeenCalledTimes(0));

        describe('after iterate once', () => {
          let iteratorResult: IteratorResult<Activity>;

          beforeEach(async () => {
            if (transport === 'auto') {
              httpPostConversation.mockImplementationOnce(
                () =>
                  new HttpResponse(
                    Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Hello, World!", "type": "message" }

event: activity
data: { "from": { "id": "bot" }, "text": "Aloha!", "type": "message" }

event: activity
data: { "from": { "id": "bot" }, "text": "您好！", "type": "message" }

event: end
data: end

`),
                    { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
                  )
              );
            } else if (transport === 'rest') {
              httpPostConversation.mockImplementationOnce(() =>
                HttpResponse.json({
                  action: 'continue',
                  activities: [{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }],
                  conversationId: parseConversationId('c-00001')
                } satisfies BotResponse)
              );
            }

            iteratorResult = await startNewConversationResult.next();
          });

          describe('should have POST to /conversations', () => {
            test('once', () => expect(httpPostConversation).toHaveBeenCalledTimes(1));

            test('with query "api" of "start"', () =>
              expect(new URL(httpPostConversation.mock.calls[0][0].request.url)).toHaveProperty(
                'search',
                '?api=start'
              ));

            test('with hash of "#1"', () =>
              expect(new URL(httpPostConversation.mock.calls[0][0].request.url)).toHaveProperty('hash', '#1'));

            if (transport === 'auto') {
              test('with header "Accept" of "text/event-stream,application/json;q=0.9"', () =>
                expect(httpPostConversation.mock.calls[0][0].request.headers.get('accept')).toBe(
                  'text/event-stream,application/json;q=0.9'
                ));
            } else if (transport === 'rest') {
              test('with header "Accept" of "application/json"', () =>
                expect(httpPostConversation.mock.calls[0][0].request.headers.get('accept')).toBe('application/json'));
            }

            test('with header "Content-Type" of "application/json"', () =>
              expect(httpPostConversation.mock.calls[0][0].request.headers.get('content-type')).toBe(
                'application/json'
              ));

            test('with header "x-dummy" of "dummy"', () =>
              expect(httpPostConversation.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

            test('with header "x-ms-chat-adapter"', () =>
              expect(httpPostConversation.mock.calls[0][0].request.headers.get('x-ms-chat-adapter')).toBe(
                'version=0.0.0-test'
              ));

            test('without header "x-ms-conversationid"', () =>
              expect(httpPostConversation.mock.calls[0][0].request.headers.has('x-ms-conversationid')).toBe(false));

            if (shouldSetCorrelationId) {
              test('with header "x-ms-correlation-id" of "t-00001"', () =>
                expect(httpPostConversation.mock.calls[0][0].request.headers.get('x-ms-correlation-id')).toBe(
                  't-00001'
                ));
            } else {
              test('without header "x-ms-correlation-id"', () =>
                expect(httpPostConversation.mock.calls[0][0].request.headers.has('x-ms-correlation-id')).toBe(false));
            }

            test(`with JSON body of { dummy: "dummy", emitStartConversationEvent: ${emitStartConversationEvent}, locale: 'ja-JP' }`, () =>
              expect(httpPostConversation.mock.calls[0][0].request.json()).resolves.toEqual({
                dummy: 'dummy',
                emitStartConversationEvent,
                locale: 'ja-JP'
              }));
          });

          test('should return the first activity', () =>
            expect(iteratorResult).toEqual({
              done: false,
              value: { from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }
            }));

          describe('after iterate twice', () => {
            let iteratorResult: IteratorResult<Activity>;

            beforeEach(async () => {
              if (transport === 'rest') {
                httpPostContinue.mockImplementationOnce(() =>
                  HttpResponse.json({
                    action: 'continue',
                    activities: [{ from: { id: 'bot' }, text: 'Aloha!', type: 'message' }]
                  } satisfies BotResponse)
                );
              }

              iteratorResult = await startNewConversationResult.next();
            });

            if (transport === 'rest') {
              describe('should have POST to /conversations/c-00001/continue', () => {
                test('once', () => expect(httpPostContinue).toHaveBeenCalledTimes(1));

                test('with query "api" of "start"', () =>
                  expect(new URL(httpPostContinue.mock.calls[0][0].request.url)).toHaveProperty(
                    'search',
                    '?api=start'
                  ));

                test('with hash of "#1"', () =>
                  expect(new URL(httpPostContinue.mock.calls[0][0].request.url)).toHaveProperty('hash', '#1'));

                test('with header "Content-Type" of "application/json"', () =>
                  expect(httpPostContinue.mock.calls[0][0].request.headers.get('content-type')).toBe(
                    'application/json'
                  ));

                test('with header "x-dummy" of "dummy"', () =>
                  expect(httpPostContinue.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

                test('with header "x-ms-chat-adapter"', () =>
                  expect(httpPostContinue.mock.calls[0][0].request.headers.get('x-ms-chat-adapter')).toBe(
                    'version=0.0.0-test'
                  ));

                test('with header "x-ms-conversationid" of "c-00001"', () =>
                  expect(httpPostContinue.mock.calls[0][0].request.headers.get('x-ms-conversationid')).toBe('c-00001'));

                if (shouldSetCorrelationId) {
                  test('with header "x-ms-correlation-id" of "t-00001"', () =>
                    expect(httpPostContinue.mock.calls[0][0].request.headers.get('x-ms-correlation-id')).toBe(
                      't-00001'
                    ));
                } else {
                  test('without header "x-ms-correlation-id"', () =>
                    expect(httpPostContinue.mock.calls[0][0].request.headers.has('x-ms-correlation-id')).toBe(false));
                }

                test('with JSON body of { dummy: "dummy" }', () =>
                  expect(httpPostContinue.mock.calls[0][0].request.json()).resolves.toEqual({
                    dummy: 'dummy'
                  }));
              });
            }

            test('should return the second activity', () =>
              expect(iteratorResult).toEqual({
                done: false,
                value: { from: { id: 'bot' }, text: 'Aloha!', type: 'message' }
              }));

            describe('after iterate the third time', () => {
              let iteratorResult: IteratorResult<Activity>;

              beforeEach(async () => {
                if (transport === 'rest') {
                  httpPostContinue.mockImplementationOnce(() =>
                    HttpResponse.json({
                      action: 'waiting',
                      activities: [{ from: { id: 'bot' }, text: '您好！', type: 'message' }]
                    } satisfies BotResponse)
                  );
                }

                iteratorResult = await startNewConversationResult.next();
              });

              if (transport === 'rest') {
                describe('should have POST to /conversations/c-00001/continue', () => {
                  test('once', () => expect(httpPostContinue).toHaveBeenCalledTimes(2));

                  test('with query "api" of "start"', () =>
                    expect(new URL(httpPostContinue.mock.calls[1][0].request.url)).toHaveProperty(
                      'search',
                      '?api=start'
                    ));

                  test('with hash of "#1"', () =>
                    expect(new URL(httpPostContinue.mock.calls[1][0].request.url)).toHaveProperty('hash', '#1'));

                  test('with header "Content-Type" of "application/json"', () =>
                    expect(httpPostContinue.mock.calls[1][0].request.headers.get('content-type')).toBe(
                      'application/json'
                    ));

                  test('with header "x-dummy" of "dummy"', () =>
                    expect(httpPostContinue.mock.calls[1][0].request.headers.get('x-dummy')).toBe('dummy'));

                  test('with header "x-ms-chat-adapter"', () =>
                    expect(httpPostContinue.mock.calls[1][0].request.headers.get('x-ms-chat-adapter')).toBe(
                      'version=0.0.0-test'
                    ));

                  test('with header "x-ms-conversationid" of "c-00001"', () =>
                    expect(httpPostContinue.mock.calls[1][0].request.headers.get('x-ms-conversationid')).toBe(
                      'c-00001'
                    ));

                  if (shouldSetCorrelationId) {
                    test('with header "x-ms-correlation-id" of "t-00001"', () =>
                      expect(httpPostContinue.mock.calls[1][0].request.headers.get('x-ms-correlation-id')).toBe(
                        't-00001'
                      ));
                  } else {
                    test('without header "x-ms-correlation-id"', () =>
                      expect(httpPostContinue.mock.calls[1][0].request.headers.has('x-ms-correlation-id')).toBe(false));
                  }

                  test('with JSON body of { dummy: "dummy" }', () =>
                    expect(httpPostContinue.mock.calls[1][0].request.json()).resolves.toEqual({
                      dummy: 'dummy'
                    }));
                });
              }

              test('should return the third activity', () =>
                expect(iteratorResult).toEqual({
                  done: false,
                  value: { from: { id: 'bot' }, text: '您好！', type: 'message' }
                }));

              describe('after iterate the fourth time', () => {
                let iteratorResult: IteratorResult<Activity>;

                beforeEach(async () => {
                  iteratorResult = await startNewConversationResult.next();
                });

                test('should complete', () => expect(iteratorResult).toEqual({ done: true, value: undefined }));

                describe('when execute turn and bot returned 3 activities in 3 turns', () => {
                  let executeTurnResult: ReturnType<DirectToEngineChatAdapterAPI['executeTurn']>;

                  beforeEach(() => {
                    shouldSetCorrelationId && getCorrelationId.mockReset().mockImplementation(() => 't-00002');
                    executeTurnResult = adapter.executeTurn({
                      from: { id: 'u-00001' },
                      text: 'Morning.',
                      type: 'message'
                    });
                  });

                  test('should not POST to /conversations/c-00001', () =>
                    expect(httpPostExecute).toHaveBeenCalledTimes(0));

                  describe('after iterate once', () => {
                    let iteratorResult: IteratorResult<Activity>;

                    beforeEach(async () => {
                      if (transport === 'auto') {
                        httpPostExecute.mockImplementationOnce(
                          () =>
                            new HttpResponse(
                              Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Good morning!", "type": "message" }

event: activity
data: { "from": { "id": "bot" }, "text": "Goodbye!", "type": "message" }

event: activity
data: { "from": { "id": "bot" }, "text": "再見！", "type": "message" }

event: end
data: end

`),
                              { headers: { 'content-type': 'text/event-stream' } }
                            )
                        );
                      } else if (transport === 'rest') {
                        httpPostExecute.mockImplementationOnce(() =>
                          HttpResponse.json({
                            action: 'continue',
                            activities: [{ from: { id: 'bot' }, text: 'Good morning!', type: 'message' }]
                          } satisfies BotResponse)
                        );
                      }

                      iteratorResult = await executeTurnResult.next();
                    });

                    describe('should have POST to /conversations/c-00001', () => {
                      test('once', () => expect(httpPostExecute).toHaveBeenCalledTimes(1));

                      test('with query "api" of "execute"', () =>
                        expect(new URL(httpPostExecute.mock.calls[0][0].request.url)).toHaveProperty(
                          'search',
                          '?api=execute'
                        ));

                      test('with hash of "#2"', () =>
                        expect(new URL(httpPostExecute.mock.calls[0][0].request.url)).toHaveProperty('hash', '#2'));

                      if (transport === 'auto') {
                        test('with header "Accept" of "text/event-stream,application/json;q=0.9"', () =>
                          expect(httpPostExecute.mock.calls[0][0].request.headers.get('accept')).toBe(
                            'text/event-stream,application/json;q=0.9'
                          ));
                      } else if (transport === 'rest') {
                        test('with header "Accept" of "application/json"', () =>
                          expect(httpPostExecute.mock.calls[0][0].request.headers.get('accept')).toBe(
                            'application/json'
                          ));
                      }

                      test('with header "Content-Type" of "application/json"', () =>
                        expect(httpPostExecute.mock.calls[0][0].request.headers.get('content-type')).toBe(
                          'application/json'
                        ));

                      test('with header "x-dummy" of "dummy"', () =>
                        expect(httpPostExecute.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

                      test('with header "x-ms-chat-adapter"', () =>
                        expect(httpPostExecute.mock.calls[0][0].request.headers.get('x-ms-chat-adapter')).toBe(
                          'version=0.0.0-test'
                        ));

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

                      test('with JSON body of activity and { dummy: "dummy" }', () =>
                        expect(httpPostExecute.mock.calls[0][0].request.json()).resolves.toEqual({
                          activity: { from: { id: 'u-00001' }, text: 'Morning.', type: 'message' },
                          dummy: 'dummy'
                        }));
                    });

                    test('should return the third activity', () =>
                      expect(iteratorResult).toEqual({
                        done: false,
                        value: { from: { id: 'bot' }, text: 'Good morning!', type: 'message' }
                      }));

                    describe('after iterate twice', () => {
                      let iteratorResult: IteratorResult<Activity>;

                      beforeEach(async () => {
                        if (transport === 'rest') {
                          httpPostContinue.mockImplementationOnce(() =>
                            HttpResponse.json({
                              action: 'continue',
                              activities: [{ from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }]
                            } satisfies BotResponse)
                          );
                        }

                        iteratorResult = await executeTurnResult.next();
                      });

                      if (transport === 'rest') {
                        describe('should have POST to /conversations/c-00001/continue', () => {
                          test('twice', () => expect(httpPostContinue).toHaveBeenCalledTimes(3));

                          test('with query "api" of "execute"', () =>
                            expect(new URL(httpPostContinue.mock.calls[2][0].request.url)).toHaveProperty(
                              'search',
                              '?api=execute'
                            ));

                          test('with hash of "#2"', () =>
                            expect(new URL(httpPostContinue.mock.calls[2][0].request.url)).toHaveProperty(
                              'hash',
                              '#2'
                            ));

                          test('with header "Content-Type" of "application/json"', () =>
                            expect(httpPostContinue.mock.calls[2][0].request.headers.get('content-type')).toBe(
                              'application/json'
                            ));

                          test('with header "x-dummy" of "dummy"', () =>
                            expect(httpPostContinue.mock.calls[2][0].request.headers.get('x-dummy')).toBe('dummy'));

                          test('with header "x-ms-chat-adapter"', () =>
                            expect(httpPostContinue.mock.calls[2][0].request.headers.get('x-ms-chat-adapter')).toBe(
                              'version=0.0.0-test'
                            ));

                          test('with header "x-ms-conversationid" of "c-00001"', () =>
                            expect(httpPostContinue.mock.calls[2][0].request.headers.get('x-ms-conversationid')).toBe(
                              'c-00001'
                            ));

                          if (shouldSetCorrelationId) {
                            test('with header "x-ms-correlation-id" of "t-00002"', () =>
                              expect(httpPostContinue.mock.calls[2][0].request.headers.get('x-ms-correlation-id')).toBe(
                                't-00002'
                              ));
                          } else {
                            test('without header "x-ms-correlation-id"', () =>
                              expect(httpPostContinue.mock.calls[2][0].request.headers.has('x-ms-correlation-id')).toBe(
                                false
                              ));
                          }

                          test('with JSON body of { dummy: "dummy" }', () =>
                            expect(httpPostContinue.mock.calls[2][0].request.json()).resolves.toEqual({
                              dummy: 'dummy'
                            }));
                        });
                      }

                      test('should return the fifth activity', () =>
                        expect(iteratorResult).toEqual({
                          done: false,
                          value: { from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }
                        }));

                      describe('after iterate the third time', () => {
                        let iteratorResult: IteratorResult<Activity>;

                        beforeEach(async () => {
                          if (transport === 'rest') {
                            httpPostContinue.mockImplementationOnce(() =>
                              HttpResponse.json({
                                action: 'waiting',
                                activities: [{ from: { id: 'bot' }, text: '再見！', type: 'message' }]
                              } satisfies BotResponse)
                            );
                          }

                          iteratorResult = await executeTurnResult.next();
                        });

                        if (transport === 'rest') {
                          describe('should have POST to /conversations/c-00001/continue', () => {
                            test('twice', () => expect(httpPostContinue).toHaveBeenCalledTimes(4));

                            test('with query "api" of "execute"', () =>
                              expect(new URL(httpPostContinue.mock.calls[3][0].request.url)).toHaveProperty(
                                'search',
                                '?api=execute'
                              ));

                            test('with hash of "#2"', () =>
                              expect(new URL(httpPostContinue.mock.calls[3][0].request.url)).toHaveProperty(
                                'hash',
                                '#2'
                              ));

                            test('with header "Content-Type" of "application/json"', () =>
                              expect(httpPostContinue.mock.calls[3][0].request.headers.get('content-type')).toBe(
                                'application/json'
                              ));

                            test('with header "x-dummy" of "dummy"', () =>
                              expect(httpPostContinue.mock.calls[3][0].request.headers.get('x-dummy')).toBe('dummy'));

                            test('with header "x-ms-chat-adapter"', () =>
                              expect(httpPostContinue.mock.calls[3][0].request.headers.get('x-ms-chat-adapter')).toBe(
                                'version=0.0.0-test'
                              ));

                            test('with header "x-ms-conversationid" of "c-00001"', () =>
                              expect(httpPostContinue.mock.calls[3][0].request.headers.get('x-ms-conversationid')).toBe(
                                'c-00001'
                              ));

                            if (shouldSetCorrelationId) {
                              test('with header "x-ms-correlation-id" of "t-00002"', () =>
                                expect(
                                  httpPostContinue.mock.calls[3][0].request.headers.get('x-ms-correlation-id')
                                ).toBe('t-00002'));
                            } else {
                              test('without header "x-ms-correlation-id"', () =>
                                expect(
                                  httpPostContinue.mock.calls[3][0].request.headers.has('x-ms-correlation-id')
                                ).toBe(false));
                            }

                            test('with JSON body of { dummy: "dummy" }', () =>
                              expect(httpPostContinue.mock.calls[3][0].request.json()).resolves.toEqual({
                                dummy: 'dummy'
                              }));
                          });
                        }

                        test('should return the sixth activity', () =>
                          expect(iteratorResult).toEqual({
                            done: false,
                            value: { from: { id: 'bot' }, text: '再見！', type: 'message' }
                          }));

                        describe('after iterate the fourth time', () => {
                          let iteratorResult: IteratorResult<Activity>;

                          beforeEach(async () => {
                            iteratorResult = await executeTurnResult.next();
                          });

                          test('should complete', () =>
                            expect(iteratorResult).toEqual({ done: true, value: undefined }));
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
