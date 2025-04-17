import { type Activity as DirectLineJSActivity } from 'botframework-directlinejs';

export type Activity =
  | DirectLineJSActivity
  | (DirectLineJSActivity & {
      text?: string | undefined;
      type: 'typing';
    });
