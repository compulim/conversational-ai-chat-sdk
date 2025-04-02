import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import createHalfDuplexChatAdapter, {
  type ExecuteTurnFunction,
  type TurnGenerator
} from '../../createHalfDuplexChatAdapter';
import asyncGeneratorToArray from '../../private/asyncGeneratorToArray';
import { type BotResponse } from '../../private/types/BotResponse';
import { parseConversationId } from '../../private/types/ConversationId';
import { type DefaultHttpResponseResolver } from '../../private/types/DefaultHttpResponseResolver';
import { type JestMockOf } from '../../private/types/JestMockOf';
import { type Activity } from '../../types/Activity';
import { type Strategy } from '../../types/Strategy';
import { type Telemetry } from '../../types/Telemetry';

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
      let generator: TurnGenerator;
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

        generator = createHalfDuplexChatAdapter(strategy, {
          emitStartConversationEvent,
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
        let executeTurn: ExecuteTurnFunction;

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
          [activities, executeTurn] = await asyncGeneratorToArray(generator);
        });

        test('should receive greeting activities', () =>
          expect(activities).toEqual([{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }]));

        describe.each([
          ['server closed connection', HttpResponse.error(), { expectedNumCalled: 5 }],
          ['server returned 400', new HttpResponse(undefined, { status: 400 }), { expectedNumCalled: 1 }],
          ['server returned 500', new HttpResponse(undefined, { status: 500 }), { expectedNumCalled: 5 }]
        ])('when execute turn and %s', (type, response, { expectedNumCalled }) => {
          let generator: TurnGenerator;

          beforeEach(() => {
            generator = executeTurn({
              from: { id: 'u-00001' },
              text: 'Aloha!',
              type: 'message'
            });
          });

          describe('when iterate', () => {
            let iteratePromise: Promise<unknown>;

            beforeEach(async () => {
              httpPostExecute.mockImplementationOnce(() => response);
              trackException.mockImplementation(() => {});

              iteratePromise = generator.next();

              await iteratePromise.catch(() => {});
            });

            test(`should have POST to /conversations ${
              expectedNumCalled === 1 ? 'once' : `${expectedNumCalled} times`
            }`, () => expect(httpPostExecute).toHaveBeenCalledTimes(expectedNumCalled));

            test('should reject', () => expect(iteratePromise).rejects.toThrow());

            describe('should call trackException', () => {
              if (type === 'server closed connection') {
                test(`once`, () => expect(trackException).toHaveBeenCalledTimes(1));
              } else {
                test(`twice`, () => expect(trackException).toHaveBeenCalledTimes(2));

                test('first with arguments', () =>
                  expect(trackException).toHaveBeenNthCalledWith(
                    1,
                    expect.any(Error),
                    expect.objectContaining({ handledAt: 'DirectToEngineChatAdapterAPI.#post' })
                  ));
              }

              test('last with arguments', () =>
                expect(trackException).toHaveBeenLastCalledWith(
                  expect.any(Error),
                  expect.objectContaining({
                    handledAt: 'DirectToEngineChatAdapterAPI.withRetries',
                    retryCount: '5'
                  })
                ));
            });
          });
        });
      });
    });
  });
});
