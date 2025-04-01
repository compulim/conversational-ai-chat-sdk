import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import { asyncIteratorToArray } from 'iter-fest';
import { type Activity } from '../../../types/Activity';
import { type Strategy } from '../../../types/Strategy';
import { type Telemetry } from '../../../types/Telemetry';
import type DirectToEngineChatAdapterAPIClass from '../../DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPI';
import { type DirectToEngineChatAdapterAPIInit } from '../../DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPIInit';
import { type BotResponse } from '../../types/BotResponse';
import { parseConversationId } from '../../types/ConversationId';
import { type DefaultHttpResponseResolver } from '../../types/DefaultHttpResponseResolver';
import { type StartNewConversationInit } from '../../types/HalfDuplexChatAdapterAPI';
import { type JestMockOf } from '../../types/JestMockOf';

const server = setupServer();

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const NOT_MOCKED = <T extends (...args: any[]) => any>(..._: Parameters<T>): ReturnType<T> => {
  throw new Error('This function is not mocked.');
};

jest.useFakeTimers({ advanceTimers: false, now: 0 });

beforeEach(() =>
  // This will reset jest.now() back to 0 when starting each test.
  jest.clearAllTimers()
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const DirectToEngineChatAdapterAPI = jest.requireActual(
  '../../DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPI'
).default as {
  new (strategy: Strategy, init?: DirectToEngineChatAdapterAPIInit): DirectToEngineChatAdapterAPIClass;
  startNewConversation(init: StartNewConversationInit): AsyncIterableIterator<Activity>;
};

jest.setTimeout(500);

// describe.each(['auto' as const, 'rest' as const])('Using "%s" transport', transport => {
describe.each(['auto' as const])('Using "%s" transport', transport => {
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

  // describe.each([true, false])('With emitStartConversationEvent of %s', emitStartConversationEvent => {
  describe.each([true])('With emitStartConversationEvent of %s', emitStartConversationEvent => {
    describe.each([
      ['With', true]
      // ['Without', false]
    ])('%s correlation ID set', (_, shouldSetCorrelationId) => {
      let adapter: DirectToEngineChatAdapterAPIClass;
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

      describe('When conversation started and first turn completed', () => {
        let activities: Activity[];

        beforeEach(async () => {
          if (transport === 'auto') {
            httpPostConversation.mockImplementationOnce(
              () =>
                new HttpResponse(
                  Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Hello, World!", "type": "message" }

event: end
data: end

`),
                  { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
                )
            );
          } else if (transport === 'rest') {
            httpPostConversation.mockImplementationOnce(() =>
              HttpResponse.json({
                action: 'waiting',
                activities: [{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }],
                conversationId: parseConversationId('c-00001')
              } satisfies BotResponse)
            );
          }

          shouldSetCorrelationId && getCorrelationId.mockImplementation(() => 't-00001');

          const startNewConversationResult = adapter.startNewConversation({ emitStartConversationEvent });

          activities = await asyncIteratorToArray(startNewConversationResult);
        });

        test('should receive greeting activities', () =>
          expect(activities).toEqual([{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }]));

        describe('When execute turn and bot returned 429 Too Many Requests', () => {
          let executeTurnResult: ReturnType<DirectToEngineChatAdapterAPIClass['executeTurn']>;

          beforeEach(() => {
            executeTurnResult = adapter.executeTurn({
              from: { id: 'u-00001' },
              text: 'Aloha!',
              type: 'message'
            });
          });

          describe('when iterate', () => {
            let iteratorResultPromise: Promise<IteratorResult<Activity>>;

            beforeEach(() => {
              httpPostExecute.mockImplementationOnce(
                () =>
                  new HttpResponse(undefined, {
                    headers: { 'content-type': 'text/event-stream', 'retry-after': '12345' },
                    status: 429
                  })
              );

              trackException.mockImplementation(() => {});

              iteratorResultPromise = executeTurnResult.next();
            });

            test('should have POST to /conversations once', () => expect(httpPostExecute).toHaveBeenCalledTimes(1));

            describe('should POST again after 12.345 seconds', () => {
              beforeEach(async () => {
                if (transport === 'auto') {
                  httpPostExecute.mockImplementationOnce(
                    () =>
                      new HttpResponse(
                        Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Good morning.", "type": "message" }

event: end
data: end

`),
                        { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
                      )
                  );
                } else if (transport === 'rest') {
                  httpPostExecute.mockImplementationOnce(() =>
                    HttpResponse.json({
                      action: 'continue',
                      activities: [{ from: { id: 'bot' }, text: 'Good morning.', type: 'message' }],
                      conversationId: 'c-00001'
                    } satisfies BotResponse)
                  );
                }

                // Finishes the sleep inside p-retry for handling 429.
                await jest.advanceTimersToNextTimerAsync();

                // Unsure why we need to tick(1) here, otherwise, pRetry don't go to next iteration.
                await jest.advanceTimersByTimeAsync(1);
              });

              describe('should have POST to /conversations', () => {
                test('twice', () => expect(httpPostExecute).toHaveBeenCalledTimes(2));
                test('at t=12.345s', () => expect(jest.now()).toBe(12_346));
              });

              describe('after retry', () => {
                let iteratorResult: IteratorResult<Activity>;

                beforeEach(async () => {
                  iteratorResult = await iteratorResultPromise;
                });

                test('should return the first activity', () =>
                  expect(iteratorResult).toEqual({
                    done: false,
                    value: { from: { id: 'bot' }, text: 'Good morning.', type: 'message' }
                  }));
              });
            });
          });
        });
      });
    });
  });
});
