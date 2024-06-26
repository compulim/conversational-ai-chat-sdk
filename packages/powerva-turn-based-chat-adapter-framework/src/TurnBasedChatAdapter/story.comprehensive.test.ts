/** @jest-environment jsdom */

/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 */

import { type Activity } from 'botframework-directlinejs';
import { MockObserver } from 'powerva-chat-adapter-test-util';
import { waitFor } from '@testing-library/dom';

import DeferredPromise from '../DeferredPromise';
import TestCanvasChatAdapter from '../TurnBasedChatAdapter';

import createActivity from './private/createActivity';

test('execute turn with multiple continue should returns activities from all turns', async () => {
  const startConversationDeferred = new DeferredPromise<void>();
  const rounds = [new DeferredPromise<void>(), new DeferredPromise<void>()];
  const execute = jest.fn<{ activities: AsyncIterableIterator<Activity[]>; activityID: Promise<string> }, [Activity]>();

  execute.mockImplementationOnce(activity => ({
    activities: (async function* (): AsyncIterableIterator<Activity[]> {
      await rounds[0].promise;

      yield [{ ...activity, id: 'a-00001' }, createActivity('2')];

      await rounds[1].promise;

      yield [createActivity('3'), createActivity('4')];
      yield [createActivity('5')];
    })(),
    activityID: rounds[0].promise.then(() => 'a-00001')
  }));

  execute.mockImplementationOnce(activity => ({
    activities: (async function* (): AsyncIterableIterator<Activity[]> {
      yield [{ ...activity, id: 'a-00002' }, createActivity('6')];
    })(),
    activityID: Promise.resolve('a-00002')
  }));

  const startConversation = jest.fn<
    ReturnType<ConstructorParameters<typeof TestCanvasChatAdapter>[0]>,
    [{ signal: AbortSignal }]
  >(async () => ({
    execute,
    initialActivities: (async function* () {
      yield [createActivity('0')];

      await startConversationDeferred.promise;

      yield [createActivity('1')];
    })()
  }));

  // GIVEN: A chat adapter.
  const adapter = new TestCanvasChatAdapter(startConversation);
  const activityObserver = new MockObserver<Activity>();

  // THEN: It should not call startConversation initially.
  await waitFor(() => expect(startConversation).toHaveBeenCalledTimes(0));

  // WHEN: Subscribed to activity$ observable.
  adapter.activity$.subscribe(activityObserver);

  // THEN: It should call startConversation once.
  await waitFor(() => expect(startConversation).toHaveBeenCalledTimes(1));

  // THEN: It should observe the first iteration of initial set of activities.
  await waitFor(() =>
    expect(activityObserver.observations).toEqual([
      ['start', expect.any(Object)],
      ['next', expect.objectContaining({ text: '0' })]
    ])
  );

  // WHEN: startConversation() call is resumed.
  startConversationDeferred.resolve();

  // THEN: It should observe the final iteration of initial set of activities.
  await waitFor(() =>
    expect(activityObserver.observations).toEqual([
      ['start', expect.any(Object)],
      ['next', expect.objectContaining({ text: '0' })],
      ['next', expect.objectContaining({ text: '1' })]
    ])
  );

  // WHEN: postActivity() is called.
  const postActivityObserver = new MockObserver<string>();

  adapter.postActivity(createActivity('Aloha!')).subscribe(postActivityObserver);

  // THEN: It should call execute().
  await waitFor(() => expect(execute).toBeCalledTimes(1));
  await waitFor(() => expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'Aloha!' })));

  // THEN: The postActivity() should not be resolved yet.
  await waitFor(() => expect(postActivityObserver).toHaveProperty('observations', [['start', expect.any(Object)]]));

  // THEN: No echo back yet (until first round is completed).
  await waitFor(() =>
    expect(activityObserver.observations).toEqual([
      ['start', expect.any(Object)],
      ['next', expect.objectContaining({ text: '0' })],
      ['next', expect.objectContaining({ text: '1' })]
    ])
  );

  // WHEN: First round is done.
  rounds[0].resolve();

  // THEN: The postActivity() should be resolved.
  await waitFor(() =>
    expect(postActivityObserver).toHaveProperty('observations', [
      ['start', expect.any(Object)],
      ['next', 'a-00001'],
      ['complete']
    ])
  );

  // THEN: It should observe echo back and activities from first round.
  await waitFor(() =>
    expect(activityObserver.observations).toEqual([
      ['start', expect.any(Object)],
      ['next', expect.objectContaining({ text: '0' })],
      ['next', expect.objectContaining({ text: '1' })],
      ['next', expect.objectContaining({ id: 'a-00001', text: 'Aloha!' })],
      ['next', expect.objectContaining({ text: '2' })]
    ])
  );

  // WHEN: Second round is done.
  rounds[1].resolve();

  // THEN: It should observe activities from second round.
  await waitFor(() =>
    expect(activityObserver.observations).toEqual([
      ['start', expect.any(Object)],
      ['next', expect.objectContaining({ text: '0' })],
      ['next', expect.objectContaining({ text: '1' })],
      ['next', expect.objectContaining({ id: 'a-00001', text: 'Aloha!' })],
      ['next', expect.objectContaining({ text: '2' })],
      ['next', expect.objectContaining({ text: '3' })],
      ['next', expect.objectContaining({ text: '4' })],
      ['next', expect.objectContaining({ text: '5' })]
    ])
  );

  // THEN: It should free up for another postActivity() call.
  const anotherPostActivityObserver = new MockObserver<string>();

  adapter.postActivity(createActivity('Hello!')).subscribe(anotherPostActivityObserver);

  // THEN: It should call execute() again.
  await waitFor(() => expect(execute).toBeCalledTimes(2));
  await waitFor(() => expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: 'Hello!' })));

  // THEN: The postActivity() should be resolved.
  await waitFor(() =>
    expect(anotherPostActivityObserver).toHaveProperty('observations', [
      ['start', expect.any(Object)],
      ['next', 'a-00002'],
      ['complete']
    ])
  );

  // THEN: It should receive echo back and a new activity.
  await waitFor(() =>
    expect(activityObserver.observations).toEqual([
      ['start', expect.any(Object)],
      ['next', expect.objectContaining({ text: '0' })],
      ['next', expect.objectContaining({ text: '1' })],
      ['next', expect.objectContaining({ id: 'a-00001', text: 'Aloha!' })],
      ['next', expect.objectContaining({ text: '2' })],
      ['next', expect.objectContaining({ text: '3' })],
      ['next', expect.objectContaining({ text: '4' })],
      ['next', expect.objectContaining({ text: '5' })],
      ['next', expect.objectContaining({ id: 'a-00002', text: 'Hello!' })],
      ['next', expect.objectContaining({ text: '6' })]
    ])
  );
});
