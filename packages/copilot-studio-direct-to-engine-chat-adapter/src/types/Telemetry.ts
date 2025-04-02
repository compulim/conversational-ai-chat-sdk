export type Telemetry = {
  /**
   * Value to send via HTTP header `x-ms-correlation-id`.
   */
  get correlationId(): string | undefined;

  trackException(exception: unknown, customProperties?: Record<string, unknown>): void;
};
