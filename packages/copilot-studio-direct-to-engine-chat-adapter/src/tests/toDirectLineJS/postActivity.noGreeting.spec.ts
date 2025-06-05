import { type ConnectionStatus } from 'botframework-directlinejs';
import { type Observable } from 'iter-fest';

import { type TurnGenerator } from '../../createHalfDuplexChatAdapter';
import DeferredQueue from '../../private/DeferredQueue';
import { type JestMockOf } from '../../private/types/JestMockOf';
import toDirectLineJS from '../../toDirectLineJS';
import { type Activity } from '../../types/Activity';
import { type DirectLineJSBotConnection } from '../../types/DirectLineJSBotConnection';

const END_TURN = Symbol('END_TURN');

describe('with a TurnGenerator', () => {
  let activityObserver: JestMockOf<(activity: Activity) => void>;
  let connectionStatusObserver: JestMockOf<(connectionStatus: ConnectionStatus) => void>;
  let directLineJS: DirectLineJSBotConnection;
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

    directLineJS = toDirectLineJS(turnGenerator);
    directLineJS.connectionStatus$.subscribe(connectionStatusObserver);

    directLineJS.activity$.subscribe(activityObserver);
  });

  describe('should call the connectionStatus observer', () => {
    test('twice', () => expect(connectionStatusObserver).toHaveBeenCalledTimes(2));
    test('with "Uninitialized"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(1, 0));
    test('with "Connecting"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(2, 1));
  });

  describe('when an activity arrive', () => {
    beforeEach(() => incomingActivityQueue.push({ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }));

    describe('should call the connnectionStatus observer', () => {
      test('once', () => expect(connectionStatusObserver).toHaveBeenCalledTimes(3));
      test('with "Online"', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(3, 2));
    });

    describe('should call the activity observer', () => {
      test('once', () => expect(activityObserver).toHaveBeenCalledTimes(1));
      test('with the activity', () =>
        expect(activityObserver).toHaveBeenNthCalledWith(1, {
          from: { id: 'bot' },
          text: 'Hello, World!',
          type: 'message'
        }));
    });

    describe('when turn ended', () => {
      beforeEach(() => incomingActivityQueue.push(END_TURN));

      test('should not call next turn', () => expect(nextTurn).toHaveBeenCalledTimes(1));

      describe('when post activity', () => {
        let postActivityObservable: Observable<string>;

        beforeEach(() => {
          postActivityObservable = directLineJS.postActivity({
            from: { id: 'u-00001' },
            text: 'Aloha!',
            type: 'message'
          });
        });

        test('should not call next turn', () => expect(nextTurn).toHaveBeenCalledTimes(1));

        describe('when subscribe the post activity', () => {
          let postActivityObserver: JestMockOf<(id: string) => void>;

          beforeEach(() => {
            postActivityObserver = jest.fn();
            postActivityObservable.subscribe(postActivityObserver);
          });

          describe('should call next turn', () => {
            test('once', () => expect(nextTurn).toHaveBeenCalledTimes(2));
            test('with the activity', () =>
              expect(nextTurn).toHaveBeenNthCalledWith(2, {
                from: { id: 'u-00001' },
                text: 'Aloha!',
                type: 'message'
              }));
          });

          test('should not call the post activity observer', () =>
            expect(postActivityObserver).toHaveBeenCalledTimes(0));

          describe('when bot ended the turn', () => {
            beforeEach(() => incomingActivityQueue.push(END_TURN));

            test('should call the post activity observer', () => expect(postActivityObserver).toHaveBeenCalledTimes(1));

            describe('should call activity observer', () => {
              test('twice', () => expect(activityObserver).toHaveBeenCalledTimes(2));

              test('with the incoming activity', () =>
                expect(activityObserver).toHaveBeenNthCalledWith(1, {
                  from: { id: 'bot' },
                  text: 'Hello, World!',
                  type: 'message'
                }));

              test('with the outgoing activity', () =>
                expect(activityObserver).toHaveBeenNthCalledWith(2, {
                  from: { id: 'u-00001' },
                  id: postActivityObserver.mock.calls[0][0],
                  text: 'Aloha!',
                  type: 'message'
                }));
            });
          });
        });
      });
    });
  });
});
