import { type JestMockOf } from '../../../private/types/JestMockOf';
import toDirectLineJS from '../../../toDirectLineJS';
import { type Activity } from '../../../types/Activity';
import { type DirectLineJSBotConnection } from '../../../types/DirectLineJSBotConnection';
import mockTurnGenerator, { type MockedTurn } from './mockTurnGenerator';

describe('with a TurnGenerator', () => {
  let activitySubscriber: JestMockOf<(activity: Activity) => void>;
  let directLineJS: DirectLineJSBotConnection;
  let mockedTurns: MockedTurn[];

  beforeEach(() => {
    ({ mockedTurns } = mockTurnGenerator());

    activitySubscriber = jest.fn();

    directLineJS = toDirectLineJS(mockedTurns[0].turnGenerator);
    directLineJS.activity$.subscribe(activitySubscriber);
  });

  describe('when one activity arrives', () => {
    beforeEach(() => {
      mockedTurns[0].incomingActivitiesController.enqueue({
        from: { id: 'bot', role: 'bot' },
        text: 'Hello, World!',
        type: 'message'
      });

      mockedTurns[0].incomingActivitiesController.close();
    });

    describe('should observe', () => {
      test('once', () => expect(activitySubscriber).toHaveBeenCalledTimes(1));
      test('the activity', () =>
        expect(activitySubscriber).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            from: { id: 'bot', role: 'bot' },
            text: 'Hello, World!',
            type: 'message'
          })
        ));
    });
  });
});
