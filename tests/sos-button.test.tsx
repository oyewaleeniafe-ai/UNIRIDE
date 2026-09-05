// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

// Mock the sendSOS server action
vi.mock('@/lib/actions/misc', () => ({
  sendSOS: vi.fn(),
}));

import SOSButton from '@/components/sos-button';
import { sendSOS } from '@/lib/actions/misc';

const mockSendSOS = vi.mocked(sendSOS);

describe('SOSButton', () => {
  const mockGeolocation = {
    getCurrentPosition: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: geolocation not available
    Object.defineProperty(navigator, 'geolocation', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the SOS button', () => {
    render(<SOSButton />);
    expect(screen.getByText('SOS')).toBeInTheDocument();
    expect(screen.getByText('⚠')).toBeInTheDocument();
  });

  it('opens confirmation modal when SOS button is clicked', async () => {
    const user = userEvent.setup();
    render(<SOSButton />);

    await user.click(screen.getByText('SOS'));

    expect(screen.getByText('Emergency Alert')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to send an emergency alert/)).toBeInTheDocument();
    expect(screen.getByText('SEND SOS')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('closes modal when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<SOSButton />);

    await user.click(screen.getByText('SOS'));
    expect(screen.getByText('Emergency Alert')).toBeInTheDocument();

    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Emergency Alert')).not.toBeInTheDocument();
  });

  it('sends SOS and shows success message on confirm', async () => {
    mockSendSOS.mockResolvedValue({ success: true, alert: { id: 'alert-1' } });
    const user = userEvent.setup();
    render(<SOSButton />);

    await user.click(screen.getByText('SOS'));
    await user.click(screen.getByText('SEND SOS'));

    await waitFor(() => {
      expect(mockSendSOS).toHaveBeenCalledWith({
        latitude: undefined,
        longitude: undefined,
      });
    });

    expect(screen.getByText('Emergency alert has been recorded.')).toBeInTheDocument();
    expect(screen.getByText(/If you are in immediate danger/)).toBeInTheDocument();
  });

  it('shows error message when SOS fails', async () => {
    mockSendSOS.mockResolvedValue({ error: 'Too many SOS requests. Please try again later.' });
    const user = userEvent.setup();
    render(<SOSButton />);

    await user.click(screen.getByText('SOS'));
    await user.click(screen.getByText('SEND SOS'));

    await waitFor(() => {
      expect(screen.getByText('Too many SOS requests. Please try again later.')).toBeInTheDocument();
    });

    // Modal should still be open
    expect(screen.getByText('Emergency Alert')).toBeInTheDocument();
  });

  it('sends SOS with geolocation when available', async () => {
    mockSendSOS.mockResolvedValue({ success: true, alert: { id: 'alert-1' } });
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: vi.fn((resolve) => {
          resolve({
            coords: { latitude: 7.633, longitude: 4.1825 },
          });
        }),
      },
      writable: true,
      configurable: true,
    });

    const user = userEvent.setup();
    render(<SOSButton />);

    await user.click(screen.getByText('SOS'));
    await user.click(screen.getByText('SEND SOS'));

    await waitFor(() => {
      expect(mockSendSOS).toHaveBeenCalledWith({
        latitude: 7.633,
        longitude: 4.1825,
      });
    });
  });

  it('sends SOS without location when geolocation fails', async () => {
    mockSendSOS.mockResolvedValue({ success: true, alert: { id: 'alert-1' } });
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: vi.fn((resolve, reject) => {
          reject(new Error('Permission denied'));
        }),
      },
      writable: true,
      configurable: true,
    });

    const user = userEvent.setup();
    render(<SOSButton />);

    await user.click(screen.getByText('SOS'));
    await user.click(screen.getByText('SEND SOS'));

    await waitFor(() => {
      expect(mockSendSOS).toHaveBeenCalledWith({
        latitude: undefined,
        longitude: undefined,
      });
    });

    expect(screen.getByText('Emergency alert has been recorded.')).toBeInTheDocument();
  });

  it('shows Sending... while request is in progress', async () => {
    let resolveSOS: (value: unknown) => void;
    mockSendSOS.mockImplementation(
      () => new Promise((resolve) => { resolveSOS = resolve; })
    );

    const user = userEvent.setup();
    render(<SOSButton />);

    await user.click(screen.getByText('SOS'));
    await user.click(screen.getByText('SEND SOS'));

    await waitFor(() => {
      expect(screen.getByText('Sending...')).toBeInTheDocument();
    });

    // Resolve the promise
    resolveSOS!({ success: true, alert: { id: 'alert-1' } });

    await waitFor(() => {
      expect(screen.getByText('Emergency alert has been recorded.')).toBeInTheDocument();
    });
  });

  it('dismiss success message resets to initial state', async () => {
    mockSendSOS.mockResolvedValue({ success: true, alert: { id: 'alert-1' } });
    const user = userEvent.setup();
    render(<SOSButton />);

    // Send SOS
    await user.click(screen.getByText('SOS'));
    await user.click(screen.getByText('SEND SOS'));
    await waitFor(() => {
      expect(screen.getByText('Emergency alert has been recorded.')).toBeInTheDocument();
    });

    // Dismiss
    await user.click(screen.getByText('Dismiss'));
    expect(screen.queryByText('Emergency alert has been recorded.')).not.toBeInTheDocument();
    expect(screen.getByText('SOS')).toBeInTheDocument();
  });
});
