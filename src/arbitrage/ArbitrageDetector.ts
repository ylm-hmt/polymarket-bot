import {
  Market,
  ArbitrageOpportunity,
  ArbitrageStrategy,
  RiskLevel,
  OrderSide,
  OrderType,
} from "../types";
import { MarketDataService } from "../market/MarketDataService";
import { Logger } from "../ui/Logger";

/**
 * 套利机会检测器
 * 实现多种套利策略的检测逻辑
 */
export class ArbitrageDetector {
  private logger: Logger;
  private opportunities: ArbitrageOpportunity[] = [];

  constructor(
    private marketDataService: MarketDataService,
    private minProfitThreshold: number,
    private enabledStrategies: ArbitrageStrategy[],
  ) {
    this.logger = Logger.getInstance();
  }

  /**
   * 扫描套利机会
   */
  public async scanOpportunities(
    markets: Market[],
  ): Promise<ArbitrageOpportunity[]> {
    this.opportunities = [];

    const BATCH_SIZE = 20;
    let processed = 0;
    const total = markets.length;
    const logEvery = 100;

    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);

      if (processed % logEvery === 0) {
        this.logger.info(
          `正在扫描市场 ${processed + 1}-${Math.min(processed + logEvery, total)} / ${total}...`,
        );
      }

      await Promise.all(
        batch.map(async market => {
          // 只检查有两个结果的市场（YES/NO）
          if (market.tokens.length !== 2) return;

          for (const strategy of this.enabledStrategies) {
            switch (strategy) {
              case ArbitrageStrategy.PRICE_IMBALANCE:
                await this.detectPriceImbalance(market);
                break;
              case ArbitrageStrategy.CROSS_MARKET:
                await this.detectCrossMarket(market, markets);
                break;
              case ArbitrageStrategy.TIME_BASED:
                await this.detectTimeBased(market);
                break;
            }
          }
        }),
      );

      processed += batch.length;

      await new Promise(resolve => setTimeout(resolve, 50));
    }

    this.logger.info(`扫描完成，发现 ${this.opportunities.length} 个潜在机会`);

    return this.opportunities;
  }

  /**
   * 策略1: 价格不平衡套利
   * 当 YES + NO ≠ $1.00 时存在套利机会
   */
  private async detectPriceImbalance(market: Market): Promise<void> {
    try {
      const yesToken = market.tokens[0];
      const noToken = market.tokens[1];

      // 并行获取最优价格
      const [yesPrices, noPrices] = await Promise.all([
        this.marketDataService.getBestPrices(yesToken.tokenId),
        this.marketDataService.getBestPrices(noToken.tokenId),
      ]);

      if (!yesPrices || !noPrices) return;

      const buyCost = yesPrices.ask + noPrices.ask;

      if (buyCost < 1.0) {
        const profit = 1.0 - buyCost;
        const profitPercentage = (profit / buyCost) * 100;

        if (profitPercentage >= this.minProfitThreshold) {
          this.addOpportunity({
            id: `${market.id}_imbalance_buy_${Date.now()}`,
            strategy: ArbitrageStrategy.PRICE_IMBALANCE,
            marketId: market.id,
            description: `${market.question}\n💡 买入 YES($${yesPrices.ask.toFixed(3)}) + NO($${noPrices.ask.toFixed(3)}) = $${buyCost.toFixed(3)} < $1.00`,
            expectedProfit: profit,
            profitPercentage: profitPercentage,
            requiredCapital: buyCost,
            trades: [
              {
                marketId: market.id,
                tokenId: yesToken.tokenId,
                side: OrderSide.BUY,
                type: OrderType.MARKET,
                price: yesPrices.ask,
                amount: 1,
              },
              {
                marketId: market.id,
                tokenId: noToken.tokenId,
                side: OrderSide.BUY,
                type: OrderType.MARKET,
                price: noPrices.ask,
                amount: 1,
              },
            ],
            timestamp: Date.now(),
            risk: this.calculateRisk(profitPercentage, buyCost),
          });
        }
      }
      const midYes = (yesPrices.bid + yesPrices.ask) / 2;
      const midNo = (noPrices.bid + noPrices.ask) / 2;
      const midCost = midYes + midNo;
      if (midCost < 1.0) {
        const profit = 1.0 - midCost;
        const profitPercentage = (profit / midCost) * 100;
        if (profitPercentage >= this.minProfitThreshold) {
          this.addOpportunity({
            id: `${market.id}_imbalance_signal_${Date.now()}`,
            strategy: ArbitrageStrategy.PRICE_IMBALANCE,
            marketId: market.id,
            description: `${market.question}\n信号: 中间价 YES+NO = $${midCost.toFixed(3)} < $1.00`,
            expectedProfit: profit,
            profitPercentage,
            requiredCapital: midCost,
            trades: [],
            timestamp: Date.now(),
            risk: RiskLevel.HIGH,
          });
        }
      }
    } catch (error) {
      this.logger.error(`检测价格不平衡失败: ${market.id}`, error as Error);
    }
  }

  /**
   * 策略2: 跨市场套利
   * 寻找相关市场间的价格差异
   */
  private async detectCrossMarket(
    market: Market,
    allMarkets: Market[],
  ): Promise<void> {
    // 简化实现：寻找相似的市场
    // 实际应用中需要更复杂的市场关联分析
    try {
      const relatedMarkets = allMarkets.filter(
        m =>
          m.id !== market.id &&
          m.category === market.category &&
          this.calculateSimilarity(market.question, m.question) > 0.7,
      );

      for (const relatedMarket of relatedMarkets) {
        // 比较两个市场的价格
        const prices1 = await this.marketDataService.getBestPrices(
          market.tokens[0].tokenId,
        );
        const prices2 = await this.marketDataService.getBestPrices(
          relatedMarket.tokens[0].tokenId,
        );

        if (!prices1 || !prices2) continue;

        const priceDiff = Math.abs(prices1.ask - prices2.bid);
        const profitPercentage = (priceDiff / prices1.ask) * 100;

        if (profitPercentage >= this.minProfitThreshold) {
          this.logger.debug(
            `发现跨市场机会: ${market.question} vs ${relatedMarket.question}`,
          );
          // 可以在这里添加跨市场套利机会
        }
      }
    } catch (error) {
      this.logger.error(`检测跨市场套利失败: ${market.id}`, error as Error);
    }
  }

  /**
   * 策略3: 时间套利
   * 基于历史价格波动进行预测
   */
  private async detectTimeBased(market: Market): Promise<void> {
    // 简化实现：检查价格是否偏离合理范围
    try {
      const token = market.tokens[0];
      const prices = await this.marketDataService.getBestPrices(token.tokenId);

      if (!prices) return;

      const midPrice = (prices.bid + prices.ask) / 2;

      // 如果价格过于极端（< 0.1 或 > 0.9），可能会回归
      if (midPrice < 0.1 || midPrice > 0.9) {
        this.logger.debug(
          `发现极端价格: ${market.question} - 价格: ${midPrice.toFixed(3)}`,
        );
        // 可以在这里添加时间套利机会
      }
    } catch (error) {
      this.logger.error(`检测时间套利失败: ${market.id}`, error as Error);
    }
  }

  /**
   * 添加套利机会
   */
  private addOpportunity(opportunity: ArbitrageOpportunity): void {
    this.opportunities.push(opportunity);

    const riskEmoji = {
      [RiskLevel.LOW]: "🟢",
      [RiskLevel.MEDIUM]: "🟡",
      [RiskLevel.HIGH]: "🔴",
    };

    this.logger.opportunity(
      `发现套利机会！\n` +
        `   市场: ${opportunity.description.split("\n")[0].substring(0, 50)}...\n` +
        `   策略: ${this.getStrategyName(opportunity.strategy)}\n` +
        `   预期利润: $${opportunity.expectedProfit.toFixed(4)} (${opportunity.profitPercentage.toFixed(2)}%)\n` +
        `   所需资金: $${opportunity.requiredCapital.toFixed(2)}\n` +
        `   风险等级: ${riskEmoji[opportunity.risk]} ${opportunity.risk}`,
    );
  }

  /**
   * 计算风险等级
   */
  private calculateRisk(profitPercentage: number, capital: number): RiskLevel {
    if (profitPercentage >= 5 && capital <= 50) {
      return RiskLevel.LOW;
    } else if (profitPercentage >= 3 || capital <= 100) {
      return RiskLevel.MEDIUM;
    } else {
      return RiskLevel.HIGH;
    }
  }

  /**
   * 计算文本相似度（简化版）
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * 获取策略名称
   */
  private getStrategyName(strategy: ArbitrageStrategy): string {
    const names: Record<ArbitrageStrategy, string> = {
      [ArbitrageStrategy.PRICE_IMBALANCE]: "价格不平衡",
      [ArbitrageStrategy.CROSS_MARKET]: "跨市场",
      [ArbitrageStrategy.TIME_BASED]: "时间套利",
    };
    return names[strategy];
  }

  /**
   * 获取所有机会
   */
  public getOpportunities(): ArbitrageOpportunity[] {
    return [...this.opportunities];
  }

  /**
   * 清除已过期的机会
   */
  public clearOldOpportunities(maxAge: number = 60000): void {
    const now = Date.now();
    this.opportunities = this.opportunities.filter(
      op => now - op.timestamp < maxAge,
    );
  }
}
