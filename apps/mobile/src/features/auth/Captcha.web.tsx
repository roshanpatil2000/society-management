// Cloudflare Turnstile on the web: loads the widget script once and renders it.
import { useEffect, useRef } from 'react';

interface TurnstileApi {
  render(el: HTMLElement, options: { sitekey: string; callback: (token: string) => void }): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function Captcha({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widget: string | undefined;
    const mount = () => {
      const el = ref.current;
      if (el && window.turnstile)
        widget = window.turnstile.render(el, { sitekey: siteKey, callback: onToken });
    };
    if (window.turnstile) mount();
    else {
      const script = document.createElement('script');
      script.src = SCRIPT;
      script.async = true;
      script.onload = mount;
      document.head.appendChild(script);
    }
    return () => {
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey, onToken]);

  return <div ref={ref} />;
}
