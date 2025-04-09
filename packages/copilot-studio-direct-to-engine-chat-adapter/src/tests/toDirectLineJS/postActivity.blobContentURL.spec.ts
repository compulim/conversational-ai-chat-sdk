import { waitFor } from '@testduet/wait-for';
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

  describe('when greeting turn ended', () => {
    beforeEach(() => incomingActivityQueue.push(END_TURN));

    test('should not call next turn', () => expect(nextTurn).toHaveBeenCalledTimes(1));

    describe('when post activity', () => {
      let postActivityObservable: Observable<string>;

      beforeEach(() => {
        const buffer = new ArrayBuffer(3);
        const view = new Uint8Array(buffer);

        view.set([1, 2, 3]);

        postActivityObservable = directLineJS.postActivity({
          attachments: [
            {
              contentType: 'application/octet-stream',
              contentUrl: URL.createObjectURL(new Blob([buffer], { type: 'image/png' }))
            }
          ],
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
          // After postActivity() and before nextTurn(), we will read the blob asynchronously.
          // We are using waitFor here to wait until the blob has read completed.
          beforeEach(() => waitFor(() => expect(nextTurn).toHaveBeenCalledTimes(2)));

          test('once', () => expect(nextTurn).toHaveBeenCalledTimes(2));

          test('with the attachment of ArrayBuffer', () =>
            expect(nextTurn).toHaveBeenNthCalledWith(2, {
              attachments: [
                expect.objectContaining({
                  contentType: 'application/octet-stream',
                  contentUrl: 'data:image/png;base64,AQID'
                })
              ],
              from: { id: 'u-00001' },
              text: 'Aloha!',
              type: 'message'
            }));
        });
      });
    });

    describe('when post activity with an invalid blob URL', () => {
      let postActivityObservable: Observable<string>;

      beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const buffer = new ArrayBuffer(3);
        const view = new Uint8Array(buffer);

        view.set([1, 2, 3]);

        postActivityObservable = directLineJS.postActivity({
          attachments: [{ contentType: 'application/octet-stream', contentUrl: 'blob:invalid' }],
          from: { id: 'u-00001' },
          text: 'Aloha!',
          type: 'message'
        });
      });

      afterEach(() => jest.spyOn(console, 'error').mockRestore());

      test('should not call next turn', () => expect(nextTurn).toHaveBeenCalledTimes(1));

      describe('when subscribe the post activity', () => {
        let next: JestMockOf<(id: string) => void>;
        let error: JestMockOf<(error: unknown) => void>;

        beforeEach(() => {
          error = jest.fn();
          next = jest.fn();

          postActivityObservable.subscribe({ error, next });
        });

        test('should not receive next activity ID', () => expect(next).not.toHaveBeenCalled());
        test('should reject the observable', () => expect(error).toHaveBeenCalledTimes(1));
        test('should not call executeTurn', () => expect(nextTurn).toHaveBeenCalledTimes(1));
        test('should close the connection', () => expect(connectionStatusObserver).toHaveBeenNthCalledWith(4, 4));
      });
    });
  });
});
