import { render, screen } from '@testing-library/react-native';

import Index from '@/app/index';

describe('placeholder home screen', () => {
  it('shows the app name', async () => {
    await render(<Index />);
    expect(screen.getByText('Society App')).toBeTruthy();
  });
});
