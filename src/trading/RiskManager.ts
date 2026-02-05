import { Position, Balance, TradingStats, ArbitrageOpportunity, Trade, RiskLevel } from '../types';
import { Logger } from '../ui/Logger';

/**
 * 风险管理器
 * 负责评估和控制交易风险
 */
export class RiskManager {
  private logger: Logger;
  private positions: Position[] = [];
  private dailyPnL: number = 0;
  private dailyStartTime: number = Date.now();
  private stats: TradingStats = {
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalProfit: 0,
    totalLoss: 0,
    netProfit: 0,
    winRate: 0,
    averageProfit: 0,
    largestProfit: 0,
    largestLoss: 0,
    dailyPnL: 0
  };

  constructor(
    private maxPositionSize: number,
    private minPositionSize: number,
    private dailyMaxLoss: number,
    private maxConcurrentPositions: number,
    private enableRiskManagement: boolean
  ) {
    this.logger = Logger.getInstance();
  }

  /**
   * 评估套利机会是否可执行
   */
  public async evaluateOpportunity(
    opportunity: ArbitrageOpportunity,
    balance: Balance
  ): Promise<{ approved: boolean; reason?: string; adjustedSize?: number }> {
    if (opportunity.trades.length === 0) {
      return { approved: false, reason: '信号机会（不自动执行）' };
    }
    if (!this.enableRiskManagement) {
      return { approved: true, adjustedSize: opportunity.requiredCapital };
    }

    // 检查1: 每日损失限制
    if (Math.abs(this.dailyPnL) >= this.dailyMaxLoss) {
      return {
        approved: false,
        reason: `已达到每日最大损失限额 $${this.dailyMaxLoss.toFixed(2)}`
      };
    }

    // 检查2: 账户余额充足性
    if (balance.usdc < opportunity.requiredCapital) {
      return {
        approved: false,
        reason: `账户余额不足: 需要 $${opportunity.requiredCapital.toFixed(2)}, 可用 $${balance.usdc.toFixed(2)}`
      };
    }

    // 检查3: 单笔交易金额限制
    if (opportunity.requiredCapital > this.maxPositionSize) {
      const adjustedSize = this.maxPositionSize;
      this.logger.warn(
        `交易金额超出限制，已调整:\n` +
        `   原金额: $${opportunity.requiredCapital.toFixed(2)}\n` +
        `   调整后: $${adjustedSize.toFixed(2)}`
      );
      return { approved: true, adjustedSize };
    }

    if (opportunity.requiredCapital < this.minPositionSize) {
      return {
        approved: false,
        reason: `交易金额低于最小限制 $${this.minPositionSize.toFixed(2)}`
      };
    }

    // 检查4: 最大持仓数量
    if (this.positions.length >= this.maxConcurrentPositions) {
      return {
        approved: false,
        reason: `已达到最大持仓数量 ${this.maxConcurrentPositions}`
      };
    }

    // 检查5: 风险等级评估
    if (opportunity.risk === RiskLevel.HIGH) {
      // 高风险交易需要更高的利润率
      if (opportunity.profitPercentage < 5.0) {
        return {
          approved: false,
          reason: `高风险交易要求利润率 ≥ 5%，当前: ${opportunity.profitPercentage.toFixed(2)}%`
        };
      }
    }

    // 检查6: 可用资金比例
    const positionPercentage = (opportunity.requiredCapital / balance.usdc) * 100;
    if (positionPercentage > 20) {
      this.logger.warn(
        `单笔交易占用资金较高: ${positionPercentage.toFixed(1)}% 的账户余额`
      );
    }

    return { approved: true, adjustedSize: opportunity.requiredCapital };
  }

  /**
   * 记录交易结果
   */
  public recordTrade(profit: number, success: boolean): void {
    this.stats.totalTrades++;
    
    if (success) {
      this.stats.successfulTrades++;
      
      if (profit > 0) {
        this.stats.totalProfit += profit;
        this.stats.largestProfit = Math.max(this.stats.largestProfit, profit);
      } else {
        this.stats.totalLoss += Math.abs(profit);
        this.stats.largestLoss = Math.max(this.stats.largestLoss, Math.abs(profit));
      }
      
      this.dailyPnL += profit;
    } else {
      this.stats.failedTrades++;
    }

    // 更新统计数据
    this.stats.netProfit = this.stats.totalProfit - this.stats.totalLoss;
    this.stats.winRate = this.stats.totalTrades > 0
      ? (this.stats.successfulTrades / this.stats.totalTrades) * 100
      : 0;
    this.stats.averageProfit = this.stats.successfulTrades > 0
      ? this.stats.netProfit / this.stats.successfulTrades
      : 0;
    this.stats.dailyPnL = this.dailyPnL;
  }

  /**
   * 添加持仓
   */
  public addPosition(position: Position): void {
    this.positions.push(position);
    this.logger.info(
      `新增持仓:\n` +
      `   市场: ${position.marketId}\n` +
      `   数量: ${position.amount}\n` +
      `   均价: $${position.averagePrice.toFixed(4)}`
    );
  }

  /**
   * 移除持仓
   */
  public removePosition(marketId: string, tokenId: string): void {
    const index = this.positions.findIndex(
      p => p.marketId === marketId && p.tokenId === tokenId
    );
    
    if (index !== -1) {
      const position = this.positions.splice(index, 1)[0];
      this.logger.info(`已平仓: ${position.marketId}`);
    }
  }

  /**
   * 获取当前持仓
   */
  public getPositions(): Position[] {
    return [...this.positions];
  }

  /**
   * 获取交易统计
   */
  public getStats(): TradingStats {
    return { ...this.stats };
  }

  /**
   * 重置每日统计
   */
  public resetDailyStats(): void {
    const now = Date.now();
    const hoursSinceStart = (now - this.dailyStartTime) / (1000 * 60 * 60);
    
    // 每24小时重置一次
    if (hoursSinceStart >= 24) {
      this.logger.info(
        `每日统计重置:\n` +
        `   今日盈亏: $${this.dailyPnL.toFixed(2)}\n` +
        `   累计盈亏: $${this.stats.netProfit.toFixed(2)}`
      );
      
      this.dailyPnL = 0;
      this.dailyStartTime = now;
    }
  }

  /**
   * 计算总风险敞口
   */
  public getTotalExposure(): number {
    return this.positions.reduce((total, pos) => {
      return total + (pos.amount * pos.averagePrice);
    }, 0);
  }

  /**
   * 检查是否需要紧急止损
   */
  public shouldEmergencyStop(): boolean {
    // 如果每日损失超过限额的 80%，建议停止交易
    if (Math.abs(this.dailyPnL) >= this.dailyMaxLoss * 0.8) {
      this.logger.warn(
        `⚠️ 风险警告: 每日损失接近限额!\n` +
        `   当前损失: $${Math.abs(this.dailyPnL).toFixed(2)}\n` +
        `   限额: $${this.dailyMaxLoss.toFixed(2)}`
      );
      return true;
    }

    return false;
  }

  /**
   * 打印风险摘要
   */
  public printRiskSummary(balance: Balance): void {
    const exposure = this.getTotalExposure();
    const exposurePercentage = balance.usdc > 0
      ? (exposure / balance.usdc) * 100
      : 0;

    console.log('\n📊 风险管理摘要：');
    console.log('━'.repeat(60));
    console.log(`💼 当前持仓: ${this.positions.length}/${this.maxConcurrentPositions}`);
    console.log(`💰 总风险敞口: $${exposure.toFixed(2)} (${exposurePercentage.toFixed(1)}% 账户余额)`);
    console.log(`📈 今日盈亏: ${this.dailyPnL >= 0 ? '+' : ''}$${this.dailyPnL.toFixed(2)}`);
    console.log(`📊 累计净利润: ${this.stats.netProfit >= 0 ? '+' : ''}$${this.stats.netProfit.toFixed(2)}`);
    console.log(`✅ 成功率: ${this.stats.winRate.toFixed(1)}% (${this.stats.successfulTrades}/${this.stats.totalTrades})`);
    console.log('━'.repeat(60) + '\n');
  }
}
