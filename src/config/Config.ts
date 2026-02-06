import dotenv from "dotenv";
import { BotConfig, ArbitrageStrategy, MonitorMode } from "../types";

dotenv.config();

/**
 * 配置管理类
 * 负责加载和验证环境变量配置
 */
export class Config {
  private static instance: Config;
  private config: BotConfig;

  private constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  /**
   * 获取配置单例
   */
  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  /**
   * 获取配置对象
   */
  public getConfig(): BotConfig {
    return { ...this.config };
  }

  /**
   * 从环境变量加载配置
   */
  private loadConfig(): BotConfig {
    return {
      // 钱包配置
      privateKey: process.env.PRIVATE_KEY || "",

      // API 配置
      clobApiUrl: process.env.CLOB_API_URL || "https://clob.polymarket.com",
      clobWsUrl:
        process.env.CLOB_WS_URL ||
        "wss://ws-subscriptions-clob.polymarket.com/ws/market",

      // 交易参数
      minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || "2.0"),
      maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || "100.0"),
      minPositionSize: parseFloat(process.env.MIN_POSITION_SIZE || "10.0"),
      maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || "1.0"),
      dailyMaxLoss: parseFloat(process.env.DAILY_MAX_LOSS || "50.0"),

      // 策略配置
      enabledStrategies: this.parseStrategies(
        process.env.ENABLED_STRATEGIES || "PRICE_IMBALANCE",
      ),

      // 监控配置
      monitorMode: this.parseMonitorMode(
        process.env.MONITOR_MODE || "CATEGORY",
      ),
      monitorCategories: this.parseArray(
        process.env.MONITOR_CATEGORIES || "crypto,politics",
      ),
      customMarketIds: this.parseArray(process.env.CUSTOM_MARKET_IDS || ""),
      minLiquidity: parseFloat(process.env.MIN_LIQUIDITY || "1000.0"),
      maxMarkets: parseInt(process.env.MAX_MARKETS || "300"),
      maxPages: parseInt(process.env.MAX_PAGES || "3"),
      marketsPerPage: parseInt(process.env.MARKETS_PER_PAGE || "100"),

      // 风险管理
      enableRiskManagement: process.env.ENABLE_RISK_MANAGEMENT !== "false",
      maxConcurrentPositions: parseInt(
        process.env.MAX_CONCURRENT_POSITIONS || "5",
      ),
      orderTimeout: parseInt(process.env.ORDER_TIMEOUT || "30"),

      // 系统配置
      logLevel: process.env.LOG_LEVEL || "info",
      enableDashboard: process.env.ENABLE_DASHBOARD !== "false",
      wsReconnectInterval: parseInt(
        process.env.WS_RECONNECT_INTERVAL || "5000",
      ),
      apiTimeout: parseInt(process.env.API_TIMEOUT || "10000"),
      apiMaxRetries: parseInt(process.env.API_MAX_RETRIES || "4"),
    };
  }

  /**
   * 解析策略配置
   */
  private parseStrategies(strategiesStr: string): ArbitrageStrategy[] {
    return strategiesStr
      .split(",")
      .map(s => s.trim())
      .filter(s => s in ArbitrageStrategy)
      .map(s => s as ArbitrageStrategy);
  }

  /**
   * 解析监控模式
   */
  private parseMonitorMode(mode: string): MonitorMode {
    return mode.toUpperCase() in MonitorMode
      ? (mode.toUpperCase() as MonitorMode)
      : MonitorMode.CATEGORY;
  }

  /**
   * 解析数组配置
   */
  private parseArray(str: string): string[] {
    return Array.from(
      new Set(
        str
          .split(",")
          .map(s => s.trim())
          .filter(s => s.length > 0),
      ),
    );
  }

  /**
   * 验证配置
   */
  private validateConfig(): void {
    const errors: string[] = [];

    // 验证私钥
    if (
      !this.config.privateKey ||
      this.config.privateKey === "your_private_key_here"
    ) {
      errors.push("❌ 错误：未配置 PRIVATE_KEY（钱包私钥）");
    } else if (this.config.privateKey.length !== 64) {
      errors.push("❌ 错误：PRIVATE_KEY 格式不正确（应为 64 位十六进制字符）");
    }

    // 验证交易参数
    if (this.config.minProfitThreshold <= 0) {
      errors.push("❌ 错误：MIN_PROFIT_THRESHOLD 必须大于 0");
    }

    if (this.config.maxPositionSize <= 0) {
      errors.push("❌ 错误：MAX_POSITION_SIZE 必须大于 0");
    }

    if (this.config.minPositionSize <= 0) {
      errors.push("❌ 错误：MIN_POSITION_SIZE 必须大于 0");
    }

    if (this.config.minPositionSize > this.config.maxPositionSize) {
      errors.push("❌ 错误：MIN_POSITION_SIZE 不能大于 MAX_POSITION_SIZE");
    }

    if (this.config.maxSlippage < 0 || this.config.maxSlippage > 100) {
      errors.push("❌ 错误：MAX_SLIPPAGE 必须在 0-100 之间");
    }

    // 验证策略配置
    if (this.config.enabledStrategies.length === 0) {
      errors.push("❌ 错误：至少需要启用一种套利策略");
    }

    // 验证监控配置
    if (
      this.config.monitorMode === MonitorMode.CATEGORY &&
      this.config.monitorCategories.length === 0
    ) {
      errors.push("❌ 错误：CATEGORY 模式下必须指定 MONITOR_CATEGORIES");
    }

    if (
      this.config.monitorMode === MonitorMode.CUSTOM &&
      this.config.customMarketIds.length === 0
    ) {
      errors.push("❌ 错误：CUSTOM 模式下必须指定 CUSTOM_MARKET_IDS");
    }

    // 如果有错误，抛出异常
    if (errors.length > 0) {
      throw new Error("\n配置验证失败：\n" + errors.join("\n"));
    }
  }

  /**
   * 打印配置摘要（隐藏敏感信息）
   */
  public printSummary(): void {
    const maskPrivateKey = (key: string): string => {
      if (!key || key.length < 10) return "***";
      return key.substring(0, 6) + "..." + key.substring(key.length - 4);
    };

    console.log("\n📋 配置摘要：");
    console.log("━".repeat(60));
    console.log(`🔑 钱包私钥: ${maskPrivateKey(this.config.privateKey)}`);
    console.log(`🌐 CLOB API: ${this.config.clobApiUrl}`);
    console.log(`\n💰 交易参数：`);
    console.log(`   最小利润率: ${this.config.minProfitThreshold}%`);
    console.log(
      `   单笔金额范围: $${this.config.minPositionSize} - $${this.config.maxPositionSize}`,
    );
    console.log(`   最大滑点: ${this.config.maxSlippage}%`);
    console.log(`   每日最大损失: $${this.config.dailyMaxLoss}`);
    console.log(`\n🎯 启用的策略：`);
    this.config.enabledStrategies.forEach(s => {
      const name = this.getStrategyName(s);
      console.log(`   ✓ ${name}`);
    });
    console.log(`\n📊 监控配置：`);
    console.log(`   模式: ${this.config.monitorMode}`);
    if (this.config.monitorMode === MonitorMode.CATEGORY) {
      console.log(`   类别: ${this.config.monitorCategories.join(", ")}`);
    }
    console.log(`   最小流动性: $${this.config.minLiquidity}`);
    console.log(`   最大市场数量: ${this.config.maxMarkets}`);
    console.log(`\n🛡️ 风险管理：`);
    console.log(`   启用: ${this.config.enableRiskManagement ? "是" : "否"}`);
    console.log(`   最大持仓数: ${this.config.maxConcurrentPositions}`);
    console.log(`\n⚙️ 系统配置：`);
    console.log(`   日志级别: ${this.config.logLevel}`);
    console.log(
      `   监控面板: ${this.config.enableDashboard ? "启用" : "禁用"}`,
    );
    console.log("━".repeat(60) + "\n");
  }

  /**
   * 获取策略中文名称
   */
  private getStrategyName(strategy: ArbitrageStrategy): string {
    const names: Record<ArbitrageStrategy, string> = {
      [ArbitrageStrategy.PRICE_IMBALANCE]: "价格不平衡套利",
      [ArbitrageStrategy.CROSS_MARKET]: "跨市场套利",
      [ArbitrageStrategy.TIME_BASED]: "时间套利",
    };
    return names[strategy];
  }
}
