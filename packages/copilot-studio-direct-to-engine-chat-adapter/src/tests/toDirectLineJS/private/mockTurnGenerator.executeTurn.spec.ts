import { waitFor } from '@testduet/wait-for';
import { type ExecuteTurnFunction } from '../../../createHalfDuplexChatAdapter';
import { type JestMockOf } from '../../../private/types/JestMockOf';
import toDirectLineJS from '../../../toDirectLineJS';
import { type Activity } from '../../../types/Activity';
import { type DirectLineJSBotConnection } from '../../../types/DirectLineJSBotConnection';
import mockTurnGenerator, { type MockedTurn } from './mockTurnGenerator';

describe('with a TurnGenerator', () => {
  let activitySubscriber: JestMockOf<(activity: Activity) => void>;
  let directLineJS: DirectLineJSBotConnection;
  let executeTurnMock: JestMockOf<ExecuteTurnFunction>;
  let mockedTurns: MockedTurn[];

  beforeEach(() => {
    ({ executeTurnMock, mockedTurns } = mockTurnGenerator());

    activitySubscriber = jest.fn();

    directLineJS = toDirectLineJS(mockedTurns[0].turnGenerator);
    directLineJS.activity$.subscribe(activitySubscriber);
  });

  describe('when first turn done', () => {
    beforeEach(() => {
      mockedTurns[0].incomingActivitiesController.close();
    });

    describe('when posting an activity', () => {
      let postActivitySubscriber: JestMockOf<(activityId: string) => void>;

      beforeEach(async () => {
        postActivitySubscriber = jest.fn();

        directLineJS
          .postActivity({
            from: { id: 'user', role: 'user' },
            text: 'Hello, World!',
            type: 'message'
          })
          .subscribe(postActivitySubscriber);
      });

      describe('after turn started', () => {
        beforeEach(() => waitFor(() => expect(executeTurnMock).toHaveBeenCalledTimes(2)));

        test('executeTurn() should be called with the activity', () => {
          expect(executeTurnMock).toHaveBeenNthCalledWith(2, {
            from: { id: 'user', role: 'user' },
            text: 'Hello, World!',
            type: 'message'
          });
        });

        describe('close the second turn stream to signal postActivity succeeded', () => {
          beforeEach(() => mockedTurns[1].incomingActivitiesController.close());

          test('postActivity should return ID', () => expect(postActivitySubscriber).toHaveBeenCalledTimes(1));
        });
      });
    });
  });
});
