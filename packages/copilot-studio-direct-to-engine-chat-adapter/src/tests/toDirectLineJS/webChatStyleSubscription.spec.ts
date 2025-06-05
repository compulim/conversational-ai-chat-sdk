import { type ConnectionStatus } from 'botframework-directlinejs';

import { type TurnGenerator } from '../../createHalfDuplexChatAdapter';
import DeferredQueue from '../../private/DeferredQueue';
import promiseWithResolvers, { PromiseWithResolvers } from '../../private/promiseWithResolvers';
import { type JestMockOf } from '../../private/types/JestMockOf';
import toDirectLineJS from '../../toDirectLineJS';
import { type Activity } from '../../types/Activity';
import { type DirectLineJSBotConnection } from '../../types/DirectLineJSBotConnection';

const END_TURN = Symbol('END_TURN');

describe('with a TurnGenerator', () => {
  let activityObserver: JestMockOf<(activity: Activity) => void>;
  let connectionStatusObserver: JestMockOf<(connectionStatus: ConnectionStatus) => void>;
  let incomingActivityQueue: DeferredQueue<Activity | typeof END_TURN>;
  let turnGenerator: TurnGenerator;
  let nextTurn: JestMockOf<(activity?: Activity | undefined) => TurnGenerator>;

  beforeEach(() => {
    incomingActivityQueue = new DeferredQueue();

    nextTurn = jest.fn<TurnGenerator, [Activity | undefined]>(() => {
      return (async function* () {
        for (;;) {
          const activity = await incomingActivityQueue.promise;

          if (activity === END_TURN) {
            break;
          } else {
            yield activity;
          }
        }

        return nextTurn;
      })();
    });

    turnGenerator = nextTurn();

    activityObserver = jest.fn();
    connectionStatusObserver = jest.fn();
  });

  describe('when kick off connection by subscribing to activity observable', () => {
    let directLineJS: DirectLineJSBotConnection;
    let waitUntilGreetingReceived: PromiseWithResolvers<void>;

    beforeEach(() => {
      waitUntilGreetingReceived = promiseWithResolvers();

      directLineJS = toDirectLineJS(turnGenerator);

      // Web Chat subscribes to activity observable again when signaled by "Online".
      directLineJS.connectionStatus$.subscribe(
        connectionStatusObserver.mockImplementation(
          connectionStatus =>
            connectionStatus === 2 &&
            directLineJS.activity$.subscribe(
              activityObserver.mockImplementation(() => waitUntilGreetingReceived.resolve())
            )
        )
      );

      incomingActivityQueue.push({ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' });

      // This will kick off the connection.
      directLineJS.activity$.subscribe(jest.fn());
    });

    describe('should call the connectionStatus observer', () => {
      test('3 times', () => expect(connectionStatusObserver).toHaveBeenCalledTimes(3));
      test('with "Uninitialized"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(1, 0));
      test('with "Connecting"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(2, 1));
      test('with "Online"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(3, 2));
    });

    test('should receive first activity', async () => {
      await waitUntilGreetingReceived.promise;

      expect(activityObserver).toHaveBeenNthCalledWith(1, {
        from: { id: 'bot' },
        text: 'Hello, World!',
        type: 'message'
      });
    });
  });
});
