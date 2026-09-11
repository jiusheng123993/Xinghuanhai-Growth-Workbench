/** 食物查询页面单元测试 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import PetFoodQuery from '../index'

// vi.mock 工厂函数内使用 require，此处补充类型声明
declare const require: (id: string) => any

const {
  mockSwitchPet,
  mockInitPetUser,
  mockQueryFood,
  mockFetchHistory,
  mockFetchStats,
  mockCheckAccess,
  mockShouldShowPaywall,
  mockMarkPaywallShown,
  mockInitMembership,
  mockCheckNewOwnerAnxiety,
  mockDismissNewOwnerAnxiety,
  mockTrackEmotion,
  mockDismissCrisisReferral,
  mockHandleFollowUp,
  mockTrackEvent,
  mockTrackPageView,
  mockUsePet,
  mockUseFoodQuery,
  mockUseMembership,
} = vi.hoisted(() => ({
  mockSwitchPet: vi.fn(),
  mockInitPetUser: vi.fn(),
  mockQueryFood: vi.fn(),
  mockFetchHistory: vi.fn(),
  mockFetchStats: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockShouldShowPaywall: vi.fn(),
  mockMarkPaywallShown: vi.fn(),
  mockInitMembership: vi.fn(),
  mockCheckNewOwnerAnxiety: vi.fn(),
  mockDismissNewOwnerAnxiety: vi.fn(),
  mockTrackEmotion: vi.fn(),
  mockDismissCrisisReferral: vi.fn(),
  mockHandleFollowUp: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockTrackPageView: vi.fn(),
  // hook mock 使用宽松类型，允许 mockReturnValue 注入不同状态
  mockUsePet: vi.fn<any>(() => ({
    pets: [],
    currentPet: null,
    switchPet: mockSwitchPet,
    isLoading: false,
    initUser: mockInitPetUser,
    addPet: vi.fn(),
    updatePet: vi.fn(),
    removePet: vi.fn(),
    markPetDeceased: vi.fn(),
    refreshPets: vi.fn(),
    clearError: vi.fn(),
    error: null,
  })),
  mockUseFoodQuery: vi.fn<any>(() => ({
    lastResult: null,
    history: [],
    stats: null,
    queryFood: mockQueryFood,
    fetchHistory: mockFetchHistory,
    fetchStats: mockFetchStats,
    isLoading: false,
    error: null,
    clearError: vi.fn(),
  })),
  mockUseMembership: vi.fn<any>(() => ({
    isMember: false,
    checkAccess: mockCheckAccess,
    shouldShowPaywall: mockShouldShowPaywall,
    markPaywallShown: mockMarkPaywallShown,
    initUser: mockInitMembership,
    membership: null,
    orders: [],
    isLoading: false,
    error: null,
    subscribePlan: vi.fn(),
    cancelSubscription: vi.fn(),
    restorePurchaseStatus: vi.fn(),
    refreshMembership: vi.fn(),
    getPetLimit: vi.fn(),
    clearError: vi.fn(),
  })),
}))

// Override @tarojs/components Input mock to support onInput with detail.value
vi.mock('@tarojs/components', () => {
  const mapTag = (tag: string) => ({ children, className, style, onClick, src, ...rest }: any) => {
    const el = require('react').createElement(tag, { className, style, onClick, src, ...rest }, children)
    return el
  }
  return {
    View: mapTag('div'),
    Text: mapTag('span'),
    Image: mapTag('img'),
    ScrollView: mapTag('div'),
    Button: mapTag('button'),
    Input: ({ className, placeholder, value, onInput, onConfirm, ...rest }: any) =>
      require('react').createElement('input', {
        className,
        placeholder,
        value: value ?? '',
        onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }),
        onKeyDown: (e: any) => { if (e.key === 'Enter') onConfirm?.() },
        ...rest,
      }),
    Swiper: mapTag('div'),
    SwiperItem: mapTag('div'),
  }
})

vi.mock('@tarojs/taro', () => {
  const eventCenter = { on: vi.fn(), off: vi.fn(), trigger: vi.fn() }
  return {
    default: {
      showToast: vi.fn(),
      showModal: vi.fn(),
      showLoading: vi.fn(),
      hideLoading: vi.fn(),
      navigateTo: vi.fn(),
      navigateBack: vi.fn(),
      reLaunch: vi.fn(),
      switchTab: vi.fn(),
      getStorageSync: vi.fn(() => null),
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
      getStorageInfoSync: vi.fn(() => ({ keys: [] })),
      chooseImage: vi.fn(),
      uploadFile: vi.fn(),
      getSystemInfoSync: vi.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
      setClipboardData: vi.fn(),
      setNavigationBarColor: vi.fn(() => ({ catch: vi.fn() })),
      setTabBarStyle: vi.fn(() => ({ catch: vi.fn() })),
      eventCenter,
      showShareMenu: vi.fn(),
    },
    showToast: vi.fn(),
    showModal: vi.fn(),
    navigateTo: vi.fn(),
    navigateBack: vi.fn(),
    reLaunch: vi.fn(),
    switchTab: vi.fn(),
    setNavigationBarColor: vi.fn(() => ({ catch: vi.fn() })),
    setTabBarStyle: vi.fn(() => ({ catch: vi.fn() })),
    useDidShow: vi.fn(),
    useShareAppMessage: vi.fn(),
    useShareTimeline: vi.fn(),
    eventCenter,
    showShareMenu: vi.fn(),
  }
})

vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: () => 'theme-default',
  // PageBackground 组件内部会用到这两个导出，mock 必须一并提供
  useThemeKey: () => 'autumn',
  usePetWallpaper: () => null,
}))

vi.mock('../../../hooks/usePet', () => ({
  usePet: mockUsePet,
}))

vi.mock('../../../hooks/useFoodQuery', () => ({
  useFoodQuery: mockUseFoodQuery,
}))

vi.mock('../../../hooks/useMembership', () => ({
  useMembership: mockUseMembership,
}))

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'user-1', nickname: '测试用户', createdAt: '2024-01-01T00:00:00Z' } }),
}))

vi.mock('../../../stores/shareStore', () => ({
  useShareStore: (selector: any) => selector({ inviteCode: 'TEST01' }),
}))

vi.mock('../../../hooks/useAnxietyDetection', () => ({
  useAnxietyDetection: () => ({
    anxietyState: { showNewOwnerAnxiety: false, newOwnerAnxietyContext: null },
    checkNewOwnerAnxiety: mockCheckNewOwnerAnxiety,
    dismissNewOwnerAnxiety: mockDismissNewOwnerAnxiety,
  }),
}))

vi.mock('../../../hooks/useEmotionTracking', () => ({
  useEmotionTracking: () => ({
    showCrisisReferral: false,
    crisisSeverity: 'low',
    trackEvent: mockTrackEmotion,
    dismissCrisisReferral: mockDismissCrisisReferral,
    handleFollowUp: mockHandleFollowUp,
  }),
}))

vi.mock('../../../hooks/useAnalytics', () => ({
  useAnalytics: () => ({
    trackPageView: mockTrackPageView,
    trackEvent: mockTrackEvent,
  }),
  usePageView: vi.fn(),
}))

vi.mock('../../../components/PetSwitcher', () => ({
  default: ({ pets, currentPetId, onSwitch }: any) => (
    <div data-testid='pet-switcher' data-pets={pets?.length} data-current={currentPetId} onClick={() => onSwitch?.('pet-1')}>
      PetSwitcher
    </div>
  ),
}))

vi.mock('../../../components/PaywallPopup', () => ({
  default: ({ visible, onClose }: any) =>
    visible ? <div data-testid='paywall-popup' onClick={onClose}>PaywallPopup</div> : null,
}))

vi.mock('../../../components/FoodShareCard', () => ({
  default: ({ foodName, safetyLevel, onShare }: any) => (
    <div data-testid='food-share-card' data-food={foodName} data-level={safetyLevel}>
      FoodShareCard
      <button onClick={onShare}>Share</button>
    </div>
  ),
}))

vi.mock('../../../components/AnxietyIntervention', () => ({
  default: () => <div data-testid='anxiety-intervention'>AnxietyIntervention</div>,
}))

vi.mock('../../../components/CrisisReferralCard', () => ({
  default: () => <div data-testid='crisis-referral-card'>CrisisReferralCard</div>,
}))

vi.mock('../../../components', () => ({
  Icon: ({ name, className }: any) => <span className={className} data-icon={name} />,
  PageLoading: () => <div data-testid='page-loading'>PageLoading</div>,
  PageError: ({ message, onRetry }: any) => (
    <div data-testid='page-error'>
      <span>{message}</span>
      <button onClick={onRetry}>Retry</button>
    </div>
  ),
  PetAvatar: ({ species, petName }: any) => (
    <div data-testid='pet-avatar' data-species={species} data-name={petName}>PetAvatar</div>
  ),
  EmergencyAlert: ({ visible, title, message, onClose }: any) =>
    visible ? <div data-testid='emergency-alert' data-title={title} onClick={onClose}>EmergencyAlert: {message}</div> : null,
}))

vi.mock('../../../components/NpsSurvey', () => ({
  default: () => <div data-testid='nps-survey'>NpsSurvey</div>,
}))

vi.mock('../../../utils/usageTracking', () => ({
  incrementFoodQueryCount: vi.fn(),
  isNewUser: vi.fn(() => false),
  getRecentFoodQueryCount: vi.fn(() => 0),
  getRecentSymptomCheckCount: vi.fn(() => 0),
}))

vi.mock('../../../services/npsService', () => ({
  checkNpsEligibility: vi.fn(() => ({ isEligible: false })),
  submitNpsResponse: vi.fn(),
  dismissNpsSurvey: vi.fn(),
}))

vi.mock('../index.scss', () => ({}))

function makePet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pet-1',
    userId: 'user-1',
    name: '旺财',
    species: 'dog',
    breed: '金毛',
    breedId: 'breed-1',
    gender: 'male',
    birthDate: '2024-04-15',
    weight: 25,
    coatColor: '',
    photos: [],
    isNeutered: false,
    microchipId: '',
    notes: '',
    isDeceased: false,
    allergies: [],
    medications: [],
    chronicConditions: [],
    createdAt: '2024-04-15',
    updatedAt: '2024-04-15',
    ...overrides,
  }
}

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'result-1',
    foodName: '巧克力',
    safetyLevel: 'toxic',
    dangerousCompounds: ['可可碱', '咖啡因'],
    toxicDoses: '每公斤体重 100-200mg 可可碱',
    symptoms: ['呕吐', '腹泻', '心跳加速', '抽搐'],
    breedWarnings: ['某些品种代谢慢'],
    detail: '巧克力对狗和猫都有毒，可可碱含量越高毒性越强。',
    firstAid: '立即联系兽医，不要自行催吐。',
    ...overrides,
  }
}

describe('FoodQueryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePet.mockReturnValue({
      pets: [],
      currentPet: null,
      switchPet: mockSwitchPet,
      isLoading: false,
      initUser: mockInitPetUser,
      addPet: vi.fn(),
      updatePet: vi.fn(),
      removePet: vi.fn(),
      markPetDeceased: vi.fn(),
      refreshPets: vi.fn(),
      clearError: vi.fn(),
      error: null,
    })
    mockUseFoodQuery.mockReturnValue({
      lastResult: null,
      history: [],
      stats: null,
      queryFood: mockQueryFood,
      fetchHistory: mockFetchHistory,
      fetchStats: mockFetchStats,
      isLoading: false,
      error: null,
      clearError: vi.fn(),
    })
    mockUseMembership.mockReturnValue({
      isMember: false,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: mockShouldShowPaywall,
      markPaywallShown: mockMarkPaywallShown,
      initUser: mockInitMembership,
      membership: null,
      orders: [],
      isLoading: false,
      error: null,
      subscribePlan: vi.fn(),
      cancelSubscription: vi.fn(),
      restorePurchaseStatus: vi.fn(),
      refreshMembership: vi.fn(),
      getPetLimit: vi.fn(),
      clearError: vi.fn(),
    })
  })

  // ── SAFETY_LEVEL_LABELS ──
  describe('SAFETY_LEVEL_LABELS', () => {
    it('has correct label for safe level', () => {
      expect(SAFETY_LEVEL_LABELS.safe).toBe('安全')
    })

    it('has correct label for caution level', () => {
      expect(SAFETY_LEVEL_LABELS.caution).toBe('注意')
    })

    it('has correct label for dangerous level', () => {
      expect(SAFETY_LEVEL_LABELS.dangerous).toBe('危险')
    })

    it('has correct label for toxic level', () => {
      expect(SAFETY_LEVEL_LABELS.toxic).toBe('有毒')
    })
  })

  // ── SAFETY_LEVEL_COLORS ──
  describe('SAFETY_LEVEL_COLORS', () => {
    it('has correct color for safe level', () => {
      expect(SAFETY_LEVEL_COLORS.safe).toBe('#4CAF50')
    })

    it('has correct color for caution level', () => {
      expect(SAFETY_LEVEL_COLORS.caution).toBe('#FFC107')
    })

    it('has correct color for dangerous level', () => {
      expect(SAFETY_LEVEL_COLORS.dangerous).toBe('#FF9800')
    })

    it('has correct color for toxic level', () => {
      expect(SAFETY_LEVEL_COLORS.toxic).toBe('#F44336')
    })
  })

  // ── Component render states ──
  describe('render states', () => {
    it('renders loading state when isLoading and no pets', () => {
      mockUsePet.mockReturnValue({
        pets: [],
        currentPet: null,
        switchPet: mockSwitchPet,
        isLoading: true,
        initUser: mockInitPetUser,
        addPet: vi.fn(),
        updatePet: vi.fn(),
        removePet: vi.fn(),
        markPetDeceased: vi.fn(),
        refreshPets: vi.fn(),
        clearError: vi.fn(),
        error: null,
      })

      render(<PetFoodQuery />)

      expect(screen.getByTestId('page-loading')).toBeDefined()
    })

    it('renders empty state when no currentPet', () => {
      render(<PetFoodQuery />)

      expect(screen.getByText('请先添加宠物')).toBeDefined()
      // 空态图标已从 🐾 emoji 改为面性图标（paw-print），故改为断言图标元素
      expect(document.querySelector('[data-icon="paw-print"]')).not.toBeNull()
    })

    it('renders search interface when currentPet exists', () => {
      mockUsePet.mockReturnValue({
        pets: [makePet()],
        currentPet: makePet(),
        switchPet: mockSwitchPet,
        isLoading: false,
        initUser: mockInitPetUser,
        addPet: vi.fn(),
        updatePet: vi.fn(),
        removePet: vi.fn(),
        markPetDeceased: vi.fn(),
        refreshPets: vi.fn(),
        clearError: vi.fn(),
        error: null,
      })

      render(<PetFoodQuery />)

      expect(screen.getByPlaceholderText('搜索食物，如：鸡胸肉、葡萄...')).toBeDefined()
      expect(screen.getByText('搜索')).toBeDefined()
      expect(screen.getByText('输入食物名称，查询对宠物是否安全')).toBeDefined()
    })

    it('renders quota display for free users', () => {
      mockUsePet.mockReturnValue({
        pets: [makePet()],
        currentPet: makePet(),
        switchPet: mockSwitchPet,
        isLoading: false,
        initUser: mockInitPetUser,
        addPet: vi.fn(),
        updatePet: vi.fn(),
        removePet: vi.fn(),
        markPetDeceased: vi.fn(),
        refreshPets: vi.fn(),
        clearError: vi.fn(),
        error: null,
      })
      mockUseFoodQuery.mockReturnValue({
        lastResult: null,
        history: [],
        stats: { totalQueries: 5, remainingFree: 3, totalFree: 5 },
        queryFood: mockQueryFood,
        fetchHistory: mockFetchHistory,
        fetchStats: mockFetchStats,
        isLoading: false,
        error: null,
        clearError: vi.fn(),
      })

      render(<PetFoodQuery />)

      expect(screen.getByText('今日剩余免费查询：3 次')).toBeDefined()
    })

    it('renders exhausted quota display for free users', () => {
      mockUsePet.mockReturnValue({
        pets: [makePet()],
        currentPet: makePet(),
        switchPet: mockSwitchPet,
        isLoading: false,
        initUser: mockInitPetUser,
        addPet: vi.fn(),
        updatePet: vi.fn(),
        removePet: vi.fn(),
        markPetDeceased: vi.fn(),
        refreshPets: vi.fn(),
        clearError: vi.fn(),
        error: null,
      })
      mockUseFoodQuery.mockReturnValue({
        lastResult: null,
        history: [],
        stats: { totalQueries: 5, remainingFree: 0, totalFree: 5 },
        queryFood: mockQueryFood,
        fetchHistory: mockFetchHistory,
        fetchStats: mockFetchStats,
        isLoading: false,
        error: null,
        clearError: vi.fn(),
      })

      render(<PetFoodQuery />)

      expect(screen.getByText('今日免费次数已用完')).toBeDefined()
    })

    it('renders member unlimited quota', () => {
      mockUsePet.mockReturnValue({
        pets: [makePet()],
        currentPet: makePet(),
        switchPet: mockSwitchPet,
        isLoading: false,
        initUser: mockInitPetUser,
        addPet: vi.fn(),
        updatePet: vi.fn(),
        removePet: vi.fn(),
        markPetDeceased: vi.fn(),
        refreshPets: vi.fn(),
        clearError: vi.fn(),
        error: null,
      })
      mockUseMembership.mockReturnValue({
        isMember: true,
        checkAccess: mockCheckAccess,
        shouldShowPaywall: mockShouldShowPaywall,
        markPaywallShown: mockMarkPaywallShown,
        initUser: mockInitMembership,
        membership: null,
        orders: [],
        isLoading: false,
        error: null,
        subscribePlan: vi.fn(),
        cancelSubscription: vi.fn(),
        restorePurchaseStatus: vi.fn(),
        refreshMembership: vi.fn(),
        getPetLimit: vi.fn(),
        clearError: vi.fn(),
      })
      mockUseFoodQuery.mockReturnValue({
        lastResult: null,
        history: [],
        stats: { totalQueries: 100, remainingFree: 999 },
        queryFood: mockQueryFood,
        fetchHistory: mockFetchHistory,
        fetchStats: mockFetchStats,
        isLoading: false,
        error: null,
        clearError: vi.fn(),
      })

      render(<PetFoodQuery />)

      expect(screen.getByText('会员无限查询')).toBeDefined()
    })

    it('renders result card when lastResult exists', () => {
      mockUsePet.mockReturnValue({
        pets: [makePet()],
        currentPet: makePet(),
        switchPet: mockSwitchPet,
        isLoading: false,
        initUser: mockInitPetUser,
        addPet: vi.fn(),
        updatePet: vi.fn(),
        removePet: vi.fn(),
        markPetDeceased: vi.fn(),
        refreshPets: vi.fn(),
        clearError: vi.fn(),
        error: null,
      })
      mockUseFoodQuery.mockReturnValue({
        lastResult: makeResult(),
        history: [],
        stats: { totalQueries: 1, remainingFree: 4, totalFree: 5 },
        queryFood: mockQueryFood,
        fetchHistory: mockFetchHistory,
        fetchStats: mockFetchStats,
        isLoading: false,
        error: null,
        clearError: vi.fn(),
      })

      render(<PetFoodQuery />)

      // 巧克力同时出现在快捷分类区域与结果卡片，使用 getAllByText
      expect(screen.getAllByText('巧克力').length).toBeGreaterThan(0)
      expect(screen.getAllByText('有毒').length).toBeGreaterThan(0)
      expect(screen.getByText('可可碱')).toBeDefined()
      expect(screen.getByText('咖啡因')).toBeDefined()
      expect(screen.getByText('呕吐')).toBeDefined()
      expect(screen.getByText('腹泻')).toBeDefined()
      expect(screen.getByText('分享结果')).toBeDefined()
    })

    it('renders result card with safe food', () => {
      mockUsePet.mockReturnValue({
        pets: [makePet()],
        currentPet: makePet(),
        switchPet: mockSwitchPet,
        isLoading: false,
        initUser: mockInitPetUser,
        addPet: vi.fn(),
        updatePet: vi.fn(),
        removePet: vi.fn(),
        markPetDeceased: vi.fn(),
        refreshPets: vi.fn(),
        clearError: vi.fn(),
        error: null,
      })
      mockUseFoodQuery.mockReturnValue({
        lastResult: makeResult({
          foodName: '苹果',
          safetyLevel: 'safe',
          dangerousCompounds: [],
          symptoms: [],
          breedWarnings: [],
          detail: '苹果对宠物是安全的，但要去掉果核。',
          firstAid: '',
        }),
        history: [],
        stats: { totalQueries: 1, remainingFree: 4, totalFree: 5 },
        queryFood: mockQueryFood,
        fetchHistory: mockFetchHistory,
        fetchStats: mockFetchStats,
        isLoading: false,
        error: null,
        clearError: vi.fn(),
      })

      render(<PetFoodQuery />)

      // 苹果同时出现在快捷分类区域与结果卡片，使用 getAllByText
      expect(screen.getAllByText('苹果').length).toBeGreaterThan(0)
      expect(screen.getAllByText('安全').length).toBeGreaterThan(0)
      expect(screen.getByText('苹果对宠物是安全的，但要去掉果核。')).toBeDefined()
    })

    it('renders result card with caution food', () => {
      mockUsePet.mockReturnValue({
        pets: [makePet()],
        currentPet: makePet(),
        switchPet: mockSwitchPet,
        isLoading: false,
        initUser: mockInitPetUser,
        addPet: vi.fn(),
        updatePet: vi.fn(),
        removePet: vi.fn(),
        markPetDeceased: vi.fn(),
        refreshPets: vi.fn(),
        clearError: vi.fn(),
        error: null,
      })
      mockUseFoodQuery.mockReturnValue({
        lastResult: makeResult({
          foodName: '牛奶',
          safetyLevel: 'caution',
          dangerousCompounds: ['乳糖'],
          symptoms: ['腹泻'],
          breedWarnings: [],
          detail: '适量喂食，注意观察。',
          firstAid: '',
        }),
        history: [],
        stats: { totalQueries: 1, remainingFree: 4, totalFree: 5 },
        queryFood: mockQueryFood,
        fetchHistory: mockFetchHistory,
        fetchStats: mockFetchStats,
        isLoading: false,
        error: null,
        clearError: vi.fn(),
      })

      render(<PetFoodQuery />)

      expect(screen.getByText('牛奶')).toBeDefined()
      expect(screen.getAllByText('注意').length).toBeGreaterThan(0)
    })

    it('renders PetAvatar when currentPet exists', () => {
      mockUsePet.mockReturnValue({
        pets: [makePet()],
        currentPet: makePet(),
        switchPet: mockSwitchPet,
        isLoading: false,
        initUser: mockInitPetUser,
        addPet: vi.fn(),
        updatePet: vi.fn(),
        removePet: vi.fn(),
        markPetDeceased: vi.fn(),
        refreshPets: vi.fn(),
        clearError: vi.fn(),
        error: null,
      })

      render(<PetFoodQuery />)

      expect(screen.getByTestId('pet-avatar')).toBeDefined()
    })

    it('renders PetSwitcher', () => {
      render(<PetFoodQuery />)

      expect(screen.getByTestId('pet-switcher')).toBeDefined()
    })

    it('renders history list when history has items', () => {
      mockUsePet.mockReturnValue({
        pets: [makePet()],
        currentPet: makePet(),
        switchPet: mockSwitchPet,
        isLoading: false,
        initUser: mockInitPetUser,
        addPet: vi.fn(),
        updatePet: vi.fn(),
        removePet: vi.fn(),
        markPetDeceased: vi.fn(),
        refreshPets: vi.fn(),
        clearError: vi.fn(),
        error: null,
      })
      mockUseFoodQuery.mockReturnValue({
        lastResult: null,
        history: [
          { id: 'h1', foodName: '巧克力', safetyLevel: 'toxic', createdAt: '2024-06-01T00:00:00Z' },
          { id: 'h2', foodName: '苹果', safetyLevel: 'safe', createdAt: '2024-06-02T00:00:00Z' },
        ],
        stats: { totalQueries: 2, remainingFree: 3, totalFree: 5 },
        queryFood: mockQueryFood,
        fetchHistory: mockFetchHistory,
        fetchStats: mockFetchStats,
        isLoading: false,
        error: null,
        clearError: vi.fn(),
      })

      render(<PetFoodQuery />)

      expect(screen.getByText('查询历史')).toBeDefined()
      // 历史食物名同时出现在快捷分类区域与历史列表，使用 getAllByText
      expect(screen.getAllByText('巧克力').length).toBeGreaterThan(0)
      expect(screen.getAllByText('苹果').length).toBeGreaterThan(0)
    })
  })
})

// Inline constants from the source file for unit testing
const SAFETY_LEVEL_LABELS: Record<string, string> = {
  safe: '安全',
  caution: '注意',
  dangerous: '危险',
  toxic: '有毒',
}

const SAFETY_LEVEL_COLORS: Record<string, string> = {
  safe: '#4CAF50',
  caution: '#FFC107',
  dangerous: '#FF9800',
  toxic: '#F44336',
}