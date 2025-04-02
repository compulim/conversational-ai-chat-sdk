/// <reference types="jest" />

import { type ExecuteTurnFunction, type TurnGenerator } from '../../../createHalfDuplexChatAdapter';
import createReadableStreamWithController from '../../../private/createReadableStreamWithController';
import { type JestMockOf } from '../../../private/types/JestMockOf';
import { type Activity } from '../../../types/Activity';

type MockedTurn = {
  incomingActivitiesController: ReadableStreamDefaultController<Activity>;
  turnGenerator: TurnGenerator;
};

function mockTurnGenerator(): {
  executeTurnMock: JestMockOf<ExecuteTurnFunction>;
  mockedTurns: MockedTurn[];
} {
  const mockedTurns: MockedTurn[] = [];

  const executeTurnMock: JestMockOf<ExecuteTurnFunction> = jest.fn().mockImplementation(() => {
    const { controller: incomingActivitiesController, readableStream } = createReadableStreamWithController<Activity>();

    const turnGenerator = (async function* () {
      for await (const activity of readableStream) {
        yield activity;
      }

      return executeTurnMock;
    })();

    mockedTurns.push({
      incomingActivitiesController,
      turnGenerator
    });

    return turnGenerator;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executeTurnMock(undefined as any);

  return {
    executeTurnMock,
    mockedTurns
  };
}

export default mockTurnGenerator;

export { type MockedTurn };
