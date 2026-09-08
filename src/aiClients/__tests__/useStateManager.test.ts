import { act, renderHook } from '@testing-library/react';
import useStateManager from '../useStateManager';
import { useLocation } from 'react-router-dom';
import { VirtualAssistantStateSingleton } from '../../utils/VirtualAssistantStateSingleton';
import { Models } from '../types';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useLocation: jest.fn(),
}));

// Mock scalprum remote hook manager API used by the hook under test
const createStateManager = () => ({
  isInitialized: jest.fn(() => false),
  isInitializing: jest.fn(() => false),
  init: jest.fn(),
});

const mockAddHook = jest.fn();
const mockCleanup = jest.fn();
const mockHookResults: Array<Record<string, unknown>> = [];
jest.mock('@scalprum/react-core', () => ({
  useRemoteHookManager: jest.fn(() => ({
    addHook: mockAddHook,
    cleanup: mockCleanup,
    get hookResults() {
      return mockHookResults;
    },
  })),
}));

// Mock the useFlag hook for feature flags
const mockUseFlag = jest.fn();
jest.mock('@unleash/proxy-client-react', () => ({
  useFlag: (flag: string) => mockUseFlag(flag),
}));

const createManagerHookResult = (id: string, model: Models | null) => ({
  id,
  loading: false,
  error: null,
  hookResult: {
    manager: model
      ? {
          model,
          stateManager: createStateManager(),
          historyManagement: true,
          streamMessages: true,
        }
      : null,
  },
});

describe('useStateManager', () => {
  beforeAll(() => {
    jest.resetModules();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockHookResults.length = 0;
    mockHookResults.push(
      {
        id: 'arh',
        loading: false,
        error: null,
        hookResult: {
          manager: {
            model: 'Ask Red Hat',
            stateManager: createStateManager(),
            historyManagement: true,
            streamMessages: true,
            routes: ['/baz/*'],
          },
        },
      },
      {
        id: 'rhel',
        loading: false,
        error: null,
        hookResult: {
          manager: {
            model: 'RHEL Lightspeed',
            stateManager: createStateManager(),
            historyManagement: false,
            streamMessages: false,
            routes: ['/foo/bar/*'],
          },
        },
      },
      {
        id: 'ai',
        loading: false,
        error: 'An error occured',
        hookResult: {
          manager: {
            model: 'AI Chatbot',
            stateManager: createStateManager(),
            historyManagement: false,
            streamMessages: false,
            routes: ['/ai/*'],
          },
        },
      }
    );
    (useLocation as jest.Mock).mockReturnValue({ pathname: '/' });
    VirtualAssistantStateSingleton.setIsOpen(false);
    VirtualAssistantStateSingleton.setCurrentModel(undefined);

    // Mock global fetch to prevent network calls and silence warnings
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    ) as jest.Mock;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  const actWait = async (ms = 0) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
    });
  };

  it('sets currentModel to the first available', async () => {
    mockUseFlag.mockReturnValue(false);
    const { result } = renderHook(() => useStateManager(true));
    await actWait();
    expect(result.current.currentModel).toBe('Ask Red Hat');
  }, 10000);

  it('sets currentModel to matching route', async () => {
    mockUseFlag.mockReturnValue(false);
    (useLocation as jest.Mock).mockReturnValue({ pathname: '/baz/foo' });
    const { result, rerender } = renderHook((isOpen: boolean) => useStateManager(isOpen));
    await actWait();
    expect(result.current.currentModel).toBe('Ask Red Hat');

    (useLocation as jest.Mock).mockReturnValue({ pathname: '/foo/bar/baz' });
    rerender(true);
    await actWait();
    expect(result.current.currentModel).toBe('RHEL Lightspeed');
  }, 10000);

  it('does not show non-authenticated models', async () => {
    mockUseFlag.mockReturnValue(false);
    mockHookResults.length = 0;
    mockHookResults.push(
      {
        id: 'arh',
        loading: false,
        error: null,
        hookResult: {
          manager: {
            model: 'Ask Red Hat',
            stateManager: createStateManager(),
            historyManagement: true,
            streamMessages: true,
            routes: ['/baz/*'],
          },
        },
      },
      {
        id: 'rhel',
        loading: false,
        error: null,
        hookResult: {
          manager: null,
        },
      },
      {
        id: 'ai',
        loading: false,
        error: 'An error occurred',
        hookResult: {
          manager: {
            model: 'AI Chatbot',
            stateManager: createStateManager(),
            historyManagement: false,
            streamMessages: false,
            routes: ['/ai/*'],
          },
        },
      }
    );
    (useLocation as jest.Mock).mockReturnValue({ pathname: '/foo/bar/baz' });
    const { result } = renderHook(() => useStateManager(true));
    await actWait();
    expect(result.current.currentModel).toBe('Ask Red Hat');
  }, 10000);

  it('registers in order ARH, VA, HCC AI, MAS, RHEL when arh-default is ON', async () => {
    mockUseFlag.mockReturnValue(true);
    renderHook(() => useStateManager(true));
    await actWait();
    const modules = mockAddHook.mock.calls.map(([arg]: [{ module: string }]) => arg.module);
    expect(modules).toEqual(['./useArhChatbot', './useVaChatbot', './useHccAiChatbot', './useMasChatbot', './useRhelChatbot']);
  }, 10000);

  it('registers in order VA, HCC AI, MAS, ARH, RHEL when arh-default is OFF', async () => {
    mockUseFlag.mockReturnValue(false);
    renderHook(() => useStateManager(true));
    await actWait();
    const modules = mockAddHook.mock.calls.map(([arg]: [{ module: string }]) => arg.module);
    expect(modules).toEqual(['./useVaChatbot', './useHccAiChatbot', './useMasChatbot', './useArhChatbot', './useRhelChatbot']);
  }, 10000);

  describe('when VA is unavailable (arh-default OFF)', () => {
    beforeEach(() => {
      mockUseFlag.mockReturnValue(false);
    });

    it('selects HCC AI as default when all services are available', async () => {
      mockHookResults.length = 0;
      mockHookResults.push(
        createManagerHookResult('va', null),
        createManagerHookResult('hcc-ai', Models.HCC_AI),
        createManagerHookResult('mas', Models.MAS),
        createManagerHookResult('arh', Models.ASK_RED_HAT),
        createManagerHookResult('rhel', Models.RHEL_LIGHTSPEED)
      );
      const { result } = renderHook(() => useStateManager(true));
      await actWait();
      expect(result.current.currentModel).toBe(Models.HCC_AI);
    }, 10000);

    it('selects MAS when HCC AI is also unavailable', async () => {
      mockHookResults.length = 0;
      mockHookResults.push(
        createManagerHookResult('va', null),
        createManagerHookResult('hcc-ai', null),
        createManagerHookResult('mas', Models.MAS),
        createManagerHookResult('arh', Models.ASK_RED_HAT),
        createManagerHookResult('rhel', Models.RHEL_LIGHTSPEED)
      );
      const { result } = renderHook(() => useStateManager(true));
      await actWait();
      expect(result.current.currentModel).toBe(Models.MAS);
    }, 10000);

    it('selects ARH when HCC AI and MAS are also unavailable', async () => {
      mockHookResults.length = 0;
      mockHookResults.push(
        createManagerHookResult('va', null),
        createManagerHookResult('hcc-ai', null),
        createManagerHookResult('mas', null),
        createManagerHookResult('arh', Models.ASK_RED_HAT),
        createManagerHookResult('rhel', Models.RHEL_LIGHTSPEED)
      );
      const { result } = renderHook(() => useStateManager(true));
      await actWait();
      expect(result.current.currentModel).toBe(Models.ASK_RED_HAT);
    }, 10000);

    it('reselects to HCC AI when current model (VA) becomes unavailable', async () => {
      VirtualAssistantStateSingleton.setCurrentModel(Models.VA);
      mockHookResults.length = 0;
      mockHookResults.push(
        createManagerHookResult('va', null),
        createManagerHookResult('hcc-ai', Models.HCC_AI),
        createManagerHookResult('mas', Models.MAS),
        createManagerHookResult('arh', Models.ASK_RED_HAT),
        createManagerHookResult('rhel', Models.RHEL_LIGHTSPEED)
      );
      const { result } = renderHook(() => useStateManager(true));
      await actWait();
      expect(result.current.currentModel).toBe(Models.HCC_AI);
    }, 10000);
  });
});
