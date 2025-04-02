import { asyncIteratorToArray } from 'iter-fest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import { type Activity } from '../../../types/Activity';
import { type Strategy } from '../../../types/Strategy';
import { type Telemetry } from '../../../types/Telemetry';
import DirectToEngineChatAdapterAPI from '../../DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPI';
import { type BotResponse } from '../../types/BotResponse';
import { parseConversationId } from '../../types/ConversationId';
import { type DefaultHttpResponseResolver } from '../../types/DefaultHttpResponseResolver';
import { type JestMockOf } from '../../types/JestMockOf';

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

        describe('when execute turn', () => {
          let executeTurnResult: ReturnType<DirectToEngineChatAdapterAPI['executeTurn']>;

          beforeEach(() => {
            executeTurnResult = adapter.executeTurn({ from: { id: 'u-00001' }, text: 'Aloha!', type: 'message' });
          });

          describe('when call executeTurn again', () => {
            let errorThrown: unknown;

            beforeEach(() => {
              trackException.mockImplementation(() => {});

              try {
                adapter.executeTurn({ from: { id: 'u-00001' }, text: 'Aloha!', type: 'message' });
              } catch (error) {
                errorThrown = error;
              }
            });

            test('should throw', () =>
              expect(() => {
                if (errorThrown) {
                  throw errorThrown;
                }
              }).toThrow('Another operation is in progress.'));

            describe('should call trackException', () => {
              test('once', () => expect(trackException).toHaveBeenCalledTimes(1));
              test('with arguments', () =>
                expect(trackException).toHaveBeenNthCalledWith(
                  1,
                  expect.any(Error),
                  expect.objectContaining({ handledAt: 'DirectToEngineChatAdapterAPI.executeTurn' })
                ));
            });

            describe('when complete iterating the first call', () => {
              let activities: Activity[];

              beforeEach(async () => {
                if (transport === 'auto') {
                  httpPostExecute.mockImplementationOnce(
                    () =>
                      new HttpResponse(
                        Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Good morning!", "type": "message" }

event: activity
data: { "from": { "id": "bot" }, "text": "Goodbye!", "type": "message" }

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
                      activities: [{ from: { id: 'bot' }, text: 'Good morning!', type: 'message' }],
                      conversationId: parseConversationId('c-00001')
                    } satisfies BotResponse)
                  );

                  httpPostContinue.mockImplementationOnce(() =>
                    HttpResponse.json({
                      action: 'waiting',
                      activities: [{ from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }],
                      conversationId: parseConversationId('c-00001')
                    } satisfies BotResponse)
                  );
                }

                activities = await asyncIteratorToArray(executeTurnResult);
              });

              test('should receive all activities', () =>
                expect(activities).toEqual([
                  { from: { id: 'bot' }, text: 'Good morning!', type: 'message' },
                  { from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }
                ]));
            });
          });
        });
      });
    });
  });
});
