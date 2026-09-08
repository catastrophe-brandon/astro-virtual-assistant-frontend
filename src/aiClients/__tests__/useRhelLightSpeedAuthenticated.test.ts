import { renderHook, waitFor } from '@testing-library/react';
import { useRhelLightSpeedAuthenticated } from '../useRhelLightSpeedManager';
import { ChromeUser } from '@redhat-cloud-services/types';

// Mock the useChrome hook
const mockChrome = {
  auth: {
    getUser: jest.fn(),
    getToken: jest.fn(() => Promise.resolve('mock-token')),
    token: 'mock-token',
  },
};

jest.mock('@redhat-cloud-services/frontend-components/useChrome', () => ({
  __esModule: true,
  default: jest.fn(() => mockChrome),
}));

// Mock UniversalChatbot component to avoid PatternFly imports
jest.mock('../../Components/UniversalChatbot/UniversalChatbot', () => ({
  __esModule: true,
  default: () => null,
}));

// Mock AI client state
jest.mock('@redhat-cloud-services/ai-client-state', () => ({
  createClientStateManager: jest.fn(() => ({})),
}));

// Mock RHEL Lightspeed client
jest.mock('@redhat-cloud-services/rhel-lightspeed-client', () => ({
  RHELLightspeedClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@unleash/proxy-client-react', () => ({
  useFlag: jest.fn((flagName: string) => {
    if (flagName === 'platform.chatbot.rhel-lightspeed.enabled') {
      return true; // Default to enabled for tests
    }
    return false;
  }),
}));

describe('useRhelLightSpeedAuthenticated', () => {
  const baseUser: ChromeUser = {
    entitlements: {},
    identity: {
      org_id: 'org-123',
      account_number: '123456',
      internal: {
        org_id: 'org-123',
        account_id: 'account-123',
      },
      type: 'User',
      user: {
        is_internal: false,
        is_org_admin: false,
        locale: 'en-US',
        username: 'testuser',
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
        is_active: true,
      },
    },
  };

  beforeAll(() => {
    jest.resetModules();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('should handle user with RHEL entitlement', async () => {
    const rhelUser = {
      ...baseUser,
      entitlements: {
        rhel: { is_entitled: true },
      },
    };
    mockChrome.auth.getUser.mockResolvedValue(rhelUser);

    const { result } = renderHook(() => useRhelLightSpeedAuthenticated());

    // Initial loading state
    expect(result.current.loading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Final authenticated state
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('should handle user without RHEL entitlement', async () => {
    const noRhelUser = {
      ...baseUser,
      entitlements: {
        insights: { is_entitled: true }, // Different entitlement
      },
    };
    mockChrome.auth.getUser.mockResolvedValue(noRhelUser);

    const { result } = renderHook(() => useRhelLightSpeedAuthenticated());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
  });

  it('should handle missing user', async () => {
    mockChrome.auth.getUser.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRhelLightSpeedAuthenticated());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
  });

  it('should handle getUser errors', async () => {
    const error = new Error('User fetch failed');
    mockChrome.auth.getUser.mockRejectedValue(error);

    const { result } = renderHook(() => useRhelLightSpeedAuthenticated());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
  });

  it('should handle different error types', async () => {
    // Test string error
    mockChrome.auth.getUser.mockRejectedValue('String error');
    const { result: result1 } = renderHook(() => useRhelLightSpeedAuthenticated());

    await waitFor(() => {
      expect(result1.current.loading).toBe(false);
    });
    expect(result1.current.isAuthenticated).toEqual(false);

    // Test unknown error type
    mockChrome.auth.getUser.mockRejectedValue({ unexpected: 'error' });
    const { result: result2 } = renderHook(() => useRhelLightSpeedAuthenticated());

    await waitFor(() => {
      expect(result2.current.loading).toBe(false);
    });
    expect(result2.current.isAuthenticated).toEqual(false);
  });

  it('should re-run authentication when token changes', async () => {
    const rhelUser = {
      ...baseUser,
      entitlements: {
        rhel: { is_entitled: true },
      },
    };
    mockChrome.auth.getUser.mockResolvedValue(rhelUser);

    const { result, rerender } = renderHook(() => useRhelLightSpeedAuthenticated());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.isAuthenticated).toBe(true);

    // Simulate token change
    mockChrome.auth.token = 'new-token';
    rerender();

    // Should trigger re-authentication
    expect(mockChrome.auth.getUser).toHaveBeenCalledTimes(2);
  });
});
