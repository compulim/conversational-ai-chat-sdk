import { setupServer } from 'msw/node';

import { type Strategy } from '../../../types/Strategy';
import { type Telemetry } from '../../../types/Telemetry';
import DirectToEngineChatAdapterAPI from '../../DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPI';
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
  describe.each([
    ['With', true],
    ['Without', false]
  ])('%s correlation ID set', (_, shouldSetCorrelationId) => {
    describe('When call executeTurn before start new conversation', () => {
      let adapter: DirectToEngineChatAdapterAPI;
      let executeTurnResult: ReturnType<DirectToEngineChatAdapterAPI['executeTurn']>;
      let getCorrelationId: JestMockOf<() => string | undefined>;
      let trackException: JestMockOf<Telemetry['trackException']>;

      beforeEach(() => {
        const strategy: Strategy = {
          async prepareExecuteTurn() {
            return Promise.resolve({ baseURL: new URL('http://test/?api=execute#2'), transport });
          },
          async prepareStartNewConversation() {
            return Promise.resolve({ baseURL: new URL('http://test/?api=start#1'), transport });
          }
        };

        getCorrelationId = jest.fn(() => undefined);
        trackException = jest.fn(NOT_MOCKED<Telemetry['trackException']>);

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

        executeTurnResult = adapter.executeTurn({
          from: { id: 'u-00001', role: 'user' },
          text: 'Hello, World!',
          type: 'message'
        });
      });

      describe('when iterate', () => {
        let iteratePromise: Promise<unknown>;

        beforeEach(async () => {
          trackException.mockImplementationOnce(() => {});
          iteratePromise = executeTurnResult.next();

          await iteratePromise.catch(() => {});
        });

        test('should reject', () =>
          expect(iteratePromise).rejects.toThrow('startNewConversation() must be called before executeTurn().'));

        describe('should call trackException', () => {
          test('once', () => expect(trackException).toHaveBeenCalledTimes(1));
          test('with arguments', () =>
            expect(trackException).toHaveBeenNthCalledWith(
              1,
              expect.any(Error),
              expect.objectContaining({ handledAt: 'DirectToEngineChatAdapterAPI.executeTurn' })
            ));
        });
      });
    });
  });
});
