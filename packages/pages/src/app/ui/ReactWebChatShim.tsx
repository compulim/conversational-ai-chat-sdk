import type ReactWebChatComponentType from 'botframework-webchat';
import { type FluentThemeProvider as FluentThemeProviderComponentType } from 'botframework-webchat-fluent-theme';
import React, { useEffect, useState, type ComponentType } from 'react';

type PropsOf<T> = T extends ComponentType<infer P> ? P : never;
type Props = PropsOf<typeof ReactWebChatComponentType>;

let loadWebChatJSPromise: Promise<void> | undefined;

async function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptElement = document.createElement('script');

    scriptElement.setAttribute('async', 'async');
    scriptElement.setAttribute('src', url);

    scriptElement.addEventListener('load', () => resolve(), { once: true });
    scriptElement.addEventListener('error', reject, { once: true });

    window.React = React;

    document.body.appendChild(scriptElement);
  });
}

async function loadWebChatJS(): Promise<void> {
  await loadScript('https://unpkg.com/botframework-webchat@main/dist/webchat.js');
  await loadScript(
    'https://unpkg.com/botframework-webchat-fluent-theme@main/dist/botframework-webchat-fluent-theme.production.min.js'
  );
}

const ReactWebChatShim = (props: Props) => {
  const [FluentThemeProvider, setFluentThemeProvider] = useState<typeof FluentThemeProviderComponentType | undefined>(
    undefined
  );
  const [WebChat, setWebChat] = useState<typeof ReactWebChatComponentType | undefined>(undefined);

  useEffect(() => {
    const abortController = new AbortController();

    (async function () {
      if (!('WebChat' in window)) {
        await (loadWebChatJSPromise || (loadWebChatJSPromise = loadWebChatJS()));
      }

      if (abortController.signal.aborted) {
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setFluentThemeProvider(() => (window as any).WebChat.FluentThemeProvider);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setWebChat(() => (window as any)['WebChat'].ReactWebChat);
    })();

    return () => abortController.abort();
  }, [props, setFluentThemeProvider, setWebChat]);

  return (
    <div style={{ display: 'contents' }}>
      {FluentThemeProvider && WebChat && (
        <FluentThemeProvider>
          <WebChat directLine={props.directLine} />
        </FluentThemeProvider>
      )}
    </div>
  );
};

export default ReactWebChatShim;
