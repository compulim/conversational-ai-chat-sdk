/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 */

import { extendToBePending } from 'powerva-chat-adapter-test-util';

import sleep from './sleep';

beforeAll(extendToBePending);

beforeEach(() => jest.useFakeTimers({ now: 0 }));

afterEach(() => jest.useRealTimers());

describe('sleep for 2 seconds', () => {
  let promise: Promise<void>;

  beforeEach(() => {
    promise = sleep(2_000);
  });

  test('should be pending', () => Promise.all([expect(promise).toBePending(), () => jest.runAllTimersAsync()]));

  describe('after 2 seconds', () => {
    beforeEach(() => jest.advanceTimersByTimeAsync(2_000));

    test('should be resolved', () => expect(promise).resolves.toBeUndefined());
    test('Date.now() should be 2_000', () => expect(+new Date()).toBe(2_000));
  });
});
