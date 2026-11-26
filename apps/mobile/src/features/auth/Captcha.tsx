// Cloudflare Turnstile on iOS and Android, rendered in a WebView. Only shown when
// EXPO_PUBLIC_TURNSTILE_SITE_KEY is set (hosted projects with CAPTCHA on).
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

export function Captcha({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head>
<body style="margin:0;display:flex;justify-content:center">
<div class="cf-turnstile" data-sitekey="${siteKey.replace(/[^A-Za-z0-9_-]/g, '')}"
  data-callback="onToken"></div>
<script>function onToken(t){window.ReactNativeWebView.postMessage(t)}</script></body></html>`;
  return (
    <WebView
      style={styles.box}
      originWhitelist={['*']}
      source={{ html, baseUrl: 'https://society.app' }}
      onMessage={(event) => onToken(event.nativeEvent.data)}
    />
  );
}

const styles = StyleSheet.create({ box: { height: 80, backgroundColor: 'transparent' } });
