import { Config } from "../config/Config";
import { MarketDataService } from "../market/MarketDataService";
import { ArbitrageDetector } from "../arbitrage/ArbitrageDetector";
import { Market, MonitorMode } from "../types";

async function run(): Promise<void> {
  const config = Config.getInstance();
  config.printSummary();
  const cfg = config.getConfig();

  const marketDataService = new MarketDataService(cfg.privateKey);
  const detector = new ArbitrageDetector(
    marketDataService,
    cfg.minProfitThreshold,
    cfg.enabledStrategies,
  );

  let markets: Market[] = [];
  if (cfg.monitorMode === MonitorMode.ALL) {
    markets = await marketDataService.getActiveMarkets();
  } else if (cfg.monitorMode === MonitorMode.CUSTOM) {
    const loaded = await Promise.all(
      cfg.customMarketIds.map(id => marketDataService.getMarket(id)),
    );
    markets = loaded.filter((m): m is Market => m != null);
  } else {
    const loaded = await Promise.all(
      cfg.monitorCategories.map(category =>
        marketDataService.getActiveMarkets(category),
      ),
    );
    markets = loaded.flat();
  }

  markets = markets.filter(m =>
    m.tokens.some(t => t.liquidity >= cfg.minLiquidity),
  );

  const opportunities = await detector.scanOpportunities(markets);

  console.log(
    `\n✅ 扫描完成: markets=${markets.length}, opportunities=${opportunities.length}`,
  );
  for (const op of opportunities.slice(0, 10)) {
    console.log(
      `- ${op.strategy} ${op.profitPercentage.toFixed(2)}% cost=$${op.requiredCapital.toFixed(4)} market=${op.marketId}`,
    );
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
