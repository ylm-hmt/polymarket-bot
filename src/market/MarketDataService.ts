import { ClobClient } from "@polymarket/clob-client";
import { ethers } from "ethers";
import { Market, OrderBook } from "../types";
import { Logger } from "../ui/Logger";
import { Config } from "../config/Config";

/**
 * 市场数据服务
 * 负责从 Polymarket 获取市场数据
 */
export class MarketDataService {
  private clobClient!: ClobClient;
  private logger: Logger;
  private config: Config;
  private gammaApiUrl = "https://gamma-api.polymarket.com";

  private orderBookCache = new Map<
    string,
    { data: OrderBook | null; timestamp: number }
  >();
  private readonly CACHE_TTL = 2000; // 2秒缓存

  constructor(
    private privateKey: string,
    private chainId: number = 137, // Polygon mainnet
  ) {
    this.logger = Logger.getInstance();
    this.config = Config.getInstance();
    this.initializeClient();
  }

  /**
   * 初始化 CLOB 客户端
   */
  private initializeClient(): void {
    try {
      const wallet = new ethers.Wallet(this.privateKey);

      this.clobClient = new ClobClient(
        "https://clob.polymarket.com",
        this.chainId,
        wallet,
      );

      this.logger.success("CLOB 客户端初始化成功");
    } catch (error) {
      this.logger.error("CLOB 客户端初始化失败", error as Error);
      throw error;
    }
  }

  /**
   * 获取所有活跃市场
   */
  public async getActiveMarkets(category?: string): Promise<Market[]> {
    try {
      this.logger.debug(
        `正在获取活跃市场${category ? ` (类别: ${category})` : ""}...`,
      );

      let url = `${this.gammaApiUrl}/markets?active=true&closed=false&limit=300`;
      if (category) {
        url += `&tag=${category}`;
      }

      let retries = 3;
      let delay = 1000;
      let data: any = null;

      while (retries > 0) {
        let controller: AbortController | null = null;
        let timeoutId: NodeJS.Timeout | null = null;
        try {
          controller = new AbortController();
          timeoutId = setTimeout(() => controller?.abort(), 10000);

          const response = await fetch(url, { signal: controller.signal });

          if (timeoutId) clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          data = await response.json();
          break;
        } catch (error) {
          if (timeoutId) clearTimeout(timeoutId);
          retries--;
          if (retries === 0) throw error;
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 1.5;
        }
      }

      const rawMarkets: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.markets)
          ? data.markets
          : [];

      const allMarkets: Market[] = rawMarkets.map((m: any) => {
        // 解析 outcomes 和 prices
        let outcomes: string[] = [];
        let prices: string[] = [];
        let clobTokenIds: string[] = [];
        try {
          outcomes = JSON.parse(m.outcomes || "[]");
          prices = JSON.parse(m.outcomePrices || "[]");
        } catch (e) {
          outcomes = ["Yes", "No"];
          prices = ["0.5", "0.5"];
        }
        try {
          clobTokenIds = JSON.parse(m.clobTokenIds || "[]");
        } catch (e) {
          clobTokenIds = [];
        }

        // 构建 token 数据
        const tokens = outcomes.map((outcome: string, i: number) => ({
          tokenId: clobTokenIds[i] || "",
          outcome: outcome,
          price: parseFloat(prices[i] || "0"),
          liquidity: parseFloat(m.liquidity || m.liquidityNum || "0"),
        }));

        return {
          id: m.conditionId || m.condition_id || m.id,
          question: m.question,
          category: m.tags?.[0] || m.groupItemTitle || "unknown",
          endDate: new Date(m.endDateIso || m.end_date_iso || m.endDate),
          active: m.active,
          closed: m.closed,
          tokens: tokens,
        };
      });

      const MAX_MARKETS = 300;
      const selected = allMarkets
        .sort((a, b) => {
          const la = Math.max(...a.tokens.map(t => t.liquidity || 0), 0);
          const lb = Math.max(...b.tokens.map(t => t.liquidity || 0), 0);
          return lb - la;
        })
        .slice(0, MAX_MARKETS);

      this.logger.info(`获取到 ${selected.length} 个活跃市场`);
      return selected;
    } catch (error) {
      this.logger.error("获取市场数据失败", error as Error);
      return [];
    }
  }

  /**
   * 获取市场详情
   */
  public async getMarket(marketId: string): Promise<Market | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${this.gammaApiUrl}/markets/${marketId}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const m: any = await response.json();
      let outcomes: string[] = [];
      let prices: string[] = [];
      let clobTokenIds: string[] = [];
      try {
        outcomes = JSON.parse(m.outcomes || "[]");
        prices = JSON.parse(m.outcomePrices || "[]");
      } catch (e) {
        outcomes = ["Yes", "No"];
        prices = ["0.5", "0.5"];
      }
      try {
        clobTokenIds = JSON.parse(m.clobTokenIds || "[]");
      } catch (e) {
        clobTokenIds = [];
      }
      return {
        id: m.condition_id || m.conditionId || m.id,
        question: m.question,
        category: m.tags?.[0] || "unknown",
        endDate: new Date(m.end_date_iso || m.endDateIso || m.endDate),
        active: m.active,
        closed: m.closed,
        tokens: outcomes.map((outcome: string, i: number) => ({
          tokenId: clobTokenIds[i] || "",
          outcome: outcome,
          price: parseFloat(prices[i] || "0"),
          liquidity: parseFloat(m.liquidity || m.liquidityNum || "0"),
        })),
      };
    } catch (error) {
      clearTimeout(timeoutId);
      this.logger.error(`获取市场 ${marketId} 详情失败`, error as Error);
      return null;
    }
  }

  /**
   * 获取订单簿数据
   */
  public async getOrderBook(tokenId: string): Promise<OrderBook | null> {
    const cached = this.orderBookCache.get(tokenId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100));

      const response = await fetch(
        `${this.config.getConfig().clobApiUrl}/book?token_id=${tokenId}`,
        { signal: controller.signal },
      );
      clearTimeout(timeoutId);

      if (response.status === 404) {
        this.orderBookCache.set(tokenId, {
          data: null,
          timestamp: Date.now(),
        });
        return null;
      }

      if (response.status === 429) {
        await new Promise(resolve =>
          setTimeout(resolve, 1000 + Math.random() * 1000),
        );
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const orderBook: any = await response.json();

      const result = {
        marketId: orderBook.market || "",
        tokenId: tokenId,
        bids:
          orderBook.bids?.map((b: any) => ({
            price: parseFloat(b.price),
            size: parseFloat(b.size),
          })) || [],
        asks:
          orderBook.asks?.map((a: any) => ({
            price: parseFloat(a.price),
            size: parseFloat(a.size),
          })) || [],
        timestamp: Date.now(),
      };

      this.orderBookCache.set(tokenId, { data: result, timestamp: Date.now() });

      return result;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error?.name === "AbortError") {
        return null;
      }
      return null;
    }
  }

  /**
   * 获取最优买卖价
   */
  public async getBestPrices(
    tokenId: string,
  ): Promise<{ bid: number; ask: number } | null> {
    const orderBook = await this.getOrderBook(tokenId);
    if (!orderBook) return null;

    const bestBid =
      orderBook.bids.length > 0
        ? Math.max(...orderBook.bids.map(b => b.price))
        : 0;
    const bestAsk =
      orderBook.asks.length > 0
        ? Math.min(...orderBook.asks.map(a => a.price))
        : 1;

    return { bid: bestBid, ask: bestAsk };
  }

  /**
   * 批量获取市场价格
   */
  public async getMarketPrices(
    markets: Market[],
  ): Promise<Map<string, Map<string, number>>> {
    const priceMap = new Map<string, Map<string, number>>();

    for (const market of markets) {
      const tokenPrices = new Map<string, number>();

      for (const token of market.tokens) {
        const prices = await this.getBestPrices(token.tokenId);
        if (prices) {
          // 使用中间价
          const midPrice = (prices.bid + prices.ask) / 2;
          tokenPrices.set(token.tokenId, midPrice);
        }
      }

      priceMap.set(market.id, tokenPrices);
    }

    return priceMap;
  }

  /**
   * 检查市场流动性
   */
  public async checkLiquidity(
    tokenId: string,
    minLiquidity: number,
  ): Promise<boolean> {
    const orderBook = await this.getOrderBook(tokenId);
    if (!orderBook) return false;

    const totalBidLiquidity = orderBook.bids.reduce(
      (sum: number, b: { price: number; size: number }) => sum + b.size,
      0,
    );
    const totalAskLiquidity = orderBook.asks.reduce(
      (sum: number, a: { price: number; size: number }) => sum + a.size,
      0,
    );
    const totalLiquidity = totalBidLiquidity + totalAskLiquidity;

    return totalLiquidity >= minLiquidity;
  }
}
