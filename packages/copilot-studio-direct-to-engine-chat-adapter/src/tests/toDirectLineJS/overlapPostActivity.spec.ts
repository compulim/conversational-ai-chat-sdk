import { type ConnectionStatus } from 'botframework-directlinejs';

import { type TurnGenerator } from '../../createHalfDuplexChatAdapter';
import { type JestMockOf } from '../../private/types/JestMockOf';
import promiseWithResolvers, { type PromiseWithResolvers } from '../../private/promiseWithResolvers';
import toDirectLineJS from '../../toDirectLineJS';
import { type Activity } from '../../types/Activity';
import { type DirectLineJSBotConnection } from '../../types/DirectLineJSBotConnection';

const END_TURN = Symbol('END_TURN');

describe('with a TurnGenerator', () => {
  let activityObserver: JestMockOf<(activity: Activity) => void>;
  let connectionStatusObserver: JestMockOf<(connectionStatus: ConnectionStatus) => void>;
  let directLineJS: DirectLineJSBotConnection;
  let incomingActivityDeferred: PromiseWithResolvers<Activity | typeof END_TURN>;
  let turnGenerator: TurnGenerator;
  let nextTurn: JestMockOf<(activity?: Activity | undefined) => TurnGenerator>;

  beforeEach(() => {
    nextTurn = jest.fn<TurnGenerator, [Activity | undefined]>(() => {
      return (async function* () {
        for (;;) {
          incomingActivityDeferred = promiseWithResolvers();

          const activity = await incomingActivityDeferred.promise;

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

  describe('when an activity arrive', () => {
    beforeEach(() => {
      incomingActivityDeferred.resolve({ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' });
    });

    test('should call the activity observer', () => expect(activityObserver).toHaveBeenCalledTimes(1));

    describe('when post activity', () => {
      let firstPostActivityObserver: JestMockOf<(id: string) => void>;

      beforeEach(() => {
        firstPostActivityObserver = jest.fn();

        directLineJS
          .postActivity({
            from: { id: 'u-00001' },
            text: 'Aloha!',
            type: 'message'
          })
          .subscribe(firstPostActivityObserver);
      });

      test('should not call next turn', () => expect(nextTurn).toHaveBeenCalledTimes(1));

      describe('when post activity again', () => {
        let secondPostActivityObserver: JestMockOf<(id: string) => void>;

        beforeEach(() => {
          secondPostActivityObserver = jest.fn();

          directLineJS
            .postActivity({
              from: { id: 'u-00001' },
              text: 'Morning.',
              type: 'message'
            })
            .subscribe(secondPostActivityObserver);
        });

        describe('when turn ended', () => {
          beforeEach(() => incomingActivityDeferred.resolve(END_TURN));

          test('should not call the first post activity observer', () =>
            expect(firstPostActivityObserver).toHaveBeenCalledTimes(0));
          test('should not call the second post activity observer', () =>
            expect(secondPostActivityObserver).toHaveBeenCalledTimes(0));

          describe('when receive activity', () => {
            beforeEach(() =>
              incomingActivityDeferred.resolve({ from: { id: 'bot' }, text: 'Goodbye.', type: 'message' })
            );

            test('should call the first post activity observer', () =>
              expect(firstPostActivityObserver).toHaveBeenCalledTimes(1));
            test('should not call the second post activity observer', () =>
              expect(secondPostActivityObserver).toHaveBeenCalledTimes(0));

            describe('should call the activity observer', () => {
              test('twice', () => expect(activityObserver).toHaveBeenCalledTimes(3));
              test('with the first outgoing activity', () =>
                expect(activityObserver).toHaveBeenNthCalledWith(2, {
                  from: { id: 'u-00001' },
                  id: firstPostActivityObserver.mock.calls[0][0],
                  text: 'Aloha!',
                  type: 'message'
                }));
              test('with the incoming activity', () =>
                expect(activityObserver).toHaveBeenNthCalledWith(3, {
                  from: { id: 'bot' },
                  text: 'Goodbye.',
                  type: 'message'
                }));
            });
          });
        });
      });
    });
  });
});
