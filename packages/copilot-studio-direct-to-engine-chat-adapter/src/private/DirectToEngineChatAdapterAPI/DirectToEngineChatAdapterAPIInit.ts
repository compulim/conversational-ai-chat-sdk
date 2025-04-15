import { boolean, instance, number, object, optional, pipe, readonly, type InferInput } from 'valibot';

import { telemetrySchema } from '../../types/Telemetry';
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
    telemetry: optional(telemetrySchema)
  }),
  readonly()
);

type DirectToEngineChatAdapterAPIInit = InferInput<typeof directToEngineChatAdapterAPIInitSchema>;

export { directToEngineChatAdapterAPIInitSchema, type DirectToEngineChatAdapterAPIInit };
