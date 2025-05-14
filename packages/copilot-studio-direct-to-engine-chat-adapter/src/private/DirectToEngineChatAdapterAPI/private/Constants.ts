declare global {
  const process: {
    env: { npm_package_version?: string | undefined };
  };
}

const CHAT_ADAPTER_HEADER_NAME = 'x-ms-chat-adapter';
const CONVERSATION_ID_HEADER_NAME = 'x-ms-conversationid';
const CORRELATION_ID_HEADER_NAME = 'x-ms-correlation-id';
const DEFAULT_RETRY_COUNT = 4; // Will call 5 times.
const NPM_PACKAGE_VERSION = process.env.npm_package_version || '';

export {
  CHAT_ADAPTER_HEADER_NAME,
  CONVERSATION_ID_HEADER_NAME,
  CORRELATION_ID_HEADER_NAME,
  DEFAULT_RETRY_COUNT,
  NPM_PACKAGE_VERSION
};
