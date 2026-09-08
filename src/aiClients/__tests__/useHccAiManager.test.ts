import { renderHook } from '@testing-library/react';
import { LightspeedClient } from '@redhat-cloud-services/lightspeed-client';
import useHccAiManager from '../useHccAiManager';
import { Models } from '../types';

// Mock LightspeedClient
jest.mock('@redhat-cloud-services/lightspeed-client', () => {
  return {
    LightspeedClient: jest.fn(() => ({
      init: jest.fn().mockResolvedValue({ conversations: [] }),
      sendMessage: jest.fn(),
      createNewConversation: jest.fn(),
      getConversationHistory: jest.fn().mockResolvedValue([]),
      healthCheck: jest.fn(),
    })),
  };
});

// Mock AI client state
const mockStateManager = {
  isInitialized: jest.fn(() => true), // assume initialized for all tests
  isInitializing: jest.fn(() => false),
  init: jest.fn(),
  getClient: jest.fn(),
  subscribe: jest.fn(() => jest.fn()),
};

jest.mock('@redhat-cloud-services/ai-client-state', () => ({
  createClientStateManager: jest.fn(() => mockStateManager),
}));

// Mock useChrome
jest.mock('@redhat-cloud-services/frontend-components/useChrome', () => ({
  __esModule: true,
  default: () => ({
    auth: {
      getToken: jest.fn().mockResolvedValue('mock-token'),
    },
  }),
}));

// Track useFlag return value
let mockUseFlagReturn = true;
jest.mock('@unleash/proxy-client-react', () => ({
  useFlag: jest.fn(() => mockUseFlagReturn),
}));

describe('useHccAiManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFlagReturn = true;
  });

  describe('when feature flag is off', () => {
    it('should return null manager', () => {
      mockUseFlagReturn = false;
      const { result } = renderHook(() => useHccAiManager());

      expect(result.current.manager).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  describe('when feature flag is on', () => {
    it('should create LightspeedClient with correct config', () => {
      const { result } = renderHook(() => useHccAiManager());

      expect(result.current.manager?.model).toBe(Models.HCC_AI);
      expect(LightspeedClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: expect.stringContaining('/api/ai-assistant'),
          fetchFunction: expect.any(Function),
        })
      );
    });

    it('should enable history management', () => {
      const { result } = renderHook(() => useHccAiManager());

      expect(result.current.manager?.historyManagement).toBe(true);
    });

    describe('fetchFunction behavior', () => {
      let fetchFunction: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
      let mockFetch: jest.Mock;
      const originalFetch = global.fetch;

      beforeEach(() => {
        mockFetch = jest.fn().mockResolvedValue({ ok: true });
        global.fetch = mockFetch;

        renderHook(() => useHccAiManager());
        const config = jest.mocked(LightspeedClient).mock.calls[0][0];
        if (!config.fetchFunction) {
          throw new Error('Expected LightspeedClient to receive a custom fetchFunction');
        }
        fetchFunction = config.fetchFunction;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should add Authorization header', async () => {
        await fetchFunction('https://example.com/v1/info', { headers: {} });

        expect(mockFetch).toHaveBeenCalledWith(
          'https://example.com/v1/info',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer mock-token',
            }),
          })
        );
      });

      it('should inject model, provider, and disable topic summary for query requests', async () => {
        const body = JSON.stringify({ query: 'hello' });
        await fetchFunction('https://example.com/v1/query', { body, headers: {} });

        const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(calledBody.model).toBe('publishers/google/models/gemini-2.5-flash');
        expect(calledBody.provider).toBe('google-vertex');
        expect(calledBody.generate_topic_summary).toBe(false);
        expect(calledBody.query).toBe('hello');
      });

      it('should inject model, provider, and disable topic summary for streaming_query requests', async () => {
        const body = JSON.stringify({ query: 'hello' });
        await fetchFunction('https://example.com/v1/streaming_query', { body, headers: {} });

        const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(calledBody.model).toBe('publishers/google/models/gemini-2.5-flash');
        expect(calledBody.provider).toBe('google-vertex');
        expect(calledBody.generate_topic_summary).toBe(false);
      });

      it('should not modify body for non-query requests', async () => {
        const body = JSON.stringify({ some: 'data' });
        await fetchFunction('https://example.com/v1/conversations', { body, headers: {} });

        expect(mockFetch.mock.calls[0][1].body).toBe(body);
      });

      it('should leave body unchanged if JSON parsing fails', async () => {
        const body = 'not-valid-json';
        await fetchFunction('https://example.com/v1/query', { body, headers: {} });

        expect(mockFetch.mock.calls[0][1].body).toBe(body);
      });
    });
  });
});
