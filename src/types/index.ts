/**
 * 核心类型定义
 */

export enum ArbitrageStrategy {
  PRICE_IMBALANCE = 'PRICE_IMBALANCE',     // 价格不平衡套利
  CROSS_MARKET = 'CROSS_MARKET',           // 跨市场套利
  TIME_BASED = 'TIME_BASED'                // 时间套利
}

export enum MonitorMode {
  ALL = 'ALL',                             // 监控所有市场
  CATEGORY = 'CATEGORY',                   // 监控指定类别
  CUSTOM = 'CUSTOM'                        // 自定义市场列表
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT'
}

export enum OrderStatus {
  PENDING = 'PENDING',
  FILLED = 'FILLED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED'
}

/**
 * 配置接口
 */
export interface BotConfig {
  // 钱包配置
  privateKey: string;
  
  // API 配置
  clobApiUrl: string;
  clobWsUrl: string;
  
  // 交易参数
  minProfitThreshold: number;
  maxPositionSize: number;
  minPositionSize: number;
  maxSlippage: number;
  dailyMaxLoss: number;
  
  // 策略配置
  enabledStrategies: ArbitrageStrategy[];
  
  // 监控配置
  monitorMode: MonitorMode;
  monitorCategories: string[];
  customMarketIds: string[];
  minLiquidity: number;
  
  // 风险管理
  enableRiskManagement: boolean;
  maxConcurrentPositions: number;
  orderTimeout: number;
  
  // 系统配置
  logLevel: string;
  enableDashboard: boolean;
  wsReconnectInterval: number;
  apiTimeout: number;
}

/**
 * 市场信息
 */
export interface Market {
  id: string;
  question: string;
  category: string;
  endDate: Date;
  active: boolean;
  closed: boolean;
  tokens: Token[];
}

/**
 * 代币信息
 */
export interface Token {
  tokenId: string;
  outcome: string;
  price: number;
  liquidity: number;
}

/**
 * 订单簿数据
 */
export interface OrderBook {
  marketId: string;
  tokenId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

/**
 * 套利机会
 */
export interface ArbitrageOpportunity {
  id: string;
  strategy: ArbitrageStrategy;
  marketId: string;
  description: string;
  expectedProfit: number;
  profitPercentage: number;
  requiredCapital: number;
  trades: Trade[];
  timestamp: number;
  risk: RiskLevel;
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH'
}

/**
 * 交易信息
 */
export interface Trade {
  marketId: string;
  tokenId: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  amount: number;
}

/**
 * 订单执行结果
 */
export interface OrderResult {
  orderId: string;
  status: OrderStatus;
  filledAmount: number;
  averagePrice: number;
  gasUsed?: number;
  error?: string;
}

/**
 * 持仓信息
 */
export interface Position {
  marketId: string;
  tokenId: string;
  amount: number;
  averagePrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  openedAt: number;
}

/**
 * 账户余额
 */
export interface Balance {
  usdc: number;
  matic: number;
  timestamp: number;
}

/**
 * 交易统计
 */
export interface TradingStats {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  winRate: number;
  averageProfit: number;
  largestProfit: number;
  largestLoss: number;
  dailyPnL: number;
}
