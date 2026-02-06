import {
  Market,
  ArbitrageOpportunity,
  ArbitrageStrategy,
  RiskLevel,
  OrderSide,
  OrderType,
} from "../types";
import { MarketDataService } from "../market/MarketDataService";
import { PriceHistory } from "../market/PriceHistory";
import { Logger } from "../ui/Logger";

/**
 * 套利机会检测器
 * 实现多种套利策略的检测逻辑
 */
export class ArbitrageDetector {
  private logger: Logger;
  private opportunities: ArbitrageOpportunity[] = [];
  private priceHistory: PriceHistory;
  
  // Polymarket 交易费用率 (~1% per side, 2% round-trip)
  private readonly TRADING_FEE_RATE = 0.01;
  
  private lastScanStats: {
    totalMarkets: number;
    binaryMarkets: number;
    marketsMissingTokenId: number;
    marketsMissingPrices: number;
    minAskSum: number | null;
    bestAskSums: { marketId: string; askSum: number; question: string }[];
  } = {
    totalMarkets: 0,
    binaryMarkets: 0,
    marketsMissingTokenId: 0,
    marketsMissingPrices: 0,
    minAskSum: null,
    bestAskSums: [],
  };

  constructor(
    private marketDataService: MarketDataService,
    private minProfitThreshold: number,
    private enabledStrategies: ArbitrageStrategy[],
  ) {
    this.logger = Logger.getInstance();
    this.priceHistory = new PriceHistory();
  }

  /**
   * 扫描套利机会
   */
  public async scanOpportunities(
    markets: Market[],
  ): Promise<ArbitrageOpportunity[]> {
    this.opportunities = [];
    this.lastScanStats = {
      totalMarkets: markets.length,
      binaryMarkets: 0,
      marketsMissingTokenId: 0,
      marketsMissingPrices: 0,
      minAskSum: null,
      bestAskSums: [],
    };

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
          this.lastScanStats.binaryMarkets++;

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
    if (this.lastScanStats.binaryMarkets > 0) {
      const minAskSumText =
        this.lastScanStats.minAskSum == null
          ? "N/A"
          : `$${this.lastScanStats.minAskSum.toFixed(4)}`;
      this.logger.info(
        `扫描统计: 二元市场 ${this.lastScanStats.binaryMarkets}/${this.lastScanStats.totalMarkets}，` +
          `tokenId 缺失 ${this.lastScanStats.marketsMissingTokenId}，` +
          `订单簿缺失 ${this.lastScanStats.marketsMissingPrices}，` +
          `最低 YES+NO ask ${minAskSumText}`,
      );

      if (this.lastScanStats.bestAskSums.length > 0) {
        const top = this.lastScanStats.bestAskSums
          .sort((a, b) => a.askSum - b.askSum)
          .slice(0, 5)
          .map(
            x =>
              `${x.askSum.toFixed(4)} ${x.marketId} ${x.question.substring(0, 60)}`,
          )
          .join(" | ");
        this.logger.info(`最低 askSum 候选(Top5): ${top}`);
      }
    }

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

      if (!yesToken.tokenId || !noToken.tokenId) {
        this.lastScanStats.marketsMissingTokenId++;
        this.logger.debug(
          `跳过市场（缺少 tokenId）: ${market.id} ${market.question?.slice(0, 60) || ""}`,
        );
        return;
      }

      // 并行获取最优价格
      const [yesPrices, noPrices] = await Promise.all([
        this.marketDataService.getBestPrices(yesToken.tokenId),
        this.marketDataService.getBestPrices(noToken.tokenId),
      ]);

      if (!yesPrices || !noPrices) {
        this.lastScanStats.marketsMissingPrices++;
        return;
      }

      const buyCost = yesPrices.ask + noPrices.ask;
      if (
        this.lastScanStats.minAskSum == null ||
        buyCost < this.lastScanStats.minAskSum
      ) {
        this.lastScanStats.minAskSum = buyCost;
      }
      this.lastScanStats.bestAskSums.push({
        marketId: market.id,
        askSum: buyCost,
        question: market.question || "",
      });

      if (buyCost < 1.0) {
        // 计算扣除费用后的实际利润
        // 买入时付费 + 市场结算时付费 = 双边费用
        const totalFees = buyCost * this.TRADING_FEE_RATE * 2;
        const grossProfit = 1.0 - buyCost;
        const netProfit = grossProfit - totalFees;
        const profitPercentage = (netProfit / buyCost) * 100;

        if (profitPercentage >= this.minProfitThreshold && netProfit > 0) {
          this.addOpportunity({
            id: `${market.id}_imbalance_buy_${Date.now()}`,
            strategy: ArbitrageStrategy.PRICE_IMBALANCE,
            marketId: market.id,
            description: `${market.question}\n💡 买入 YES($${yesPrices.ask.toFixed(3)}) + NO($${noPrices.ask.toFixed(3)}) = $${buyCost.toFixed(3)} < $1.00\n📊 毛利润: $${grossProfit.toFixed(4)} | 费用: $${totalFees.toFixed(4)} | 净利润: $${netProfit.toFixed(4)}`,
            expectedProfit: netProfit,
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
   * 寻找相关市场间的价格差异（逻辑不一致）
   * 
   * 类型1: 嵌套市场 - "X > 50k" vs "X > 60k" (后者概率不应高于前者)
   * 类型2: 相关事件 - 同类别中相似问题但价格差异大
   */
  private async detectCrossMarket(
    market: Market,
    allMarkets: Market[],
  ): Promise<void> {
    try {
      // 提取市场问题中的关键信息
      const marketInfo = this.parseMarketQuestion(market.question);
      if (!marketInfo) return;

      // 寻找逻辑相关的市场
      for (const otherMarket of allMarkets) {
        if (otherMarket.id === market.id) continue;
        
        const otherInfo = this.parseMarketQuestion(otherMarket.question);
        if (!otherInfo) continue;

        // 检查是否是嵌套条件（同一资产，不同阈值）
        if (marketInfo.asset === otherInfo.asset && 
            marketInfo.direction === otherInfo.direction &&
            marketInfo.threshold !== otherInfo.threshold) {
          
          await this.checkNestedMarketArbitrage(market, otherMarket, marketInfo, otherInfo);
        }

        // 检查高相似度但价格差异大的市场
        const similarity = this.calculateSimilarity(market.question, otherMarket.question);
        if (similarity > 0.7 && similarity < 0.95) {
          await this.checkSimilarMarketArbitrage(market, otherMarket);
        }
      }
    } catch (error) {
      this.logger.error(`检测跨市场套利失败: ${market.id}`, error as Error);
    }
  }

  /**
   * 解析市场问题提取关键信息
   */
  private parseMarketQuestion(question: string): { asset: string; direction: string; threshold: number } | null {
    // 匹配模式: "Will BTC hit 100k", "BTC above 50000", "Bitcoin > 60k"
    const patterns = [
      /will\s+(\w+)\s+(hit|reach|above|below|>|<)\s+\$?([\d,.]+)k?/i,
      /(\w+)\s+(above|below|>|<|hit|reach)\s+\$?([\d,.]+)k?/i,
    ];

    for (const pattern of patterns) {
      const match = question.match(pattern);
      if (match) {
        const asset = match[1].toUpperCase();
        const direction = match[2].toLowerCase();
        let threshold = parseFloat(match[3].replace(/,/g, ''));
        
        // 处理 "100k" 这样的格式
        if (question.toLowerCase().includes(match[3] + 'k')) {
          threshold *= 1000;
        }

        return { asset, direction, threshold };
      }
    }
    return null;
  }

  /**
   * 检查嵌套市场套利
   * 例如: "BTC > 50k" 概率应 >= "BTC > 60k" 概率
   */
  private async checkNestedMarketArbitrage(
    market1: Market,
    market2: Market,
    info1: { threshold: number },
    info2: { threshold: number },
  ): Promise<void> {
    const prices1 = await this.marketDataService.getBestPrices(market1.tokens[0].tokenId);
    const prices2 = await this.marketDataService.getBestPrices(market2.tokens[0].tokenId);

    if (!prices1 || !prices2) return;

    const prob1 = (prices1.bid + prices1.ask) / 2;
    const prob2 = (prices2.bid + prices2.ask) / 2;

    // 如果阈值更高的市场概率反而更高，存在逻辑矛盾
    const lowerThresholdMarket = info1.threshold < info2.threshold ? market1 : market2;
    const higherThresholdMarket = info1.threshold < info2.threshold ? market2 : market1;
    const lowerThresholdProb = info1.threshold < info2.threshold ? prob1 : prob2;
    const higherThresholdProb = info1.threshold < info2.threshold ? prob2 : prob1;

    // 高阈值概率不应超过低阈值概率
    if (higherThresholdProb > lowerThresholdProb + 0.02) { // 2% 容忍度
      const profitGap = higherThresholdProb - lowerThresholdProb;
      const profitPercentage = profitGap * 100;

      if (profitPercentage >= this.minProfitThreshold) {
        this.addOpportunity({
          id: `crossmarket_nested_${market1.id}_${market2.id}_${Date.now()}`,
          strategy: ArbitrageStrategy.CROSS_MARKET,
          marketId: market1.id,
          description: `嵌套市场套利\n🔗 ${lowerThresholdMarket.question.substring(0, 50)}... (${(lowerThresholdProb*100).toFixed(1)}%)\n🔗 ${higherThresholdMarket.question.substring(0, 50)}... (${(higherThresholdProb*100).toFixed(1)}%)\n💡 概率逻辑矛盾: 低阈值应≥高阈值`,
          expectedProfit: profitGap,
          profitPercentage,
          requiredCapital: 2, // 需要在两个市场各买入
          trades: [], // 跨市场交易需手动执行
          timestamp: Date.now(),
          risk: RiskLevel.HIGH,
        });
      }
    }
  }

  /**
   * 检查相似市场套利
   */
  private async checkSimilarMarketArbitrage(market1: Market, market2: Market): Promise<void> {
    const prices1 = await this.marketDataService.getBestPrices(market1.tokens[0].tokenId);
    const prices2 = await this.marketDataService.getBestPrices(market2.tokens[0].tokenId);

    if (!prices1 || !prices2) return;

    const prob1 = (prices1.bid + prices1.ask) / 2;
    const prob2 = (prices2.bid + prices2.ask) / 2;
    const priceDiff = Math.abs(prob1 - prob2);
    const profitPercentage = priceDiff * 100;

    if (profitPercentage >= this.minProfitThreshold * 2) { // 更保守的阈值
      this.addOpportunity({
        id: `crossmarket_similar_${market1.id}_${market2.id}_${Date.now()}`,
        strategy: ArbitrageStrategy.CROSS_MARKET,
        marketId: market1.id,
        description: `相似市场套利\n🔗 ${market1.question.substring(0, 50)}... (${(prob1*100).toFixed(1)}%)\n🔗 ${market2.question.substring(0, 50)}... (${(prob2*100).toFixed(1)}%)\n💡 价格差异: ${(priceDiff*100).toFixed(1)}%`,
        expectedProfit: priceDiff,
        profitPercentage,
        requiredCapital: 2,
        trades: [],
        timestamp: Date.now(),
        risk: RiskLevel.HIGH,
      });
    }
  }

  /**
   * 策略3: 时间套利 (均值回归)
   * 基于历史价格波动检测显著偏离，预期价格会回归均值
   */
  private async detectTimeBased(market: Market): Promise<void> {
    try {
      const token = market.tokens[0];
      if (!token.tokenId) return;

      const prices = await this.marketDataService.getBestPrices(token.tokenId);
      if (!prices) return;

      const midPrice = (prices.bid + prices.ask) / 2;

      // 记录价格历史
      this.priceHistory.record(token.tokenId, midPrice);

      // 获取 Z-score（当前价格偏离均值的程度）
      const zScore = this.priceHistory.getZScore(token.tokenId, midPrice);
      if (zScore === null) return; // 数据不足

      // 获取统计信息
      const stats = this.priceHistory.getStats(token.tokenId);
      if (!stats.mean || stats.count < 10) return;

      // Z-score 阈值：|Z| > 2 表示显著偏离
      const Z_THRESHOLD = 2.0;

      if (Math.abs(zScore) >= Z_THRESHOLD) {
        const trend = this.priceHistory.getTrend(token.tokenId);
        const expectedReversion = stats.mean;
        const potentialProfit = Math.abs(midPrice - expectedReversion);
        const profitPercentage = (potentialProfit / midPrice) * 100;

        // 计算扣除费用后的净利润
        const netProfitPercentage = profitPercentage - (this.TRADING_FEE_RATE * 2 * 100);

        if (netProfitPercentage >= this.minProfitThreshold) {
          // 确定交易方向：价格高于均值则卖出预期回落，低于均值则买入预期回升
          const side = zScore > 0 ? OrderSide.SELL : OrderSide.BUY;
          const directionDesc = zScore > 0 ? '📉 价格偏高，预期回落' : '📈 价格偏低，预期回升';

          this.addOpportunity({
            id: `timebased_${market.id}_${Date.now()}`,
            strategy: ArbitrageStrategy.TIME_BASED,
            marketId: market.id,
            description: `${market.question}\n${directionDesc}\n📊 当前: $${midPrice.toFixed(3)} | 均值: $${expectedReversion.toFixed(3)} | Z-score: ${zScore.toFixed(2)}\n📈 趋势: ${trend > 0 ? '上涨' : trend < 0 ? '下跌' : '平稳'}`,
            expectedProfit: potentialProfit,
            profitPercentage: netProfitPercentage,
            requiredCapital: midPrice,
            trades: [
              {
                marketId: market.id,
                tokenId: token.tokenId,
                side: side,
                type: OrderType.LIMIT,
                price: midPrice,
                amount: 1,
              },
            ],
            timestamp: Date.now(),
            risk: Math.abs(zScore) > 3 ? RiskLevel.MEDIUM : RiskLevel.HIGH,
          });

          this.logger.debug(
            `发现均值回归机会: ${market.question.substring(0, 40)}... Z=${zScore.toFixed(2)}`,
          );
        }
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
