import {
  boolean,
  custom,
  function_,
  instance,
  number,
  object,
  optional,
  pipe,
  readonly,
  transform,
  type InferInput
} from 'valibot';

import type { Telemetry } from '../../types/Telemetry';
import { DEFAULT_RETRY_COUNT } from './private/Constants';

const directToEngineChatAdapterAPIInitSchema = pipe(
  object({
    retry: optional(
      pipe(
        object({
          factor: optional(number('"retry.factory" must be a number')),
          minTimeout: optional(number('"retry.minTimeout" must be a number')),
          maxTimeout: optional(number('"retry.maxTimeout" must be a number')),
          randomize: optional(boolean('"retry.randomize" must be a boolean')),
          retries: optional(number('"retry.retries" must be a number'), DEFAULT_RETRY_COUNT)
        }),
        readonly()
      ),
      { retries: DEFAULT_RETRY_COUNT }
    ),
    signal: optional(instance(AbortSignal, '"signal" must be of type AbortSignal')),
    telemetry: optional(
      // `correlationId` is a getter and it would be taken out by valibot.
      // any()
      pipe(
        object(
          {
            getCorrelationId: optional(
              pipe(
                function_(),
                transform(value => value as () => string | undefined)
              )
            ),
            trackException: optional(
              pipe(
                custom(value => typeof value === 'function', '"telemetry.trackException" must be a function'),
                transform(value => value as Telemetry['trackException'])
              )
            )
          },
          '"telemetry" must be an object'
        ),
        readonly(),
        transform(value => value as Telemetry)
      )
    )
  }),
  readonly()
);

type DirectToEngineChatAdapterAPIInit = InferInput<typeof directToEngineChatAdapterAPIInitSchema>;

export { directToEngineChatAdapterAPIInitSchema, type DirectToEngineChatAdapterAPIInit };
