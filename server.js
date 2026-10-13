const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: "1mb" }));

// Serve the new RazTech page without replacing your existing index.html.
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "raztech.html"));
});
app.get("/health", (_req, res) => res.json({ ok: true, app: "RazTech" }));

app.get("/api/market", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase();
  const interval = String(req.query.interval || "1h");
  const allowedSymbols = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  const allowedIntervals = new Set(["15m", "1h", "4h", "1d"]);
  if (!allowedSymbols.has(symbol) || !allowedIntervals.has(interval)) {
    return res.status(400).json({ error: "Unsupported symbol or interval." });
  }

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=100`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`Market provider returned ${response.status}`);
    const rows = await response.json();
    const candles = rows.map(r => ({
      time: r[0], open: Number(r[1]), high: Number(r[2]),
      low: Number(r[3]), close: Number(r[4]), volume: Number(r[5])
    }));
    const last = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    const changePct = previous ? ((last.close - previous.close) / previous.close) * 100 : 0;
    const closes = candles.map(c => c.close);
    const sma = (n) => {
      if (closes.length < n) return null;
      return closes.slice(-n).reduce((a, b) => a + b, 0) / n;
    };
    const sma20 = sma(20);
    const sma50 = sma(50);
    let signal = "NEUTRAL";
    if (sma20 && sma50 && last.close > sma20 && sma20 > sma50) signal = "BULLISH BIAS";
    if (sma20 && sma50 && last.close < sma20 && sma20 < sma50) signal = "BEARISH BIAS";
    res.json({
      symbol, interval, price: last.close, changePct, candles,
      indicators: { sma20, sma50, signal },
      source: "Binance public market data",
      disclaimer: "Educational information only, not financial advice."
    });
  } catch (err) {
    console.error("Market endpoint error:", err.message);
    res.status(502).json({ error: "Could not load market data right now. Try again shortly." });
  }
});

app.post("/api/chat", async (req, res) => {
  const message = String(req.body && req.body.message || "").trim();
  const context = String(req.body && req.body.context || "").slice(0, 6000);
  if (!message) return res.status(400).json({ error: "Please enter a message." });
  if (message.length > 4000) return res.status(400).json({ error: "Message is too long (maximum 4000 characters)." });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "AI is not connected yet. Add your OPENAI_API_KEY in Render → Environment, then redeploy."
    });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "You are RazTech AI, a friendly assistant for both general questions and cryptocurrency market education. Explain in clear, simple language. For BTC/USDT or other trading questions, distinguish observed data from guesses, discuss risk, never promise profits, and do not present a signal as certainty. Do not claim you placed trades. This app is analysis-only and does not execute orders. If the user asks for current market conditions, rely only on the supplied market context and say when it is missing. This is educational information, not financial advice."
          },
          ...(context ? [{ role: "system", content: "Current dashboard context (may be stale):\n" + context }] : []),
          { role: "user", content: message }
        ]
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("AI provider error:", data && data.error && data.error.message || response.status);
      return res.status(502).json({ error: "The AI service could not answer right now. Check the API key, billing, and model settings in Render." });
    }
    const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    res.json({ answer: answer || "I couldn't create a reply. Please try again." });
  } catch (err) {
    console.error("Chat endpoint error:", err.message);
    res.status(502).json({ error: "Could not reach the AI service. Please try again." });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`RazTech listening on ${PORT}`));
