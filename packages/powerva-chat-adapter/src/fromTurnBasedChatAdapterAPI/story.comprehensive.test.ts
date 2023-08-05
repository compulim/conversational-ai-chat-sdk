/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 */

import { type Activity, ConnectionStatus } from 'botframework-directlinejs';
// TODO: When Jest support named export, we should shorten the path.
import { MockObserver } from 'powerva-chat-adapter-test-util';
import { DeferredPromise, ExecuteTurnContinuationAction, sleep } from 'powerva-turn-based-chat-adapter-framework';

import fromTurnBasedChatAdapterAPI from '../../src/fromTurnBasedChatAdapterAPI';

import createActivity from './private/createActivity';
import mockAPI from './private/mockAPI';

const SLEEP_INTERVAL = 10;

test('fromTurnBasedChatAdapterAPI should work', async () => {
  const {
    api,
    mock: { continueTurn, executeTurn, startNewConversation }
  } = mockAPI();

  // GIVEN: A chat adapter using ConversationTestApi.
  const adapter = fromTurnBasedChatAdapterAPI(api);

  // ---

  // GIVEN: Implementation of startNewConversation() with 2 turns.
  const pauseStartNewConversation = new DeferredPromise<void>();

  startNewConversation.mockImplementationOnce(async () => {
    await pauseStartNewConversation.promise;

    return {
      action: ExecuteTurnContinuationAction.Continue,
      activities: [createActivity('1')],
      conversationId: 'c-00001'
    };
  });

  continueTurn.mockImplementationOnce(() =>
    Promise.resolve({
      action: ExecuteTurnContinuationAction.Waiting,
      activities: [createActivity('2')]
    })
  );

  // WHEN: Connect.
  const activityObserver = new MockObserver<Activity>();
  const connectionStatusObserver = new MockObserver<ConnectionStatus>();

  adapter.connectionStatus$.subscribe(connectionStatusObserver);
  adapter.activity$.subscribe(activityObserver);
  await sleep(SLEEP_INTERVAL);

  // THEN: Should call startNewConversation().
  expect(startNewConversation).toBeCalledTimes(1);
  expect(startNewConversation).toHaveBeenNthCalledWith(
    1,
    true,
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );

  // THEN: Should observe connection status: "uninitialized", and "connecting".
  expect(connectionStatusObserver).toHaveProperty('observations', [
    ['start', expect.any(Object)],
    ['next', ConnectionStatus.Uninitialized],
    ['next', ConnectionStatus.Connecting]
  ]);

  // THEN: Should observe no activity.
  expect(activityObserver).toHaveProperty('observations', [['start', expect.any(Object)]]);

  // ---

  // WHEN: Resume.
  pauseStartNewConversation.resolve();
  await sleep(SLEEP_INTERVAL);

  // THEN: Should call continueTurn().
  expect(continueTurn).toBeCalledTimes(1);
  expect(continueTurn).toHaveBeenNthCalledWith(
    1,
    'c-00001',
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );

  // THEN: Should observe connection status: "uninitialized", and "connecting".
  expect(connectionStatusObserver).toHaveProperty('observations', [
    ['start', expect.any(Object)],
    ['next', ConnectionStatus.Uninitialized],
    ['next', ConnectionStatus.Connecting],
    ['next', ConnectionStatus.Online]
  ]);

  // THEN: Should observe activites from multiple turns.
  expect(activityObserver).toHaveProperty('observations', [
    ['start', expect.any(Object)],
    ['next', expect.objectContaining({ text: '1' })],
    ['next', expect.objectContaining({ text: '2' })]
  ]);

  // ---

  // GIVEN: Implementation of executeTurn() with 2 turns.
  const pauseExecuteTurn = new DeferredPromise<void>();

  executeTurn.mockImplementationOnce(async () => {
    await pauseExecuteTurn.promise;

    return {
      action: ExecuteTurnContinuationAction.Continue,
      activities: [createActivity('3')]
    };
  });

  continueTurn.mockImplementationOnce(() =>
    Promise.resolve({
      action: ExecuteTurnContinuationAction.Waiting,
      activities: [createActivity('4')]
    })
  );

  // ---

  // WHEN: Send an activity.
  const postActivityObserver = new MockObserver<string>();

  adapter.postActivity(createActivity('Aloha!')).subscribe(postActivityObserver);
  await sleep(SLEEP_INTERVAL);

  // THEN: Should call executeTurn().
  expect(executeTurn).toBeCalledTimes(1);
  expect(executeTurn).toHaveBeenNthCalledWith(
    1,
    'c-00001',
    expect.objectContaining({ text: 'Aloha!' }),
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );

  // THEN: Should observe no activities.
  //       The echo back should be observed with the batch from executeTurn().
  expect(activityObserver).toHaveProperty('observations', [
    ['start', expect.any(Object)],
    ['next', expect.objectContaining({ text: '1' })],
    ['next', expect.objectContaining({ text: '2' })]
  ]);

  // ---

  // WHEN: Resume.
  pauseExecuteTurn.resolve();
  await sleep(SLEEP_INTERVAL);

  // THEN: Should call continueTurn().
  expect(continueTurn).toBeCalledTimes(2);
  expect(continueTurn).toHaveBeenNthCalledWith(
    2,
    'c-00001',
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );

  // THEN: Should observe echo back activity and its replies.
  expect(activityObserver).toHaveProperty('observations', [
    ['start', expect.any(Object)],
    ['next', expect.objectContaining({ text: '1' })],
    ['next', expect.objectContaining({ text: '2' })],
    ['next', expect.objectContaining({ id: expect.any(String), text: 'Aloha!' })],
    ['next', expect.objectContaining({ text: '3' })],
    ['next', expect.objectContaining({ text: '4' })]
  ]);

  // ---

  // GIVEN: Implementation of executeTurn() without replies.
  executeTurn.mockImplementationOnce(() =>
    Promise.resolve({
      action: ExecuteTurnContinuationAction.Waiting,
      activities: []
    })
  );

  // ---

  // WHEN: Send another activity.
  const anotherPostActivityObserver = new MockObserver<string>();

  adapter.postActivity(createActivity('Hello!')).subscribe(anotherPostActivityObserver);
  await sleep(SLEEP_INTERVAL);

  // THEN: Should call executeTurn().
  expect(executeTurn).toBeCalledTimes(2);
  expect(executeTurn).toHaveBeenNthCalledWith(
    2,
    'c-00001',
    expect.objectContaining({ text: 'Hello!' }),
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );

  // THEN: Should observe echo back activity only.
  expect(activityObserver).toHaveProperty('observations', [
    ['start', expect.any(Object)],
    ['next', expect.objectContaining({ text: '1' })],
    ['next', expect.objectContaining({ text: '2' })],
    ['next', expect.objectContaining({ id: expect.any(String), text: 'Aloha!' })],
    ['next', expect.objectContaining({ text: '3' })],
    ['next', expect.objectContaining({ text: '4' })],
    ['next', expect.objectContaining({ id: expect.any(String), text: 'Hello!' })]
  ]);
});