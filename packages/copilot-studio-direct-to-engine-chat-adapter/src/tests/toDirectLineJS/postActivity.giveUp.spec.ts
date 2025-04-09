import { type ConnectionStatus } from 'botframework-directlinejs';

import { type TurnGenerator } from '../../createHalfDuplexChatAdapter';
import DeferredQueue from '../../private/DeferredQueue';
import { type JestMockOf } from '../../private/types/JestMockOf';
import toDirectLineJS from '../../toDirectLineJS';
import { type Activity } from '../../types/Activity';

const END_TURN = Symbol('END_TURN');

describe('with a TurnGenerator', () => {
  let activityObserver: JestMockOf<(activity: Activity) => void>;
  let connectionStatusObserver: JestMockOf<(connectionStatus: ConnectionStatus) => void>;
  let directLineJS: ReturnType<typeof toDirectLineJS>;
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

  describe('when greeting turn ended', () => {
    beforeEach(() => incomingActivityQueue.push(END_TURN));

    test('should not call next turn', () => expect(nextTurn).toHaveBeenCalledTimes(1));

    describe('when 1 activity iterated', () => {
      beforeEach(() =>
        incomingActivityQueue.push({ from: { id: 'bot', role: 'bot' }, text: 'Hello, World!', type: 'message' })
      );

      describe('when give up the turn', () => {
        beforeEach(() => {
          directLineJS.giveUp();
        });

        test('should call next turn', () => expect(nextTurn).toHaveBeenCalledTimes(2));

        describe('activity observer should be called', () => {
          test('once', () => expect(activityObserver).toHaveBeenCalledTimes(1));
          test('with the activity', () =>
            expect(activityObserver).toHaveBeenLastCalledWith(
              expect.objectContaining({
                from: { id: 'bot', role: 'bot' },
                text: 'Hello, World!',
                type: 'message'
              })
            ));
        });

        describe('post activity before turn has finished', () => {
          let postActivityObserver: JestMockOf<() => void>;

          beforeEach(() => {
            postActivityObserver = jest.fn();

            directLineJS
              .postActivity({ from: { id: 'user', role: 'user' }, text: 'User 1', type: 'message' })
              .subscribe(postActivityObserver);
          });

          test('should not call next turn', () => expect(nextTurn).toHaveBeenCalledTimes(2));

          describe('when turn finished', () => {
            beforeEach(() => incomingActivityQueue.push(END_TURN));

            describe('should call next turn', () => {
              test('once', () => expect(nextTurn).toHaveBeenCalledTimes(3));
              test('to post activity', () =>
                expect(nextTurn).toHaveBeenLastCalledWith({
                  from: { id: 'user', role: 'user' },
                  text: 'User 1',
                  type: 'message'
                }));
            });
          });
        });

        describe('when giveUp() is called before turn finished', () => {
          beforeEach(() => directLineJS.giveUp());

          describe('when turn finished', () => {
            beforeEach(() => incomingActivityQueue.push(END_TURN));

            test('should not call next turn', () => expect(nextTurn).toHaveBeenCalledTimes(2));

            describe('when giveUp() is called again', () => {
              beforeEach(() => directLineJS.giveUp());

              test('should call next turn', () => expect(nextTurn).toHaveBeenCalledTimes(3));
            });
          });
        });
      });
    });
  });
});
