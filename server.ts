import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON parsing middleware for POST requests
  app.use(express.json());

  // API Route: Fetch Market Data
  app.post("/api/market-data", async (req, res) => {
    try {
      const { ticker1, ticker2 } = req.body;
      
      if (!ticker1 || !ticker2) {
        res.status(400).json({ error: "Missing tickers" });
        return;
      }
      
      // Fetch past 5 years of daily data for a robust cointegration test
      const period1 = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const queryOptions = { period1, interval: "1d" };
      
      const [res1, res2] = await Promise.all([
        yf.chart(ticker1, queryOptions as any),
        yf.chart(ticker2, queryOptions as any)
      ]);
      
      // Map data by date (as string YYYY-MM-DD for precise alignment)
      const map1 = new Map<string, number>();
      res1.quotes.forEach((r: any) => {
        if (!r.date) return;
        const d = new Date(r.date).toISOString().split("T")[0];
        if (r.adjclose !== null && r.adjclose !== undefined) map1.set(d, r.adjclose);
      });
      
      const map2 = new Map<string, number>();
      res2.quotes.forEach((r: any) => {
        if (!r.date) return;
        const d = new Date(r.date).toISOString().split("T")[0];
        if (r.adjclose !== null && r.adjclose !== undefined) map2.set(d, r.adjclose);
      });
      
      // Find common dates and keep chronological order
      const commonDates = [];
      const values1 = [];
      const values2 = [];
      
      // Iterate through the dates we got for ticker1
      for (const r of res1.quotes) {
          if (!r.date) continue;
          const d = new Date(r.date).toISOString().split("T")[0];
          if (map1.has(d) && map2.has(d)) {
              commonDates.push(d);
              values1.push(map1.get(d));
              values2.push(map2.get(d));
          }
      }
      
      res.json({
          dates: commonDates,
          y: values1, // Dependent
          x: values2  // Independent
      });

    } catch (err: any) {
        console.error("API error fetching market data:", err);
        res.status(500).json({ error: err.message || "Failed to fetch market data" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
