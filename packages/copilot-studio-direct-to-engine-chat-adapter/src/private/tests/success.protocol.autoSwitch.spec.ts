import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import { type Activity } from '../../types/Activity';
import { type Strategy } from '../../types/Strategy';
import { type Telemetry } from '../../types/Telemetry';
import DirectToEngineChatAdapterAPI from '../DirectToEngineChatAdapterAPI';
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

let strategy: Strategy;

beforeEach(() => {
  strategy = {
    async prepareExecuteTurn() {
      return Promise.resolve({
        baseURL: new URL('http://test/?api=execute#2'),
        body: { dummy: 'dummy' },
        headers: new Headers({ 'x-dummy': 'dummy' }),
        transport: 'auto'
      });
    },
    async prepareStartNewConversation() {
      return Promise.resolve({
        baseURL: new URL('http://test/?api=start#1'),
        body: { dummy: 'dummy' },
        headers: new Headers({ 'x-dummy': 'dummy' }),
        transport: 'auto'
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

    describe('When conversation started and bot returned with 1 activity over SSE', () => {
      let startNewConversationResult: ReturnType<DirectToEngineChatAdapterAPI['startNewConversation']>;

      beforeEach(() => {
        shouldSetCorrelationId && getCorrelationId.mockImplementation(() => 't-00001');
        startNewConversationResult = adapter.startNewConversation({ emitStartConversationEvent });
      });

      describe('after iterate once', () => {
        let iteratorResult: IteratorResult<Activity>;

        beforeEach(async () => {
          httpPostConversation.mockImplementationOnce(
            () =>
              new HttpResponse(
                Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "id": "a-00001", "text": "Hello, World!", "type": "message" }

event: end
data: end

`),
                { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
              )
          );

          iteratorResult = await startNewConversationResult.next();
        });

        describe('should have POST to /conversations', () => {
          test('once', () => expect(httpPostConversation).toHaveBeenCalledTimes(1));
          test('with header "Accept" of "text/event-stream,application/json;q=0.9"', () =>
            expect(httpPostConversation.mock.calls[0][0].request.headers.get('accept')).toBe(
              'text/event-stream,application/json;q=0.9'
            ));
        });

        test('should return the first activity', () =>
          expect(iteratorResult).toEqual({
            done: false,
            value: { from: { id: 'bot' }, id: 'a-00001', text: 'Hello, World!', type: 'message' }
          }));

        describe('after iterate twice', () => {
          let iteratorResult: IteratorResult<Activity>;

          beforeEach(async () => {
            iteratorResult = await startNewConversationResult.next();
          });

          test('should complete', () => expect(iteratorResult).toEqual({ done: true, value: undefined }));

          describe('when execute turn and bot returned 1 activity over REST', () => {
            let executeTurnResult: ReturnType<DirectToEngineChatAdapterAPI['executeTurn']>;

            beforeEach(() => {
              executeTurnResult = adapter.executeTurn({
                from: { id: 'u-00001' },
                text: 'Morning.',
                type: 'message'
              });
            });

            describe('after iterate once', () => {
              let iteratorResult: IteratorResult<Activity>;

              beforeEach(async () => {
                httpPostExecute.mockImplementationOnce(() =>
                  HttpResponse.json({
                    action: 'continue',
                    activities: [{ from: { id: 'bot' }, text: 'Aloha!', type: 'message' }],
                    conversationId: parseConversationId('c-00001')
                  } satisfies BotResponse)
                );

                iteratorResult = await executeTurnResult.next();
              });

              describe('should have POST to /conversations/c-00001', () => {
                test('once', () => expect(httpPostConversation).toHaveBeenCalledTimes(1));
                test('with header "Accept" of "text/event-stream,application/json;q=0.9"', () =>
                  expect(httpPostConversation.mock.calls[0][0].request.headers.get('accept')).toBe(
                    'text/event-stream,application/json;q=0.9'
                  ));
              });

              test('should return the second activity', () =>
                expect(iteratorResult).toEqual({
                  done: false,
                  value: { from: { id: 'bot' }, text: 'Aloha!', type: 'message' }
                }));

              describe('after iterate the third time', () => {
                let iteratorResult: IteratorResult<Activity>;

                beforeEach(async () => {
                  httpPostContinue.mockImplementationOnce(() =>
                    HttpResponse.json({
                      action: 'waiting',
                      activities: [{ from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }]
                    } satisfies BotResponse)
                  );

                  iteratorResult = await executeTurnResult.next();
                });

                describe('should have POST to /conversations/c-00001/continue', () => {
                  test('once', () => expect(httpPostConversation).toHaveBeenCalledTimes(1));
                  test('with header "Accept" of "text/event-stream,application/json;q=0.9"', () =>
                    expect(httpPostConversation.mock.calls[0][0].request.headers.get('accept')).toBe(
                      'text/event-stream,application/json;q=0.9'
                    ));
                });

                test('should return the third activity', () =>
                  expect(iteratorResult).toEqual({
                    done: false,
                    value: { from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }
                  }));

                describe('after iterate the third time', () => {
                  let iteratorResult: IteratorResult<Activity>;

                  beforeEach(async () => {
                    iteratorResult = await executeTurnResult.next();
                  });

                  test('should complete', () => expect(iteratorResult).toEqual({ done: true, value: undefined }));
                });
              });
            });
          });
        });
      });
    });
  });
});
