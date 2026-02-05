import winston from 'winston';
import chalk from 'chalk';

/**
 * 中文日志系统
 * 提供彩色终端输出和文件持久化
 */

// 简单的 UI 接口定义，避免循环依赖
interface LoggableUI {
  log(message: string, level: 'info' | 'warn' | 'error' | 'success'): void;
}

export class Logger {
  private logger: winston.Logger;
  private static instance: Logger;
  private dashboard: LoggableUI | null = null;

  private constructor() {
    // 自定义日志格式
    const customFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ level, message, timestamp }) => {
        return `${chalk.gray(timestamp)} ${this.formatLevel(level)} ${message}`;
      })
    );

    // 文件日志格式（不含颜色代码）
    const fileFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ level, message, timestamp }) => {
        return `${timestamp} [${level.toUpperCase()}] ${message}`;
      })
    );

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      transports: [
        // 控制台输出 (当 dashboard 激活时，我们将禁用这个)
        new winston.transports.Console({
          format: customFormat
        }),
        // 所有日志文件
        new winston.transports.File({
          filename: 'logs/combined.log',
          format: fileFormat
        }),
        // 错误日志文件
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format: fileFormat
        })
      ]
    });
  }

  /**
   * 获取日志单例
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * 设置 Dashboard 实例
   */
  public setDashboard(dashboard: LoggableUI): void {
    this.dashboard = dashboard;
    // 移除控制台传输，避免破坏 UI
    this.logger.remove(this.logger.transports.find(t => t instanceof winston.transports.Console)!);
  }

  /**
   * 格式化日志级别
   */
  private formatLevel(level: string): string {
    const levelMap: Record<string, string> = {
      error: chalk.red.bold('❌ 错误'),
      warn: chalk.yellow.bold('⚠️  警告'),
      info: chalk.blue.bold('ℹ️  信息'),
      debug: chalk.gray('🔍 调试')
    };
    return levelMap[level] || level;
  }

  /**
   * 调试日志
   */
  public debug(message: string): void {
    // 调试信息一般不显示在 Dashboard，除非非常重要，或者可以单独加个 debug 开关
    // 这里为了 UI 干净，暂时不发给 dashboard，或者作为 info 发送但标记为 debug
    // this.logger.debug(message);
  }

  /**
   * 信息日志
   */
  public info(message: string): void {
    if (this.dashboard) {
      this.dashboard.log(message, 'info');
    } else {
      this.logger.info(message);
    }
  }

  /**
   * 警告日志
   */
  public warn(message: string): void {
    if (this.dashboard) {
      this.dashboard.log(message, 'warn');
    } else {
      this.logger.warn(message);
    }
  }

  /**
   * 错误日志
   */
  public error(message: string, error?: Error): void {
    const fullMessage = error ? `${message}\n${error.message}` : message;
    
    // 总是写入文件
    this.logger.error(error ? `${message}\n${error.stack}` : message);

    if (this.dashboard) {
      this.dashboard.log(fullMessage, 'error');
    } else {
      // 如果没有 dashboard，才打印到控制台（注意：上面 remove(Console) 后这里不会打到控制台，
      // 但我们需要它打出来如果 dashboard 没设置。逻辑是：setDashboard 会移除 Console transport。
      // 所以这里不需要额外做啥，logger.error 会写入文件。如果 transport 还在就会打印。）
      // 实际上 remove 之后 logger.error 只写文件。
      // 为了安全：如果 dashboard 没设置，意味着在初始化阶段或还没启动 UI，应该打印到控制台。
      // 这里的逻辑有点小瑕疵：remove 是永久的。
      // 更好的做法是：不移除 Console，而是静音它？或者每次 log 时判断。
      // 简单做法：setDashboard 移除 Console。如果没有 dashboard，Console 还在，正常工作。
    }
  }

  /**
   * 成功日志（特殊格式）
   */
  public success(message: string): void {
    if (this.dashboard) {
      this.dashboard.log(message, 'success');
      this.logger.info(`[SUCCESS] ${message}`);
    } else {
      const formatted = `${chalk.gray(new Date().toLocaleString('zh-CN'))} ${chalk.green.bold('✅ 成功')} ${message}`;
      console.log(formatted);
      this.logger.info(message);
    }
  }

  /**
   * 交易日志（特殊格式）
   */
  public trade(message: string): void {
    if (this.dashboard) {
      this.dashboard.log(`💰 ${message}`, 'success');
      this.logger.info(`[TRADE] ${message}`);
    } else {
      const formatted = `${chalk.gray(new Date().toLocaleString('zh-CN'))} ${chalk.magenta.bold('💰 交易')} ${message}`;
      console.log(formatted);
      this.logger.info(`[交易] ${message}`);
    }
  }

  /**
   * 套利机会日志（特殊格式）
   */
  public opportunity(message: string): void {
    if (this.dashboard) {
      this.dashboard.log(`🎯 ${message}`, 'info');
      this.logger.info(`[OPPORTUNITY] ${message}`);
    } else {
      const formatted = `${chalk.gray(new Date().toLocaleString('zh-CN'))} ${chalk.cyan.bold('🎯 机会')} ${message}`;
      console.log(formatted);
      this.logger.info(`[套利机会] ${message}`);
    }
  }

  /**
   * 打印分隔线
   */
  public separator(): void {
    if (!this.dashboard) {
      console.log(chalk.gray('━'.repeat(80)));
    }
  }

  /**
   * 打印标题
   */
  public title(text: string): void {
    if (!this.dashboard) {
      const padding = Math.max(0, (76 - text.length) / 2);
      const paddedText = ' '.repeat(Math.floor(padding)) + text + ' '.repeat(Math.ceil(padding));
      console.log(chalk.gray('┏' + '━'.repeat(78) + '┓'));
      console.log(chalk.gray('┃') + chalk.bold.cyan(paddedText) + chalk.gray('┃'));
      console.log(chalk.gray('┗' + '━'.repeat(78) + '┛'));
    }
  }
}
