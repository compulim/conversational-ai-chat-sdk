import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import createHalfDuplexChatAdapter, {
  type ExecuteTurnFunction,
  type TurnGenerator
} from '../../createHalfDuplexChatAdapter';
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

        generator = createHalfDuplexChatAdapter(strategy, {
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

      describe('When conversation started and bot returned no activities', () => {
        test('should not POST to /conversations', () => expect(httpPostConversation).toHaveBeenCalledTimes(0));

        describe('after iterate once', () => {
          let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

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

            shouldSetCorrelationId && getCorrelationId.mockImplementation(() => 't-00001');
            iteratorResult = await generator.next();
          });

          test('should complete and return the next execute function', () =>
            expect(iteratorResult).toEqual({ done: true, value: expect.any(Function) }));

          describe('when execute turn and bot returned 1 activity', () => {
            let generator: TurnGenerator;

            beforeEach(() => {
              shouldSetCorrelationId && getCorrelationId.mockReset().mockImplementation(() => 't-00002');
              generator = (iteratorResult.value as ExecuteTurnFunction)({
                from: { id: 'u-00001' },
                text: 'Hello, World!',
                type: 'message'
              });
            });

            describe('after iterate once', () => {
              let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

              beforeEach(async () => {
                if (transport === 'auto') {
                  httpPostExecute.mockImplementationOnce(
                    () =>
                      new HttpResponse(
                        Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Aloha!", "type": "message" }

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
                      activities: [{ from: { id: 'bot' }, text: 'Aloha!', type: 'message' }]
                    } satisfies BotResponse)
                  );
                }

                iteratorResult = await generator.next();
              });

              test('should have POST to /conversations/c-00001 once', () =>
                expect(httpPostExecute).toHaveBeenCalledTimes(1));

              test('should return an activity', () =>
                expect(iteratorResult).toEqual({
                  done: false,
                  value: { from: { id: 'bot' }, text: 'Aloha!', type: 'message' }
                }));

              describe('after iterate again', () => {
                let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

                beforeEach(async () => {
                  iteratorResult = await generator.next();
                });

                test('should complete', () =>
                  expect(iteratorResult).toEqual({ done: true, value: expect.any(Function) }));
              });
            });
          });
        });
      });
    });
  });
});
