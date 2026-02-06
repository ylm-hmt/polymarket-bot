/**
 * 价格历史记录器
 * 用于时间套利策略中的均值回归检测
 */
export class PriceHistory {
  private history: Map<string, { price: number; timestamp: number }[]> = new Map();
  private readonly MAX_HISTORY_SIZE = 60; // 保留最近60次记录
  private readonly HISTORY_WINDOW_MS = 30 * 60 * 1000; // 30分钟窗口

  /**
   * 记录价格
   */
  public record(tokenId: string, price: number): void {
    if (!this.history.has(tokenId)) {
      this.history.set(tokenId, []);
    }

    const records = this.history.get(tokenId)!;
    records.push({ price, timestamp: Date.now() });

    // 清理过期记录
    this.cleanOldRecords(tokenId);
  }

  /**
   * 获取价格历史
   */
  public getHistory(tokenId: string): { price: number; timestamp: number }[] {
    return this.history.get(tokenId) || [];
  }

  /**
   * 计算Z-Score（衡量当前价格偏离均值的程度）
   * Z-score > 2 表示显著高于均值
   * Z-score < -2 表示显著低于均值
   */
  public getZScore(tokenId: string, currentPrice: number): number | null {
    const records = this.history.get(tokenId);
    if (!records || records.length < 10) {
      return null; // 数据不足
    }

    const prices = records.map(r => r.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev < 0.001) {
      return 0; // 标准差过小，价格稳定
    }

    return (currentPrice - mean) / stdDev;
  }

  /**
   * 检查是否存在显著偏离
   */
  public isSignificantDeviation(tokenId: string, currentPrice: number, threshold: number = 2): boolean {
    const zScore = this.getZScore(tokenId, currentPrice);
    if (zScore === null) return false;
    return Math.abs(zScore) >= threshold;
  }

  /**
   * 获取均值
   */
  public getMean(tokenId: string): number | null {
    const records = this.history.get(tokenId);
    if (!records || records.length === 0) return null;
    const prices = records.map(r => r.price);
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  /**
   * 获取价格趋势方向
   * 返回: 1 (上涨), -1 (下跌), 0 (平稳)
   */
  public getTrend(tokenId: string): number {
    const records = this.history.get(tokenId);
    if (!records || records.length < 5) return 0;

    const recentPrices = records.slice(-5).map(r => r.price);
    const firstHalf = recentPrices.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
    const secondHalf = recentPrices.slice(-2).reduce((a, b) => a + b, 0) / 2;
    const diff = secondHalf - firstHalf;

    if (diff > 0.02) return 1;  // 上涨趋势
    if (diff < -0.02) return -1; // 下跌趋势
    return 0; // 平稳
  }

  /**
   * 清理过期记录
   */
  private cleanOldRecords(tokenId: string): void {
    const records = this.history.get(tokenId);
    if (!records) return;

    const now = Date.now();
    const cutoff = now - this.HISTORY_WINDOW_MS;

    // 过滤掉过期的记录，并限制数量
    const filtered = records
      .filter(r => r.timestamp > cutoff)
      .slice(-this.MAX_HISTORY_SIZE);

    this.history.set(tokenId, filtered);
  }

  /**
   * 获取统计摘要
   */
  public getStats(tokenId: string): {
    count: number;
    mean: number | null;
    min: number | null;
    max: number | null;
    stdDev: number | null;
  } {
    const records = this.history.get(tokenId);
    if (!records || records.length === 0) {
      return { count: 0, mean: null, min: null, max: null, stdDev: null };
    }

    const prices = records.map(r => r.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;

    return {
      count: prices.length,
      mean,
      min: Math.min(...prices),
      max: Math.max(...prices),
      stdDev: Math.sqrt(variance),
    };
  }
}
