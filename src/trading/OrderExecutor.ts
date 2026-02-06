import { ClobClient, Side, ApiKeyCreds } from "@polymarket/clob-client";
import { ethers } from "ethers";
import { Trade, OrderResult, OrderStatus, OrderSide } from "../types";
import { Logger } from "../ui/Logger";
import { Config } from "../config/Config";
import { MarketDataService } from "../market/MarketDataService";

/**
 * 订单执行器
 * 负责执行交易订单
 */
export class OrderExecutor {
  private clobClient!: ClobClient;
  private logger: Logger;
  private wallet: ethers.Wallet;
  private config: Config;
  private marketDataService: MarketDataService;
  private isAuthenticated: boolean = false;
  private apiCreds: ApiKeyCreds | null = null;


  constructor(
    private privateKey: string,
    private chainId: number = 137,
  ) {
    this.logger = Logger.getInstance();
    this.wallet = new ethers.Wallet(privateKey);
    this.config = Config.getInstance();
    this.marketDataService = new MarketDataService(privateKey, chainId);
    this.initializeClient();
  }

  private clampPrice(price: number): number {
    if (!Number.isFinite(price)) return 0;
    return Math.min(0.999, Math.max(0.001, price));
  }

  private applySlippageLimit(trade: Trade): number {
    const maxSlippage = this.config.getConfig().maxSlippage / 100;
    const base = this.clampPrice(trade.price);
    if (trade.side === OrderSide.BUY)
      return this.clampPrice(base * (1 + maxSlippage));
    return this.clampPrice(base * (1 - maxSlippage));
  }

  private async checkFillable(
    trade: Trade,
    limitPrice: number,
  ): Promise<boolean> {
    const book = await this.marketDataService.getOrderBook(trade.tokenId);
    if (!book) return false;
    if (trade.side === OrderSide.BUY) {
      const available = book.asks
        .filter(l => l.price <= limitPrice)
        .reduce((sum, l) => sum + l.size, 0);
      return available >= trade.amount;
    }
    const available = book.bids
      .filter(l => l.price >= limitPrice)
      .reduce((sum, l) => sum + l.size, 0);
    return available >= trade.amount;
  }

  /**
   * 初始化 CLOB 客户端（基础初始化，只读）
   */
  private initializeClient(): void {
    try {
      // 基础初始化 - L1 只读模式
      this.clobClient = new ClobClient(
        this.config.getConfig().clobApiUrl,
        this.chainId,
        this.wallet,
      );
      this.logger.info("CLOB 客户端基础初始化成功（只读模式）");
    } catch (error) {
      this.logger.error("CLOB 客户端初始化失败", error as Error);
      throw error;
    }
  }

  /**
   * 完成 L2 API 认证（用于交易）
   * 需要在执行任何交易前调用
   */
  public async authenticateForTrading(): Promise<boolean> {
    if (this.isAuthenticated) {
      return true;
    }

    try {
      this.logger.info("正在进行 L2 API 认证...");

      // 派生或创建 API credentials
      const creds = await this.clobClient.createOrDeriveApiKey();
      this.apiCreds = creds;

      // 使用完整凭证重新初始化客户端
      // signatureType: 0 = EOA (MetaMask等外部钱包)
      this.clobClient = new ClobClient(
        this.config.getConfig().clobApiUrl,
        this.chainId,
        this.wallet,
        creds,
        0, // signatureType: EOA
        this.wallet.address, // funder address
      );

      this.isAuthenticated = true;
      this.logger.success("L2 API 认证成功！可以开始交易");
      return true;
    } catch (error) {
      this.logger.error("L2 API 认证失败", error as Error);
      this.isAuthenticated = false;
      return false;
    }
  }

  /**
   * 检查是否已认证
   */
  public isReadyForTrading(): boolean {
    return this.isAuthenticated;
  }


  /**
   * 执行单笔交易
   */
  public async executeTrade(trade: Trade): Promise<OrderResult> {
    try {
      const limitPrice = this.applySlippageLimit(trade);
      const fillable = await this.checkFillable(trade, limitPrice);
      if (!fillable) {
        throw new Error(
          `订单簿深度不足或不可成交: token=${trade.tokenId} price<=${limitPrice.toFixed(4)} size=${trade.amount}`,
        );
      }

      this.logger.trade(
        `正在执行订单: ${trade.side} ${trade.amount} @ $${limitPrice.toFixed(4)}\n` +
          `   Token: ${trade.tokenId}`,
      );

      const side: Side = trade.side === OrderSide.BUY ? Side.BUY : Side.SELL;

      // 创建订单
      const order = await this.clobClient.createOrder({
        tokenID: trade.tokenId,
        price: limitPrice,
        size: trade.amount,
        side: side,
        feeRateBps: 0, // 默认手续费率
      });

      if (!order) {
        throw new Error("订单创建失败");
      }

      // 提交订单
      const result = await this.clobClient.postOrder(order);

      this.logger.success(
        `订单执行成功！\n` +
          `   订单ID: ${result.orderID}\n` +
          `   状态: ${result.status}`,
      );

      return {
        orderId: result.orderID,
        status: this.mapOrderStatus(result.status),
        filledAmount: trade.amount,
        averagePrice: limitPrice,
      };
    } catch (error) {
      this.logger.error("订单执行失败", error as Error);
      return {
        orderId: "",
        status: OrderStatus.FAILED,
        filledAmount: 0,
        averagePrice: 0,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 原子化批量执行交易
   * 1. 前置验证所有交易的深度
   * 2. 并行创建订单
   * 3. 并行提交订单
   * 4. 如有失败，取消已成功的订单
   */
  public async executeTrades(trades: Trade[]): Promise<OrderResult[]> {
    if (trades.length === 0) return [];

    try {
      // 步骤1: 前置验证所有交易的深度
      this.logger.info(`正在验证 ${trades.length} 笔交易的订单簿深度...`);
      const limitPrices: number[] = [];
      
      for (const trade of trades) {
        const limitPrice = this.applySlippageLimit(trade);
        const fillable = await this.checkFillable(trade, limitPrice);
        
        if (!fillable) {
          throw new Error(
            `前置验证失败: 订单簿深度不足 token=${trade.tokenId} 需要=${trade.amount}`,
          );
        }
        limitPrices.push(limitPrice);
      }
      this.logger.success("所有交易深度验证通过");

      // 步骤2: 并行创建订单
      this.logger.info("正在并行创建订单...");
      const orderPromises = trades.map(async (trade, i) => {
        const side: Side = trade.side === OrderSide.BUY ? Side.BUY : Side.SELL;
        return this.clobClient.createOrder({
          tokenID: trade.tokenId,
          price: limitPrices[i],
          size: trade.amount,
          side: side,
          feeRateBps: 0,
        });
      });

      const orders = await Promise.all(orderPromises);
      
      // 检查订单创建是否成功
      for (let i = 0; i < orders.length; i++) {
        if (!orders[i]) {
          throw new Error(`订单创建失败: trade[${i}] token=${trades[i].tokenId}`);
        }
      }
      this.logger.success("所有订单创建成功");

      // 步骤3: 并行提交订单
      this.logger.info("正在并行提交订单...");
      const postPromises = orders.map(order => this.clobClient.postOrder(order));
      const postResults = await Promise.all(postPromises);

      // 步骤4: 检查结果，必要时回滚
      const results: OrderResult[] = postResults.map((result, i) => ({
        orderId: result.orderID,
        status: this.mapOrderStatus(result.status),
        filledAmount: trades[i].amount,
        averagePrice: limitPrices[i],
      }));

      const failedIndices = results
        .map((r, i) => (r.status === OrderStatus.FAILED ? i : -1))
        .filter(i => i >= 0);

      if (failedIndices.length > 0) {
        this.logger.warn(`检测到 ${failedIndices.length} 笔订单失败，正在回滚成功的订单...`);
        
        // 取消所有成功的订单
        const successfulOrders = results.filter(r => 
          r.status === OrderStatus.FILLED || r.status === OrderStatus.PENDING
        );
        
        for (const order of successfulOrders) {
          if (order.orderId) {
            await this.cancelOrder(order.orderId);
          }
        }
        
        this.logger.error("原子交易失败，已回滚");
        
        // 标记所有订单为失败
        return results.map(r => ({
          ...r,
          status: OrderStatus.FAILED,
          error: "原子交易回滚",
        }));
      }

      this.logger.success(`原子交易成功！${results.length} 笔订单全部完成`);
      return results;

    } catch (error) {
      this.logger.error("原子交易执行失败", error as Error);
      return trades.map(trade => ({
        orderId: "",
        status: OrderStatus.FAILED,
        filledAmount: 0,
        averagePrice: 0,
        error: (error as Error).message,
      }));
    }
  }

  /**
   * 取消订单
   */
  public async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.clobClient.cancelOrder({ orderID: orderId });
      this.logger.info(`订单已取消: ${orderId}`);
      return true;
    } catch (error) {
      this.logger.error(`取消订单失败: ${orderId}`, error as Error);
      return false;
    }
  }

  /**
   * 获取订单状态
   */
  public async getOrderStatus(orderId: string): Promise<OrderStatus> {
    try {
      const order = await this.clobClient.getOrder(orderId);
      return this.mapOrderStatus(order.status);
    } catch (error) {
      this.logger.error(`获取订单状态失败: ${orderId}`, error as Error);
      return OrderStatus.FAILED;
    }
  }

  /**
   * 映射订单状态
   */
  private mapOrderStatus(status: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      LIVE: OrderStatus.PENDING,
      MATCHED: OrderStatus.FILLED,
      PARTIAL: OrderStatus.PARTIALLY_FILLED,
      CANCELLED: OrderStatus.CANCELLED,
      FAILED: OrderStatus.FAILED,
    };
    return statusMap[status?.toUpperCase()] || OrderStatus.PENDING;
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // USDC 合约地址 (Polygon)
  private readonly USDC_BRIDGED = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // USDC.e
  private readonly USDC_NATIVE = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"; // Native USDC

  // Polygon RPC 端点列表
  private readonly RPC_ENDPOINTS = [
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.llamarpc.com",
    "https://polygon-rpc.com",
  ];

  /**
   * 获取账户余额
   */
  public async getBalance(): Promise<{ usdc: number; matic: number }> {
    for (const rpcUrl of this.RPC_ENDPOINTS) {
      try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const walletWithProvider = this.wallet.connect(provider);

        // 获取 MATIC 余额
        const maticBalance = await provider.getBalance(
          walletWithProvider.address,
        );
        const maticAmount = parseFloat(ethers.utils.formatEther(maticBalance));

        // 获取 USDC 余额 (查询两种 USDC)
        const abi = ["function balanceOf(address) view returns (uint256)"];
        const usdcBridged = new ethers.Contract(
          this.USDC_BRIDGED,
          abi,
          provider,
        );
        const usdcNative = new ethers.Contract(this.USDC_NATIVE, abi, provider);

        const [bridgedBal, nativeBal] = await Promise.all([
          usdcBridged.balanceOf(walletWithProvider.address),
          usdcNative.balanceOf(walletWithProvider.address),
        ]);

        const bridgedAmount = parseFloat(
          ethers.utils.formatUnits(bridgedBal, 6),
        );
        const nativeAmount = parseFloat(ethers.utils.formatUnits(nativeBal, 6));
        const usdcAmount = bridgedAmount + nativeAmount;

        return {
          usdc: usdcAmount,
          matic: maticAmount,
        };
      } catch (error) {
        this.logger.debug(`RPC ${rpcUrl} failed, trying next...`);
        continue;
      }
    }

    this.logger.error("All RPC endpoints failed");
    return { usdc: 0, matic: 0 };
  }
}
