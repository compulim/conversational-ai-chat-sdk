# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added `emitStartConversationEvent` option to `fromTurnBasedChatAdapterAPI` [@tdurnford](https://github.com/tdurnford)
- Added give up my turn, by [@compulim](https://github.com/compulim), in PR [#62](https://github.com/compulim/conversational-ai-chat-sdk/pull/62)
   - Fixed race conditions between give up my turn and post activity, by [@compulim](https://github.com/compulim), in PR [#65](https://github.com/compulim/conversational-ai-chat-sdk/pull/65)
- (Experimental) Added experimental /subscribe endpoint, by [@compulim](https://github.com/compulim), in PR [#62](https://github.com/compulim/conversational-ai-chat-sdk/pull/62) and [#64](https://github.com/compulim/conversational-ai-chat-sdk/pull/64)
- Added `*/*;q=0.8` to accept header, by [@compulim](https://github.com/compulim), in PR [#70](https://github.com/compulim/conversational-ai-chat-sdk/pull/70)
- (Experimental) Added `createFetchArguments` for custom fetch calls, by [@compulim](https://github.com/compulim), in PR [#71](https://github.com/compulim/conversational-ai-chat-sdk/pull/71)
- (Experimental) Added `resumeConversationId` to resume conversation, by [@compulim](https://github.com/compulim), in PR [#75](https://github.com/compulim/conversational-ai-chat-sdk/pull/75)

## [0.0.0] - 2023-08-19

### Added

- Initial release

[0.0.0]: https://github.com/microsoft/conversational-ai-chat-sdk/releases/tag/v0.0.0
