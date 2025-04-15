import { function_, maxValue, minValue, number, object, optional, pipe, transform, type InferInput } from 'valibot';
import { directToEngineChatAdapterAPIInitSchema } from './DirectToEngineChatAdapterAPIInit';

const DEFAULT_SUBSCRIBE_SILENCE_TIMEOUT = 1_000;

const directToEngineChatAdapterAPIWithExecuteViaSubscribeInitSchema = object({
  ...directToEngineChatAdapterAPIInitSchema.entries,
  onActivity: optional(
    pipe(
      function_('"onActivity" must be a function'),
      transform(value => value as () => void)
    )
  ),
  subscribeSilenceTimeout: optional(
    pipe(
      number('"subscribeSilenceTimeout" must be a number'),
      maxValue(60_000, '"subscribeSilenceTimeout" must be equal to or less than 60_000'),
      minValue(0, '"subscribeSilenceTimeout" must be equal to or greater than 0')
    ),
    DEFAULT_SUBSCRIBE_SILENCE_TIMEOUT
  )
});

type DirectToEngineChatAdapterAPIWithExecuteViaSubscribeInit = InferInput<
  typeof directToEngineChatAdapterAPIWithExecuteViaSubscribeInitSchema
>;

export default directToEngineChatAdapterAPIWithExecuteViaSubscribeInitSchema;
export { type DirectToEngineChatAdapterAPIWithExecuteViaSubscribeInit };
