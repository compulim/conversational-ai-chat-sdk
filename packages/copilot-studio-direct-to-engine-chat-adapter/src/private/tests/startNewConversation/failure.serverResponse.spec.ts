import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import { type Strategy } from '../../../types/Strategy';
import { type Telemetry } from '../../../types/Telemetry';
import DirectToEngineChatAdapterAPI from '../../DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPI';
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
      describe.each([
        ['server closed connection', HttpResponse.error(), { expectedNumCalled: 5 }],
        ['server returned 400', new HttpResponse(undefined, { status: 400 }), { expectedNumCalled: 1 }],
        ['server returned 500', new HttpResponse(undefined, { status: 500 }), { expectedNumCalled: 5 }]
      ])('when conversation started and %s', (type, response, { expectedNumCalled }) => {
        let adapter: DirectToEngineChatAdapterAPI;
        let getCorrelationId: JestMockOf<() => string | undefined>;
        let httpPostConversations: JestMockOf<DefaultHttpResponseResolver>;
        let startNewConversationResult: ReturnType<DirectToEngineChatAdapterAPI['startNewConversation']>;
        let trackException: JestMockOf<Telemetry['trackException']>;

        beforeEach(() => {
          getCorrelationId = jest.fn(() => undefined);
          httpPostConversations = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
          trackException = jest.fn(NOT_MOCKED<Telemetry['trackException']>);

          server.use(http.post('http://test/conversations', httpPostConversations));

          adapter = new DirectToEngineChatAdapterAPI(strategy, {
            retry: { factor: 1, minTimeout: 0 },
            telemetry: {
              get correlationId() {
                return getCorrelationId();
              },
              trackException
            }
          });

          shouldSetCorrelationId && getCorrelationId.mockImplementation(() => 't-00001');
          startNewConversationResult = adapter.startNewConversation({ emitStartConversationEvent });
        });

        describe('when iterate', () => {
          let iteratePromise: Promise<unknown>;

          beforeEach(async () => {
            httpPostConversations.mockImplementationOnce(() => response);
            trackException.mockImplementation(() => {});

            iteratePromise = startNewConversationResult.next();

            await iteratePromise.catch(() => {});
          });

          test(`should have POST to /conversations ${
            expectedNumCalled === 1 ? 'once' : `${expectedNumCalled} times`
          }`, () => expect(httpPostConversations).toHaveBeenCalledTimes(expectedNumCalled));

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
