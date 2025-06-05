import { type ConnectionStatus } from 'botframework-directlinejs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import createHalfDuplexChatAdapter, { type TurnGenerator } from '../../createHalfDuplexChatAdapter';
import DeferredQueue from '../../private/DeferredQueue';
import { type BotResponse } from '../../private/types/BotResponse';
import { parseConversationId } from '../../private/types/ConversationId';
import { type DefaultHttpResponseResolver } from '../../private/types/DefaultHttpResponseResolver';
import { type JestMockOf } from '../../private/types/JestMockOf';
import toDirectLineJS from '../../toDirectLineJS';
import { type Activity } from '../../types/Activity';
import { type DirectLineJSBotConnection } from '../../types/DirectLineJSBotConnection';
import { type Strategy } from '../../types/Strategy';
import { type Telemetry } from '../../types/Telemetry';

const server = setupServer();

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const NOT_MOCKED = <T extends (...args: any[]) => any>(..._: Parameters<T>): ReturnType<T> => {
  throw new Error('This function is not mocked.');
};

jest.spyOn(console, 'error').mockImplementation(jest.fn());
jest.spyOn(console, 'warn').mockImplementation(jest.fn());

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

  describe.each([true, false])('with emitStartConversationEvent of %s', emitStartConversationEvent => {
    describe.each([
      ['With', true],
      ['Without', false]
    ])('%s correlation ID set', (_, shouldSetCorrelationId) => {
      let chatAdapter: TurnGenerator;
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

        chatAdapter = createHalfDuplexChatAdapter(strategy, {
          emitStartConversationEvent,
          locale: 'ja-JP',
          retry: { factor: 1, minTimeout: 0 },
          telemetry: {
            get correlationId() {
              return getCorrelationId();
            },
            trackException
          }
        });
      });

      test('should not POST to /conversations', () => expect(httpPostConversation).toHaveBeenCalledTimes(0));

      describe('when subscribe', () => {
        let activitiesQueue: DeferredQueue<Activity>;
        let activitiesObserver: JestMockOf<(activity: Activity) => void>;
        let connectionStatusObserver: JestMockOf<(connectionStatus: ConnectionStatus) => void>;
        let connectionStatusQueue: DeferredQueue<ConnectionStatus>;
        let directLineJS: DirectLineJSBotConnection;

        beforeEach(() => {
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

            httpPostContinue.mockImplementationOnce(() =>
              HttpResponse.json({
                action: 'continue',
                activities: [{ from: { id: 'bot' }, text: 'Aloha!', type: 'message' }]
              } satisfies BotResponse)
            );

            httpPostContinue.mockImplementationOnce(() =>
              HttpResponse.json({
                action: 'waiting',
                activities: [{ from: { id: 'bot' }, text: '您好！', type: 'message' }]
              } satisfies BotResponse)
            );
          }

          shouldSetCorrelationId && getCorrelationId.mockImplementation(() => 't-00001');

          activitiesQueue = new DeferredQueue();
          connectionStatusQueue = new DeferredQueue();

          activitiesObserver = jest.fn(activity => activitiesQueue.push(activity));
          connectionStatusObserver = jest.fn(connectionStatus => connectionStatusQueue.push(connectionStatus));

          directLineJS = toDirectLineJS(chatAdapter);
          directLineJS.connectionStatus$.subscribe(connectionStatusObserver);

          directLineJS.activity$.subscribe(activitiesObserver);
        });

        describe('wait until online and receive 3 activities', () => {
          beforeEach(async () => {
            await connectionStatusQueue.promise;
            await connectionStatusQueue.promise;
            await connectionStatusQueue.promise;

            // We need to wait for activitiesQueue too.
            // Otherwise, they will be received after Jest is tearing down the test, causing errors.
            await activitiesQueue.promise;
            await activitiesQueue.promise;
            await activitiesQueue.promise;
          });

          describe('should call the connectionStatus observer', () => {
            test('3 times', () => expect(connectionStatusObserver).toHaveBeenCalledTimes(3));
            test('with "Uninitialized"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(1, 0));
            test('with "Connecting"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(2, 1));
            test('with "Online"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(3, 2));
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
                  'text/event-stream,application/json;q=0.9,*/*;q=0.8'
                ));
            } else if (transport === 'rest') {
              test('with header "Accept" of "application/json"', () =>
                expect(httpPostConversation.mock.calls[0][0].request.headers.get('accept')).toBe(
                  'application/json,*/*;q=0.8'
                ));
            }

            test('with header "Content-Type" of "application/json"', () =>
              expect(httpPostConversation.mock.calls[0][0].request.headers.get('content-type')).toBe(
                'application/json'
              ));

            test('with header "x-dummy" of "dummy"', () =>
              expect(httpPostConversation.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

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

          test('should observe the first activity', () =>
            expect(activitiesObserver).toHaveBeenNthCalledWith(1, {
              from: { id: 'bot' },
              text: 'Hello, World!',
              type: 'message'
            }));

          if (transport === 'rest') {
            describe('should have POST to /conversations/c-00001/continue', () => {
              test('with query "api" of "start"', () =>
                expect(new URL(httpPostContinue.mock.calls[0][0].request.url)).toHaveProperty('search', '?api=start'));

              test('with hash of "#1"', () =>
                expect(new URL(httpPostContinue.mock.calls[0][0].request.url)).toHaveProperty('hash', '#1'));

              test('with header "Content-Type" of "application/json"', () =>
                expect(httpPostContinue.mock.calls[0][0].request.headers.get('content-type')).toBe('application/json'));

              test('with header "x-dummy" of "dummy"', () =>
                expect(httpPostContinue.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

              test('with header "x-ms-conversationid" of "c-00001"', () =>
                expect(httpPostContinue.mock.calls[0][0].request.headers.get('x-ms-conversationid')).toBe('c-00001'));

              if (shouldSetCorrelationId) {
                test('with header "x-ms-correlation-id" of "t-00001"', () =>
                  expect(httpPostContinue.mock.calls[0][0].request.headers.get('x-ms-correlation-id')).toBe('t-00001'));
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

          test('should observe the second activity', () =>
            expect(activitiesObserver).toHaveBeenNthCalledWith(2, {
              from: { id: 'bot' },
              text: 'Aloha!',
              type: 'message'
            }));

          if (transport === 'rest') {
            describe('should have POST to /conversations/c-00001/continue', () => {
              test('twice', () => expect(httpPostContinue).toHaveBeenCalledTimes(2));

              test('with query "api" of "start"', () =>
                expect(new URL(httpPostContinue.mock.calls[1][0].request.url)).toHaveProperty('search', '?api=start'));

              test('with hash of "#1"', () =>
                expect(new URL(httpPostContinue.mock.calls[1][0].request.url)).toHaveProperty('hash', '#1'));

              test('with header "Content-Type" of "application/json"', () =>
                expect(httpPostContinue.mock.calls[1][0].request.headers.get('content-type')).toBe('application/json'));

              test('with header "x-dummy" of "dummy"', () =>
                expect(httpPostContinue.mock.calls[1][0].request.headers.get('x-dummy')).toBe('dummy'));

              test('with header "x-ms-conversationid" of "c-00001"', () =>
                expect(httpPostContinue.mock.calls[1][0].request.headers.get('x-ms-conversationid')).toBe('c-00001'));

              if (shouldSetCorrelationId) {
                test('with header "x-ms-correlation-id" of "t-00001"', () =>
                  expect(httpPostContinue.mock.calls[1][0].request.headers.get('x-ms-correlation-id')).toBe('t-00001'));
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

          test('should observe the third activity', () =>
            expect(activitiesObserver).toHaveBeenNthCalledWith(3, {
              from: { id: 'bot' },
              text: '您好！',
              type: 'message'
            }));

          describe('when post an activity', () => {
            let postActivityObserver: JestMockOf<(id: string) => void>;

            beforeEach(() => {
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

                httpPostContinue.mockImplementationOnce(() =>
                  HttpResponse.json({
                    action: 'continue',
                    activities: [{ from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }]
                  } satisfies BotResponse)
                );

                httpPostContinue.mockImplementationOnce(() =>
                  HttpResponse.json({
                    action: 'waiting',
                    activities: [{ from: { id: 'bot' }, text: '再見！', type: 'message' }]
                  } satisfies BotResponse)
                );
              }

              postActivityObserver = jest.fn();

              shouldSetCorrelationId && getCorrelationId.mockReset().mockImplementation(() => 't-00002');
              directLineJS
                .postActivity({
                  from: { id: 'u-00001' },
                  text: 'Morning.',
                  type: 'message'
                })
                .subscribe(postActivityObserver);
            });

            describe('when 4 activities arrive', () => {
              beforeEach(async () => {
                await activitiesQueue.promise;
                await activitiesQueue.promise;
                await activitiesQueue.promise;
                await activitiesQueue.promise;
              });

              test('should call the postActivity observer', () =>
                expect(postActivityObserver).toHaveBeenCalledTimes(1));

              test('should observe the echoback activity', () =>
                expect(activitiesObserver).toHaveBeenNthCalledWith(4, {
                  from: { id: 'u-00001' },
                  id: postActivityObserver.mock.calls[0][0],
                  text: 'Morning.',
                  type: 'message'
                }));

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
                      'text/event-stream,application/json;q=0.9,*/*;q=0.8'
                    ));
                } else if (transport === 'rest') {
                  test('with header "Accept" of "application/json"', () =>
                    expect(httpPostExecute.mock.calls[0][0].request.headers.get('accept')).toBe(
                      'application/json,*/*;q=0.8'
                    ));
                }

                test('with header "Content-Type" of "application/json"', () =>
                  expect(httpPostExecute.mock.calls[0][0].request.headers.get('content-type')).toBe(
                    'application/json'
                  ));

                test('with header "x-dummy" of "dummy"', () =>
                  expect(httpPostExecute.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

                test('with header "x-ms-conversationid" of "c-00001"', () =>
                  expect(httpPostExecute.mock.calls[0][0].request.headers.get('x-ms-conversationid')).toBe('c-00001'));

                if (shouldSetCorrelationId) {
                  test('with header "x-ms-correlation-id" of "t-00002"', () =>
                    expect(httpPostExecute.mock.calls[0][0].request.headers.get('x-ms-correlation-id')).toBe(
                      't-00002'
                    ));
                } else {
                  test('without header "x-ms-correlation-id"', () =>
                    expect(httpPostExecute.mock.calls[0][0].request.headers.has('x-ms-correlation-id')).toBe(false));
                }

                test('with JSON body of activity and { dummy: "dummy" }', () =>
                  expect(httpPostExecute.mock.calls[0][0].request.json()).resolves.toEqual({
                    activity: { from: { id: 'u-00001' }, text: 'Morning.', type: 'message' },
                    dummy: 'dummy'
                  }));
              });

              test('should observe the fourth activity', () =>
                expect(activitiesObserver).toHaveBeenNthCalledWith(5, {
                  from: { id: 'bot' },
                  text: 'Good morning!',
                  type: 'message'
                }));

              if (transport === 'rest') {
                describe('should have POST to /conversations/c-00001/continue', () => {
                  test('with query "api" of "execute"', () =>
                    expect(new URL(httpPostContinue.mock.calls[2][0].request.url)).toHaveProperty(
                      'search',
                      '?api=execute'
                    ));

                  test('with hash of "#2"', () =>
                    expect(new URL(httpPostContinue.mock.calls[2][0].request.url)).toHaveProperty('hash', '#2'));

                  test('with header "Content-Type" of "application/json"', () =>
                    expect(httpPostContinue.mock.calls[2][0].request.headers.get('content-type')).toBe(
                      'application/json'
                    ));

                  test('with header "x-dummy" of "dummy"', () =>
                    expect(httpPostContinue.mock.calls[2][0].request.headers.get('x-dummy')).toBe('dummy'));

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
                      expect(httpPostContinue.mock.calls[2][0].request.headers.has('x-ms-correlation-id')).toBe(false));
                  }

                  test('with JSON body of { dummy: "dummy" }', () =>
                    expect(httpPostContinue.mock.calls[2][0].request.json()).resolves.toEqual({
                      dummy: 'dummy'
                    }));
                });
              }

              test('should observe the fifth activity', () =>
                expect(activitiesObserver).toHaveBeenNthCalledWith(6, {
                  from: { id: 'bot' },
                  text: 'Goodbye!',
                  type: 'message'
                }));

              if (transport === 'rest') {
                describe('should have POST to /conversations/c-00001/continue', () => {
                  test('twice', () => expect(httpPostContinue).toHaveBeenCalledTimes(4));

                  test('with query "api" of "execute"', () =>
                    expect(new URL(httpPostContinue.mock.calls[3][0].request.url)).toHaveProperty(
                      'search',
                      '?api=execute'
                    ));

                  test('with hash of "#2"', () =>
                    expect(new URL(httpPostContinue.mock.calls[3][0].request.url)).toHaveProperty('hash', '#2'));

                  test('with header "Content-Type" of "application/json"', () =>
                    expect(httpPostContinue.mock.calls[3][0].request.headers.get('content-type')).toBe(
                      'application/json'
                    ));

                  test('with header "x-dummy" of "dummy"', () =>
                    expect(httpPostContinue.mock.calls[3][0].request.headers.get('x-dummy')).toBe('dummy'));

                  test('with header "x-ms-conversationid" of "c-00001"', () =>
                    expect(httpPostContinue.mock.calls[3][0].request.headers.get('x-ms-conversationid')).toBe(
                      'c-00001'
                    ));

                  if (shouldSetCorrelationId) {
                    test('with header "x-ms-correlation-id" of "t-00002"', () =>
                      expect(httpPostContinue.mock.calls[3][0].request.headers.get('x-ms-correlation-id')).toBe(
                        't-00002'
                      ));
                  } else {
                    test('without header "x-ms-correlation-id"', () =>
                      expect(httpPostContinue.mock.calls[3][0].request.headers.has('x-ms-correlation-id')).toBe(false));
                  }

                  test('with JSON body of { dummy: "dummy" }', () =>
                    expect(httpPostContinue.mock.calls[3][0].request.json()).resolves.toEqual({
                      dummy: 'dummy'
                    }));
                });
              }

              test('should observe the sixth activity', () =>
                expect(activitiesObserver).toHaveBeenNthCalledWith(7, {
                  from: { id: 'bot' },
                  text: '再見！',
                  type: 'message'
                }));

              describe('when post an attachment', () => {
                let blobURL: string;
                let postActivityObserver: JestMockOf<(id: string) => void>;

                beforeEach(() => {
                  if (transport === 'auto') {
                    httpPostExecute.mockImplementationOnce(
                      () =>
                        new HttpResponse(
                          Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Got it!", "type": "message" }

event: end
data: end

`),
                          { headers: { 'content-type': 'text/event-stream' } }
                        )
                    );
                  } else if (transport === 'rest') {
                    httpPostExecute.mockImplementationOnce(() =>
                      HttpResponse.json({
                        action: 'waiting',
                        activities: [{ from: { id: 'bot' }, text: 'Got it!', type: 'message' }]
                      } satisfies BotResponse)
                    );
                  }

                  const buffer = new ArrayBuffer(3);
                  const view = new Uint8Array(buffer);

                  view.set([1, 2, 3]);

                  blobURL = URL.createObjectURL(new Blob([buffer]));
                  postActivityObserver = jest.fn();

                  directLineJS
                    .postActivity({
                      attachments: [
                        {
                          contentType: 'application/octet-stream',
                          contentUrl: blobURL
                        }
                      ],
                      from: { id: 'u-00001' },
                      text: 'Here is the document.',
                      type: 'message'
                    })
                    .subscribe(postActivityObserver);
                });

                afterEach(() => URL.revokeObjectURL(blobURL));

                describe('when activity arrive', () => {
                  beforeEach(async () => {
                    await activitiesQueue.promise; // Echo back
                    await activitiesQueue.promise; // Reply
                  });

                  test('should call the postActivity observer', () =>
                    expect(postActivityObserver).toHaveBeenCalledTimes(1));

                  test('should observe the echoback activity', () =>
                    expect(activitiesObserver).toHaveBeenNthCalledWith(8, {
                      attachments: [
                        {
                          contentType: 'application/octet-stream',
                          contentUrl: 'data:;base64,AQID'
                        }
                      ],
                      from: { id: 'u-00001' },
                      id: postActivityObserver.mock.calls[0][0],
                      text: 'Here is the document.',
                      type: 'message'
                    }));

                  describe('should have POST to /conversations/c-00001', () => {
                    test('once', () => expect(httpPostExecute).toHaveBeenCalledTimes(2));

                    test('with query "api" of "execute"', () =>
                      expect(new URL(httpPostExecute.mock.calls[1][0].request.url)).toHaveProperty(
                        'search',
                        '?api=execute'
                      ));

                    test('with hash of "#2"', () =>
                      expect(new URL(httpPostExecute.mock.calls[1][0].request.url)).toHaveProperty('hash', '#2'));

                    if (transport === 'auto') {
                      test('with header "Accept" of "text/event-stream,application/json;q=0.9"', () =>
                        expect(httpPostExecute.mock.calls[1][0].request.headers.get('accept')).toBe(
                          'text/event-stream,application/json;q=0.9,*/*;q=0.8'
                        ));
                    } else if (transport === 'rest') {
                      test('with header "Accept" of "application/json"', () =>
                        expect(httpPostExecute.mock.calls[1][0].request.headers.get('accept')).toBe(
                          'application/json,*/*;q=0.8'
                        ));
                    }

                    test('with header "Content-Type" of "application/json"', () =>
                      expect(httpPostExecute.mock.calls[1][0].request.headers.get('content-type')).toBe(
                        'application/json'
                      ));

                    test('with header "x-dummy" of "dummy"', () =>
                      expect(httpPostExecute.mock.calls[1][0].request.headers.get('x-dummy')).toBe('dummy'));

                    test('with header "x-ms-conversationid" of "c-00001"', () =>
                      expect(httpPostExecute.mock.calls[1][0].request.headers.get('x-ms-conversationid')).toBe(
                        'c-00001'
                      ));

                    if (shouldSetCorrelationId) {
                      test('with header "x-ms-correlation-id" of "t-00002"', () =>
                        expect(httpPostExecute.mock.calls[1][0].request.headers.get('x-ms-correlation-id')).toBe(
                          't-00002'
                        ));
                    } else {
                      test('without header "x-ms-correlation-id"', () =>
                        expect(httpPostExecute.mock.calls[1][0].request.headers.has('x-ms-correlation-id')).toBe(
                          false
                        ));
                    }

                    test('with JSON body of activity and { dummy: "dummy" }', () =>
                      expect(httpPostExecute.mock.calls[1][0].request.json()).resolves.toEqual({
                        activity: {
                          attachments: [{ contentType: 'application/octet-stream', contentUrl: 'data:;base64,AQID' }],
                          from: { id: 'u-00001' },
                          text: 'Here is the document.',
                          type: 'message'
                        },
                        dummy: 'dummy'
                      }));
                  });

                  test('should observe the fourth activity', () =>
                    expect(activitiesObserver).toHaveBeenNthCalledWith(9, {
                      from: { id: 'bot' },
                      text: 'Got it!',
                      type: 'message'
                    }));
                });
              });
            });
          });
        });
      });
    });
  });
});
