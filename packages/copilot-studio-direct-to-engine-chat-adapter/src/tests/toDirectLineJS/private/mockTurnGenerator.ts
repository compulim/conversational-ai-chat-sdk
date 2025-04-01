/// <reference types="jest" />

import { type ExecuteTurnFunction, type TurnGenerator } from '../../../createHalfDuplexChatAdapter';
import { type JestMockOf } from '../../../private/types/JestMockOf';
import { type Activity } from '../../../types/Activity';

function mockTurnGenerator(): {
  executeTurnCalled: Promise<void>;
  executeTurnMock: JestMockOf<ExecuteTurnFunction>;
  incomingActivitiesController: ReadableStreamDefaultController<Activity>;
  turnGenerator: TurnGenerator;
} {
  let incomingActivitiesController: ReadableStreamDefaultController<Activity> | undefined;

  const incomingActivities = new ReadableStream<Activity>({
    start(controller) {
      incomingActivitiesController = controller;
    }
  });

  if (!incomingActivitiesController) {
    throw new Error('ASSERTION ERROR: Controller should be assigned');
  }

  const executeTurnResolvers = Promise.withResolvers<void>();
  const executeTurnMock: JestMockOf<ExecuteTurnFunction> = new Proxy(jest.fn(), {
    apply(target, thisArg, argArray) {
      executeTurnResolvers.resolve();

      return target.apply(thisArg, argArray);
    }
  });

  return {
    executeTurnCalled: executeTurnResolvers.promise,
    executeTurnMock,
    incomingActivitiesController,
    turnGenerator: (async function* () {
      for await (const activity of incomingActivities) {
        yield activity;
      }

      return executeTurnMock;
    })()
  };
}

export default mockTurnGenerator;
