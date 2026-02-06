import { ArbitrageDetector } from "../arbitrage/ArbitrageDetector";
import { MarketDataService } from "../market/MarketDataService";
import { ArbitrageStrategy, Market } from "../types";

async function run(): Promise<void> {
  const marketDataService = {
    async getBestPrices(
      tokenId: string,
    ): Promise<{ bid: number; ask: number } | null> {
      if (tokenId === "YES") return { bid: 0.49, ask: 0.49 };
      if (tokenId === "NO") return { bid: 0.5, ask: 0.5 };
      return null;
    },
  } as unknown as MarketDataService;

  const detector = new ArbitrageDetector(marketDataService, 0.1, [
    ArbitrageStrategy.PRICE_IMBALANCE,
  ]);

  const markets: Market[] = [
    {
      id: "MOCK_MARKET",
      question: "Mock market for detector self-test",
      category: "mock",
      endDate: new Date(Date.now() + 86400000),
      active: true,
      closed: false,
      tokens: [
        { tokenId: "YES", outcome: "Yes", price: 0.49, liquidity: 100000 },
        { tokenId: "NO", outcome: "No", price: 0.5, liquidity: 100000 },
      ],
    },
  ];

  const opportunities = await detector.scanOpportunities(markets);
  console.log(`opportunities=${opportunities.length}`);
  for (const op of opportunities) {
    console.log(
      `${op.strategy} profit=${op.profitPercentage.toFixed(2)}% cost=$${op.requiredCapital.toFixed(4)}`,
    );
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
