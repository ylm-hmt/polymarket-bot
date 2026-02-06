# PolyMarket 自动化套利交易机器人

🤖 一个全中文界面的 PolyMarket 自动化套利交易机器人，支持多种套利策略和实时可视化监控。

## ✨ 特性

- 🎯 **多种套利策略** - 价格不平衡、跨市场、时间套利
- 📊 **实时可视化面板** - 终端 UI 显示市场、机会、统计
- 🛡️ **完善风险管理** - 每日限额、仓位控制、紧急止损
- 🇨🇳 **全中文界面** - 日志、提示、配置均为中文
- ⚡ **高效扫描** - 实时监控多个市场套利机会

## 📦 安装

```bash
# 克隆项目
git clone https://github.com/ylm-hmt/polymarket-bot.git

# 安装依赖
npm install

# 复制配置文件
cp .env.example .env

# 编译 TypeScript
npm run build
```

## ⚙️ 配置

编辑 `.env` 文件，配置以下参数：

### 必填配置

```bash
# 钱包私钥（不含 0x 前缀）
PRIVATE_KEY=your_64_character_private_key
```

### 交易参数

```bash
MIN_PROFIT_THRESHOLD=2.0     # 最小利润率 (%)
MAX_POSITION_SIZE=100.0      # 单笔最大金额 (USDC)
MIN_POSITION_SIZE=10.0       # 单笔最小金额 (USDC)
MAX_SLIPPAGE=1.0             # 最大滑点 (%)
DAILY_MAX_LOSS=50.0          # 每日最大损失 (USDC)
```

### 套利策略

```bash
# 可选：PRICE_IMBALANCE, CROSS_MARKET, TIME_BASED
ENABLED_STRATEGIES=PRICE_IMBALANCE
```

### 监控配置

```bash
# 模式：ALL, CATEGORY, CUSTOM
MONITOR_MODE=CATEGORY

# 类别：crypto, sports, politics, entertainment
MONITOR_CATEGORIES=crypto,politics

# 最小流动性要求
MIN_LIQUIDITY=1000.0
```

## 🚀 运行

```bash
# 开发模式（实时编译）
npm run dev

# 生产模式
npm run build
npm start
```

## 📖 套利策略说明

### 1. 价格不平衡套利 (PRICE_IMBALANCE)

最常用也是最安全的策略。当一个市场中 YES + NO 价格之和 ≠ $1.00 时存在套利机会：

- **买入套利**: YES ask + NO ask < $1.00 → 同时买入两边，市场结算时获利
- **卖出套利**: YES bid + NO bid > $1.00 → 同时卖出两边获利

### 2. 跨市场套利 (CROSS_MARKET)

在相关市场之间寻找价格差异，例如两个问类似问题的市场定价不一致。

### 3. 时间套利 (TIME_BASED)

基于价格极端值进行交易，当价格过低（<0.1）或过高（>0.9）时可能存在回归机会。

## 🖥️ 界面说明

启动后会显示实时监控面板：

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                     🤖 PolyMarket 自动化套利交易机器人                      ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
┌─📊 监控市场────────────────────┐ ┌─🎯 套利机会────────────────────┐
│ [CRYPTO] Will BTC hit 100k... │ │ [LOW] +2.5% | $50 | BTC...    │
│ [POLITICS] Will Trump...      │ │ [MEDIUM] +3.1% | $80 | ETH... │
└───────────────────────────────┘ └───────────────────────────────┘
```

**快捷键**：

- `q` / `Esc` - 退出程序
- `Ctrl+C` - 强制退出

## ⚠️ 风险警告

> **重要提示**: 自动化交易存在风险，可能导致资金损失。

1. 请使用小额资金进行测试
2. 确保了解 PolyMarket 的交易规则和费用
3. 定期检查机器人运行状态
4. 保护好私钥，不要泄露给他人

## 📁 项目结构

```
PolyMarket-bot/
├── src/
│   ├── index.ts              # 主入口
│   ├── types/                # 类型定义
│   ├── config/               # 配置管理
│   ├── market/               # 市场数据
│   ├── arbitrage/            # 套利检测
│   ├── trading/              # 交易执行
│   └── ui/                   # 用户界面
├── .env.example              # 配置模板
├── package.json
└── tsconfig.json
```

## 📄 许可证

MIT License
