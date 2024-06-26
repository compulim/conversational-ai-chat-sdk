/** @jest-environment jsdom */

/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 */

import { type Activity, ConnectionStatus } from 'botframework-directlinejs';
import { MockObserver } from 'powerva-chat-adapter-test-util';
import { waitFor } from '@testing-library/dom';

import TestCanvasChatAdapter from '../TurnBasedChatAdapter';

import createActivity from './private/createActivity';

type StartConversation = ConstructorParameters<typeof TestCanvasChatAdapter>[0];

test('startConversation() reject should stop everything', async () => {
  const startConversation = jest.fn<ReturnType<StartConversation>, Parameters<StartConversation>>(() =>
    Promise.reject(new Error('artificial'))
  );

  // GIVEN: A connected chat adapter.
  const adapter = new TestCanvasChatAdapter(startConversation);
  const activityObserver = new MockObserver<Activity>();
  const connectionStatusObserver = new MockObserver<ConnectionStatus>();

  adapter.connectionStatus$.subscribe(connectionStatusObserver);
  adapter.activity$.subscribe(activityObserver);

  // THEN: Should call startConversation().
  await waitFor(() => expect(startConversation).toBeCalledTimes(1));

  // THEN: The adapter should end.
  await waitFor(() =>
    expect(connectionStatusObserver.observations).toEqual([
      ['start', expect.any(Object)],
      ['next', ConnectionStatus.Uninitialized],
      ['next', ConnectionStatus.Connecting],
      ['next', ConnectionStatus.FailedToConnect],
      ['complete']
    ])
  );

  // THEN: Activity should observe complete.
  await waitFor(() => expect(activityObserver.observations).toEqual([['start', expect.any(Object)], ['complete']]));

  // ---

  // WHEN: Call postActivity().
  const postActivityObserver = new MockObserver();

  adapter.postActivity(createActivity('Aloha!')).subscribe(postActivityObserver);

  // THEN: Should reject with error "artificial".
  await waitFor(() =>
    expect(postActivityObserver).toHaveProperty('observations', [
      ['start', expect.any(Object)],
      ['error', expect.any(Error)]
    ])
  );

  expect(() => {
    throw postActivityObserver.observations[1][1];
  }).toThrow('artificial');
});
