import {
  check,
  custom,
  object,
  optional,
  parse,
  pipe,
  readonly,
  safeParse,
  string,
  transform,
  type InferInput,
  type InferOutput
} from 'valibot';

type TrackExceptionFunction = (exception: unknown, customProperties?: Record<string, unknown>) => void;

const coreTelemetrySchema = object(
  {
    correlationId: pipe(optional(string('"telemetry.correlationId" must be a string')), readonly()),
    trackException: optional(
      pipe(
        custom<TrackExceptionFunction>(
          value => typeof value === 'function',
          '"telemetry.trackException" must be a function'
        ),
        transform(value => value as TrackExceptionFunction)
      )
    )
  },
  '"telemetry" must be an object'
);

type CoreTelemetryInput = InferInput<typeof coreTelemetrySchema>;
type CoreTelemetryOutput = InferOutput<typeof coreTelemetrySchema>;

const telemetrySchema = pipe(
  // `correlationId` is a getter and it would be taken out by object(), we need to use any() here.
  custom<CoreTelemetryInput>(value => safeParse(object({}, '"telemetry" must be an object'), value).success),
  transform<CoreTelemetryInput, CoreTelemetryOutput>(value => {
    const { correlationId: _, ...telemetrySchemaEntriesWithoutCorrelationId } = coreTelemetrySchema.entries;

    return {
      ...parse(object(telemetrySchemaEntriesWithoutCorrelationId), value),
      get correlationId() {
        return value.correlationId;
      }
    };
  }),
  check(value => safeParse(coreTelemetrySchema, value).success)
);

type Telemetry = InferInput<typeof telemetrySchema> & {
  /**
   * Value to send via HTTP header `x-ms-correlation-id`.
   */
  readonly correlationId?: string | undefined;
};

export { telemetrySchema, type Telemetry };
