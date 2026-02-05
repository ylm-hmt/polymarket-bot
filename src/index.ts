import { Config } from "./config/Config";
import { MarketDataService } from "./market/MarketDataService";
import { ArbitrageDetector } from "./arbitrage/ArbitrageDetector";
import { OrderExecutor } from "./trading/OrderExecutor";
import { RiskManager } from "./trading/RiskManager";
import { Dashboard } from "./ui/Dashboard";
import { Logger } from "./ui/Logger";
import { Market, ArbitrageOpportunity, MonitorMode, Balance } from "./types";

// Patch console.error to filter out verbose CLOB Client logs
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  if (
    typeof args[0] === "string" &&
    (args[0].includes("[CLOB Client]") ||
      args[0].includes("No orderbook exists"))
  ) {
    return;
  }
  originalConsoleError(...args);
};

/**
 * Polymarket 套利机器人主控制器
 */
class ArbitrageBot {
  private config: Config;
  private marketDataService: MarketDataService;
  private arbitrageDetector: ArbitrageDetector;
  private orderExecutor: OrderExecutor;
  private riskManager: RiskManager;
  private dashboard: Dashboard | null = null;
  private logger: Logger;

  private isRunning: boolean = false;
  private markets: Market[] = [];
  private scanInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.logger = Logger.getInstance();
    this.config = Config.getInstance();

    const cfg = this.config.getConfig();

    // 初始化各模块
    this.marketDataService = new MarketDataService(cfg.privateKey);
    this.arbitrageDetector = new ArbitrageDetector(
      this.marketDataService,
      cfg.minProfitThreshold,
      cfg.enabledStrategies,
    );
    this.orderExecutor = new OrderExecutor(cfg.privateKey);
    this.riskManager = new RiskManager(
      cfg.maxPositionSize,
      cfg.minPositionSize,
      cfg.dailyMaxLoss,
      cfg.maxConcurrentPositions,
      cfg.enableRiskManagement,
    );

    // 初始化可视化面板
    if (cfg.enableDashboard) {
      this.dashboard = new Dashboard();
      // 将 dashboard 连接到 logger，接管日志输出
      this.logger.setDashboard(this.dashboard);
    }
  }

  /**
   * 启动机器人
   */
  public async start(): Promise<void> {
    try {
      this.showBanner();
      this.config.printSummary();

      if (this.dashboard) {
        this.dashboard.showWelcome();
      }

      this.logger.info("正在启动 Polymarket 套利机器人...");

      // 获取初始余额
      const balance = await this.orderExecutor.getBalance();
      this.logger.info(`账户余额: $${balance.usdc.toFixed(2)} USDC`);

      if (this.dashboard) {
        this.dashboard.updateBalance({ ...balance, timestamp: Date.now() });
      }

      // 加载市场数据
      await this.loadMarkets();

      this.isRunning = true;
      this.logger.success("机器人启动成功！开始监控套利机会...");

      if (this.dashboard) {
        this.dashboard.log("机器人启动成功！", "success");
      }

      // 开始扫描循环
      this.startScanLoop();
    } catch (error) {
      this.logger.error("机器人启动失败", error as Error);
      process.exit(1);
    }
  }

  /**
   * 加载市场数据
   */
  private async loadMarkets(): Promise<void> {
    const cfg = this.config.getConfig();

    this.logger.info("正在加载市场数据...");

    if (this.dashboard) {
      this.dashboard.log("正在加载市场数据...", "info");
    }

    switch (cfg.monitorMode) {
      case MonitorMode.ALL:
        this.markets = await this.marketDataService.getActiveMarkets();
        break;

      case MonitorMode.CATEGORY:
        const allMarkets: Market[] = [];
        for (const category of cfg.monitorCategories) {
          const categoryMarkets =
            await this.marketDataService.getActiveMarkets(category);
          allMarkets.push(...categoryMarkets);
        }
        this.markets = allMarkets;
        break;

      case MonitorMode.CUSTOM:
        this.markets = [];
        for (const marketId of cfg.customMarketIds) {
          const market = await this.marketDataService.getMarket(marketId);
          if (market) {
            this.markets.push(market);
          }
        }
        break;
    }

    // 过滤流动性不足的市场
    this.markets = this.markets.filter(m =>
      m.tokens.some(t => t.liquidity >= cfg.minLiquidity),
    );

    this.logger.info(`已加载 ${this.markets.length} 个符合条件的市场`);

    if (this.dashboard) {
      this.dashboard.updateMarkets(this.markets);
      this.dashboard.log(`已加载 ${this.markets.length} 个市场`, "success");
    }
  }

  /**
   * 开始扫描循环
   */
  private startScanLoop(): void {
    const scanIntervalMs = 10000; // 每10秒扫描一次
    const marketRefreshIntervalMs = 30 * 60 * 1000; // 每30分钟刷新一次市场
    let lastMarketRefresh = Date.now();
    let isScanning = false;

    const scan = async () => {
      if (!this.isRunning) return;
      if (isScanning) {
        this.logger.debug("上一次扫描尚未完成，跳过本次扫描");
        return;
      }

      isScanning = true;

      try {
        // 检查是否需要刷新市场数据
        if (Date.now() - lastMarketRefresh > marketRefreshIntervalMs) {
          this.logger.info("定期刷新市场数据...");
          await this.loadMarkets();
          lastMarketRefresh = Date.now();
        }

        // 检查是否需要紧急停止
        if (this.riskManager.shouldEmergencyStop()) {
          this.logger.warn("触发紧急停止机制，暂停交易");
          if (this.dashboard) {
            this.dashboard.log("触发紧急停止！", "error");
          }
          return;
        }

        // 重置每日统计
        this.riskManager.resetDailyStats();

        // 扫描套利机会
        const opportunities = await this.arbitrageDetector.scanOpportunities(
          this.markets,
        );

        if (this.dashboard) {
          this.dashboard.updateOpportunities(opportunities);
          this.dashboard.updateStats(this.riskManager.getStats());
        }

        // 处理机会
        for (const opportunity of opportunities) {
          await this.processOpportunity(opportunity);
        }

        // 清理过期机会
        this.arbitrageDetector.clearOldOpportunities();

        // 更新余额
        const balance = await this.orderExecutor.getBalance();
        if (this.dashboard) {
          this.dashboard.updateBalance({ ...balance, timestamp: Date.now() });
        }
      } catch (error) {
        this.logger.error("扫描循环出错", error as Error);
        if (this.dashboard) {
          this.dashboard.log(`扫描出错: ${(error as Error).message}`, "error");
        }
      } finally {
        isScanning = false;
      }
    };

    // 立即执行一次
    scan();

    // 设置定时扫描
    this.scanInterval = setInterval(scan, scanIntervalMs);
  }

  /**
   * 处理套利机会
   */
  private async processOpportunity(
    opportunity: ArbitrageOpportunity,
  ): Promise<void> {
    try {
      // 获取当前余额
      const balance = await this.orderExecutor.getBalance();
      const balanceObj: Balance = { ...balance, timestamp: Date.now() };

      // 风险评估
      const evaluation = await this.riskManager.evaluateOpportunity(
        opportunity,
        balanceObj,
      );

      if (!evaluation.approved) {
        this.logger.debug(`机会被拒绝: ${evaluation.reason}`);
        if (this.dashboard) {
          this.dashboard.log(`机会被拒绝: ${evaluation.reason}`, "warn");
        }
        return;
      }

      this.logger.info(`正在执行套利交易: ${opportunity.id}`);
      if (this.dashboard) {
        this.dashboard.log(
          `执行套利: +${opportunity.profitPercentage.toFixed(2)}%`,
          "info",
        );
      }

      // 执行交易
      const results = await this.orderExecutor.executeTrades(
        opportunity.trades,
      );

      // 检查结果
      const allSuccess = results.every(r => r.status === "FILLED");

      if (allSuccess) {
        this.riskManager.recordTrade(opportunity.expectedProfit, true);
        this.logger.success(
          `套利成功！利润: $${opportunity.expectedProfit.toFixed(4)}`,
        );
        if (this.dashboard) {
          this.dashboard.log(
            `套利成功！+$${opportunity.expectedProfit.toFixed(4)}`,
            "success",
          );
        }
      } else {
        this.riskManager.recordTrade(0, false);
        this.logger.warn("套利部分失败");
        if (this.dashboard) {
          this.dashboard.log("套利执行失败", "error");
        }
      }

      // 更新统计
      if (this.dashboard) {
        this.dashboard.updateStats(this.riskManager.getStats());
      }
    } catch (error) {
      this.logger.error("处理套利机会失败", error as Error);
      this.riskManager.recordTrade(0, false);
    }
  }

  /**
   * 停止机器人
   */
  public stop(): void {
    this.isRunning = false;

    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }

    this.logger.info("机器人已停止");
    this.riskManager.printRiskSummary({
      usdc: 0,
      matic: 0,
      timestamp: Date.now(),
    });
  }

  /**
   * 显示欢迎横幅
   */
  private showBanner(): void {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   ██████╗  ██████╗ ██╗  ██╗   ██╗███╗   ███╗ █████╗ ██████╗ ██╗  ██╗     ║
║   ██╔══██╗██╔═══██╗██║  ╚██╗ ██╔╝████╗ ████║██╔══██╗██╔══██╗██║ ██╔╝     ║
║   ██████╔╝██║   ██║██║   ╚████╔╝ ██╔████╔██║███████║██████╔╝█████╔╝      ║
║   ██╔═══╝ ██║   ██║██║    ╚██╔╝  ██║╚██╔╝██║██╔══██║██╔══██╗██╔═██╗      ║
║   ██║     ╚██████╔╝███████╗██║   ██║ ╚═╝ ██║██║  ██║██║  ██║██║  ██╗     ║
║   ╚═╝      ╚═════╝ ╚══════╝╚═╝   ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝     ║
║                                                                           ║
║                  🤖 自动化套利交易机器人 v1.0.0                           ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
    `);
  }
}

// 主入口
async function main() {
  const bot = new ArbitrageBot();

  // 处理退出信号
  process.on("SIGINT", () => {
    console.log("\n正在关闭机器人...");
    bot.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    bot.stop();
    process.exit(0);
  });

  await bot.start();
}

main().catch(error => {
  console.error("启动失败:", error);
  process.exit(1);
});
