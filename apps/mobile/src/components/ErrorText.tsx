import { HelperText } from 'react-native-paper';

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <HelperText type="error" visible accessibilityLiveRegion="polite">
      {message}
    </HelperText>
  );
}
