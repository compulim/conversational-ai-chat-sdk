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
      let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
      let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;
      let trackException: JestMockOf<Telemetry['trackException']>;

      beforeEach(() => {
        getCorrelationId = jest.fn(() => undefined);
        httpPostConversation = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
        httpPostExecute = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
        trackException = jest.fn(NOT_MOCKED<Telemetry['trackException']>);

        server.use(http.post('http://test/conversations', httpPostConversation));
        server.use(http.post('http://test/conversations/c-00001', httpPostExecute));

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
          if (transport === 'rest') {
            httpPostConversation.mockImplementationOnce(() =>
              HttpResponse.json({
                action: 'waiting',
                activities: [{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }],
                conversationId: parseConversationId('c-00001')
              } satisfies BotResponse)
            );
          } else {
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
          }

          shouldSetCorrelationId && getCorrelationId.mockImplementation(() => 't-00001');

          const startNewConversationResult = adapter.startNewConversation({ emitStartConversationEvent });

          activities = await asyncIteratorToArray(startNewConversationResult);
        });

        test('should receive greeting activities', () =>
          expect(activities).toEqual([{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }]));

        describe('when call startNewConversation again', () => {
          let startNewConversationResult: ReturnType<DirectToEngineChatAdapterAPI['startNewConversation']>;

          beforeEach(() => {
            if (transport === 'auto') {
              httpPostConversation.mockImplementationOnce(
                () =>
                  new HttpResponse(
                    Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Aloha!", "type": "message" }

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
                  activities: [{ from: { id: 'bot' }, text: 'Aloha!', type: 'message' }],
                  conversationId: parseConversationId('c-00001')
                } satisfies BotResponse)
              );
            }

            startNewConversationResult = adapter.startNewConversation({ emitStartConversationEvent });
          });

          describe('when iterate', () => {
            let iteratePromise: Promise<unknown>;

            beforeEach(async () => {
              trackException.mockImplementationOnce(() => {});

              iteratePromise = startNewConversationResult.next();

              await iteratePromise.catch(() => {});
            });

            test('should reject', () =>
              expect(iteratePromise).rejects.toThrow('startNewConversation() cannot be called more than once.'));

            describe('should call trackException', () => {
              test('once', () => expect(trackException).toHaveBeenCalledTimes(1));
              test('with arguments', () =>
                expect(trackException).toHaveBeenNthCalledWith(
                  1,
                  expect.any(Error),
                  expect.objectContaining({ handledAt: 'DirectToEngineChatAdapterAPI.startNewConversation' })
                ));
            });
          });
        });
      });
    });
  });
});
