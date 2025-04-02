import { type ConnectionStatus } from 'botframework-directlinejs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import createHalfDuplexChatAdapter from '../../createHalfDuplexChatAdapter';
import DeferredQueue from '../../private/DeferredQueue';
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
      let directLineJS: DirectLineJSBotConnection;
      let getCorrelationId: JestMockOf<() => string | undefined>;
      let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
      let trackException: JestMockOf<Telemetry['trackException']>;

      beforeEach(() => {
        getCorrelationId = jest.fn(() => undefined);
        httpPostConversation = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
        trackException = jest.fn(NOT_MOCKED<Telemetry['trackException']>);

        server.use(http.post('http://test/conversations', httpPostConversation));

        const chatAdapter = createHalfDuplexChatAdapter(strategy, {
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

        directLineJS = toDirectLineJS(chatAdapter);
      });

      test('should not POST to /conversations', () => expect(httpPostConversation).toHaveBeenCalledTimes(0));

      describe('when subscribe', () => {
        let activityObserver: JestMockOf<(activity: Activity) => void>;
        let connectionStatusObserver: JestMockOf<(connectionStatus: ConnectionStatus) => void>;
        let connectionStatusQueue: DeferredQueue<ConnectionStatus>;

        beforeEach(() => {
          httpPostConversation.mockImplementationOnce(() => new HttpResponse(undefined, { status: 403 }));
          trackException.mockImplementationOnce(() => {});

          shouldSetCorrelationId && getCorrelationId.mockImplementation(() => 't-00001');
          connectionStatusQueue = new DeferredQueue();

          activityObserver = jest.fn();
          connectionStatusObserver = jest.fn(connectionStatusQueue.push.bind(connectionStatusQueue));

          directLineJS.connectionStatus$.subscribe(connectionStatusObserver);
          directLineJS.activity$.subscribe(activityObserver);
        });

        describe('wait until 3 connection statuses are observed', () => {
          beforeEach(async () => {
            trackException.mockImplementation(() => {});

            await connectionStatusQueue.promise;
            await connectionStatusQueue.promise;
            await connectionStatusQueue.promise;
          });

          describe('should call connection status observer', () => {
            test('3 times', () => expect(connectionStatusObserver).toHaveBeenCalledTimes(3));
            test('with "Uninitialized"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(1, 0));
            test('with "Connecting"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(2, 1));
            test('with "FailedToConnect"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(3, 4));
          });

          describe('should call trackException', () => {
            test('twice', () => expect(trackException).toHaveBeenCalledTimes(2));

            test('first with arguments', () =>
              expect(trackException).toHaveBeenNthCalledWith(
                1,
                expect.any(Error),
                expect.objectContaining({ handledAt: 'DirectToEngineChatAdapterAPI.#post' })
              ));

            test('second with arguments', () =>
              expect(trackException).toHaveBeenNthCalledWith(
                2,
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
