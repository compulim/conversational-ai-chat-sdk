import { type ConnectionStatus } from 'botframework-directlinejs';

import { type JestMockOf } from '../../private/types/JestMockOf';
import toDirectLineJS from '../../toDirectLineJS';
import { type Activity } from '../../types/Activity';

beforeAll(() => jest.spyOn(console, 'error').mockReturnValue());
afterAll(() => jest.restoreAllMocks());

describe('with a TurnGenerator that emit error on next()', () => {
  let activityObserver: JestMockOf<(activity: Activity) => void>;
  let connectionStatusObserver: JestMockOf<(connectionStatus: ConnectionStatus) => void>;
  let directLineJS: ReturnType<typeof toDirectLineJS>;

  beforeEach(() => {
    activityObserver = jest.fn();
    connectionStatusObserver = jest.fn();

    directLineJS = toDirectLineJS(
      // eslint-disable-next-line require-yield
      (async function* () {
        // First turn is fine, but fail on second turn.
        // eslint-disable-next-line require-yield
        return async function* () {
          throw new Error('Artificial error');
        };
      })()
    );
    directLineJS.connectionStatus$.subscribe(connectionStatusObserver);

    directLineJS.activity$.subscribe(activityObserver);
  });

  describe('when posting an activity', () => {
    let postActivityError: JestMockOf<() => void>;
    let postActivityNext: JestMockOf<() => void>;

    beforeEach(() => {
      postActivityError = jest.fn();
      postActivityNext = jest.fn();

      directLineJS
        .postActivity({
          from: { id: 'user' },
          text: 'Hello, World!',
          type: 'message'
        })
        .subscribe({ error: postActivityError, next: postActivityNext });
    });

    test('connectionStatus$ should be 4 (offline)', () => expect(connectionStatusObserver).toHaveBeenLastCalledWith(4));
    test('should not call postActivity.next()', () => expect(postActivityNext).not.toBeCalled());

    describe('should call postActivity.error()', () => {
      test('once', () => expect(postActivityError).toBeCalledTimes(1));
      test('with the error', () => expect(postActivityError).toHaveBeenNthCalledWith(1, new Error('Artificial error')));
    });
  });
});
