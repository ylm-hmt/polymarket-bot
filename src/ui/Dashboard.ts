import blessed from 'blessed';
import contrib from 'blessed-contrib';
import figlet from 'figlet';
import { Market, ArbitrageOpportunity, TradingStats, Balance } from '../types';
import { Logger } from './Logger';

/**
 * 实时监控面板
 * 使用 blessed 库创建终端 UI
 */
export class Dashboard {
  private screen!: blessed.Widgets.Screen;
  private grid: any;
  private widgets: {
    title?: any;
    marketList?: blessed.Widgets.ListElement;
    opportunityList?: blessed.Widgets.ListElement;
    statsTable?: contrib.Widgets.TableElement;
    balanceBox?: blessed.Widgets.BoxElement;
    logBox?: blessed.Widgets.BoxElement;
  } = {};
  private logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
    this.initializeScreen();
    this.createWidgets();
  }

  /**
   * 初始化屏幕
   */
  private initializeScreen(): void {
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      forceUnicode: true,
      title: 'Polymarket 套利机器人'
    });

    // 退出快捷键
    this.screen.key(['escape', 'q', 'C-c'], () => {
      return process.exit(0);
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });
  }

  /**
   * 创建UI组件
   */
  private createWidgets(): void {
    // 生成 ASCII 标题
    const asciiTitle = figlet.textSync('PolyBot', {
      font: 'Standard',
      horizontalLayout: 'default',
      verticalLayout: 'default',
      width: 80,
      whitespaceBreak: true
    });
    
    // 组合标题文本 (ASCII + 中文副标题)
    // 注意：blessed 的 center 标签可能不完全支持多行 ASCII 的居中，这里手动处理一下或者依赖 blessed
    // 我们尝试用简单的文本拼接
    
    // 标题栏 (高度增加到 2 行以容纳大字体)
    this.widgets.title = this.grid.set(0, 0, 2, 12, blessed.box, {
      content: `${asciiTitle}\n{center}Polymarket 自动化套利交易机器人{/center}`,
      tags: true,
      style: {
        fg: 'cyan',
        bg: 'black', // 黑色背景让彩色文字更突出，或者保持 blue
        bold: true
      },
      align: 'center', // 文本居中
      valign: 'middle'
    });

    // 市场列表 (起始行改为 2，高度改为 4)
    this.widgets.marketList = this.grid.set(2, 0, 4, 6, blessed.list, {
      label: '监控市场',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      border: { type: 'line' },
      style: {
        selected: { bg: 'blue' },
        border: { fg: 'cyan' }
      },
      scrollbar: {
        ch: ' ',
        track: { bg: 'gray' },
        style: { inverse: true }
      }
    });

    // 套利机会列表 (起始行改为 2，高度改为 4)
    this.widgets.opportunityList = this.grid.set(2, 6, 4, 6, blessed.list, {
      label: '套利机会',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      border: { type: 'line' },
      style: {
        selected: { bg: 'green' },
        border: { fg: 'green' }
      },
      scrollbar: {
        ch: ' ',
        track: { bg: 'gray' },
        style: { inverse: true }
      }
    });

    // 统计表格
    this.widgets.statsTable = this.grid.set(6, 0, 3, 6, contrib.table, {
      label: '交易统计',
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      interactive: false,
      columnSpacing: 2,
      columnWidth: [15, 12]
    });

    // 余额信息
    this.widgets.balanceBox = this.grid.set(6, 6, 3, 6, blessed.box, {
      label: '钱包资产',
      content: '',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'yellow' }
      }
    });

    // 日志区域
    this.widgets.logBox = this.grid.set(9, 0, 3, 12, blessed.box, {
      label: ' 📝 运行日志 ',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        track: { bg: 'gray' },
        style: { inverse: true }
      },
      border: { type: 'line' },
      style: {
        border: { fg: 'white' }
      }
    });
  }

  private logMessages: string[] = [];

  /**
   * 更新市场列表
   */
  public updateMarkets(markets: Market[]): void {
    if (!this.widgets.marketList) return;

    const items = markets.slice(0, 20).map(m => {
      const category = m.category.toUpperCase();
      const question = m.question.length > 40 
        ? m.question.substring(0, 37) + '...' 
        : m.question;
      return `[${category}] ${question}`;
    });

    this.widgets.marketList.setItems(items);
    this.screen.render();
  }

  /**
   * 更新套利机会
   */
  public updateOpportunities(opportunities: ArbitrageOpportunity[]): void {
    if (!this.widgets.opportunityList) return;

    const items = opportunities.slice(0, 20).map(opp => {
      const riskColor = {
        'LOW': 'green',
        'MEDIUM': 'yellow',
        'HIGH': 'red'
      }[opp.risk] || 'white';

      const profit = opp.profitPercentage.toFixed(2);
      const capital = opp.requiredCapital.toFixed(0);
      
      return `{${riskColor}-fg}[${opp.risk}]{/${riskColor}-fg} +${profit}% | $${capital} | ${opp.description.split('\n')[0].substring(0, 30)}`;
    });

    if (items.length === 0) {
      items.push('{yellow-fg}暂无套利机会{/yellow-fg}');
    }

    this.widgets.opportunityList.setItems(items);
    this.screen.render();
  }

  /**
   * 更新统计数据
   */
  public updateStats(stats: TradingStats): void {
    if (!this.widgets.statsTable) return;

    const data = [
      ['总交易次数', stats.totalTrades.toString()],
      ['成功交易', stats.successfulTrades.toString()],
      ['失败交易', stats.failedTrades.toString()],
      ['胜率', `${stats.winRate.toFixed(1)}%`],
      ['累计利润', `$${stats.totalProfit.toFixed(2)}`],
      ['累计损失', `$${stats.totalLoss.toFixed(2)}`],
      ['净利润', `$${stats.netProfit.toFixed(2)}`],
      ['今日盈亏', `$${stats.dailyPnL.toFixed(2)}`]
    ];

    this.widgets.statsTable.setData({
      headers: ['指标', '数值'],
      data: data
    });

    this.screen.render();
  }

  /**
   * 更新余额信息
   */
  public updateBalance(balance: Balance): void {
    if (!this.widgets.balanceBox) return;

    const content = 
      `\n  {cyan-fg}USDC:{/cyan-fg} {bold}$${balance.usdc.toFixed(2)}{/bold}\n` +
      `  {magenta-fg}MATIC:{/magenta-fg} {bold}${balance.matic.toFixed(4)}{/bold}\n` +
      `\n  {gray-fg}更新时间: ${new Date(balance.timestamp).toLocaleTimeString('zh-CN')}{/gray-fg}`;

    this.widgets.balanceBox.setContent(content);
    this.screen.render();
  }

  /**
   * 添加日志
   */
  public log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
    if (!this.widgets.logBox) return;

    const colors = {
      info: 'blue',
      warn: 'yellow',
      error: 'red',
      success: 'green'
    };

    const time = new Date().toLocaleTimeString('zh-CN');
    const formatted = `{gray-fg}${time}{/gray-fg} {${colors[level]}-fg}${message}{/${colors[level]}-fg}`;
    
    this.logMessages.push(formatted);
    // Keep only last 100 messages
    if (this.logMessages.length > 100) {
      this.logMessages.shift();
    }
    
    this.widgets.logBox.setContent(this.logMessages.join('\n'));
    // 自动滚动到最新
    try {
      const h = (this.widgets.logBox as any).getScrollHeight?.() ?? 1;
      (this.widgets.logBox as any).setScroll?.(h);
    } catch {}
    this.screen.render();
  }

  /**
   * 渲染屏幕
   */
  public render(): void {
    this.screen.render();
  }

  /**
   * 显示欢迎信息
   */
  public showWelcome(): void {
    this.log('欢迎使用 Polymarket 套利机器人！', 'success');
    this.log('按 [q] 或 [Esc] 退出程序', 'info');
    this.log('正在初始化...', 'info');
  }

  /**
   * 获取屏幕对象
   */
  public getScreen(): blessed.Widgets.Screen {
    return this.screen;
  }
}
