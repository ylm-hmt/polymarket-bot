import { ClobClient, Side } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import { Trade, OrderResult, OrderStatus, OrderSide } from '../types';
import { Logger } from '../ui/Logger';

/**
 * 订单执行器
 * 负责执行交易订单
 */
export class OrderExecutor {
  private clobClient!: ClobClient;
  private logger: Logger;
  private wallet: ethers.Wallet;

  constructor(
    private privateKey: string,
    private chainId: number = 137
  ) {
    this.logger = Logger.getInstance();
    this.wallet = new ethers.Wallet(privateKey);
    this.initializeClient();
  }

  /**
   * 初始化 CLOB 客户端
   */
  private initializeClient(): void {
    try {
      this.clobClient = new ClobClient(
        'https://clob.polymarket.com',
        this.chainId,
        this.wallet
      );
      this.logger.success('订单执行器初始化成功');
    } catch (error) {
      this.logger.error('订单执行器初始化失败', error as Error);
      throw error;
    }
  }

  /**
   * 执行单笔交易
   */
  public async executeTrade(trade: Trade): Promise<OrderResult> {
    try {
      this.logger.trade(
        `正在执行订单: ${trade.side} ${trade.amount} @ $${trade.price.toFixed(4)}\n` +
        `   Token: ${trade.tokenId}`
      );

      const side: Side = trade.side === OrderSide.BUY ? Side.BUY : Side.SELL;
      
      // 创建订单
      const order = await this.clobClient.createOrder({
        tokenID: trade.tokenId,
        price: trade.price,
        size: trade.amount,
        side: side,
        feeRateBps: 0, // 默认手续费率
      });

      if (!order) {
        throw new Error('订单创建失败');
      }

      // 提交订单
      const result = await this.clobClient.postOrder(order);

      this.logger.success(
        `订单执行成功！\n` +
        `   订单ID: ${result.orderID}\n` +
        `   状态: ${result.status}`
      );

      return {
        orderId: result.orderID,
        status: this.mapOrderStatus(result.status),
        filledAmount: trade.amount,
        averagePrice: trade.price
      };
    } catch (error) {
      this.logger.error('订单执行失败', error as Error);
      return {
        orderId: '',
        status: OrderStatus.FAILED,
        filledAmount: 0,
        averagePrice: 0,
        error: (error as Error).message
      };
    }
  }

  /**
   * 批量执行交易
   */
  public async executeTrades(trades: Trade[]): Promise<OrderResult[]> {
    const results: OrderResult[] = [];

    for (const trade of trades) {
      const result = await this.executeTrade(trade);
      results.push(result);

      // 如果有订单失败，停止后续执行
      if (result.status === OrderStatus.FAILED) {
        this.logger.warn('检测到订单失败，停止后续执行');
        break;
      }

      // 添加延迟避免速率限制
      await this.delay(500);
    }

    return results;
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
      'LIVE': OrderStatus.PENDING,
      'MATCHED': OrderStatus.FILLED,
      'PARTIAL': OrderStatus.PARTIALLY_FILLED,
      'CANCELLED': OrderStatus.CANCELLED,
      'FAILED': OrderStatus.FAILED
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
  private readonly USDC_BRIDGED = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC.e
  private readonly USDC_NATIVE = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';  // Native USDC
  
  // Polygon RPC 端点列表
  private readonly RPC_ENDPOINTS = [
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon.llamarpc.com',
    'https://polygon-rpc.com'
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
        const maticBalance = await provider.getBalance(walletWithProvider.address);
        const maticAmount = parseFloat(ethers.utils.formatEther(maticBalance));
        
        // 获取 USDC 余额 (查询两种 USDC)
        const abi = ['function balanceOf(address) view returns (uint256)'];
        const usdcBridged = new ethers.Contract(this.USDC_BRIDGED, abi, provider);
        const usdcNative = new ethers.Contract(this.USDC_NATIVE, abi, provider);
        
        const [bridgedBal, nativeBal] = await Promise.all([
          usdcBridged.balanceOf(walletWithProvider.address),
          usdcNative.balanceOf(walletWithProvider.address)
        ]);
        
        const bridgedAmount = parseFloat(ethers.utils.formatUnits(bridgedBal, 6));
        const nativeAmount = parseFloat(ethers.utils.formatUnits(nativeBal, 6));
        const usdcAmount = bridgedAmount + nativeAmount;
        
        return {
          usdc: usdcAmount,
          matic: maticAmount
        };
      } catch (error) {
        this.logger.debug(`RPC ${rpcUrl} failed, trying next...`);
        continue;
      }
    }
    
    this.logger.error('All RPC endpoints failed');
    return { usdc: 0, matic: 0 };
  }
}
