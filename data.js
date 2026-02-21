// ─── data.js ─── OHLCV Generator & Live Tick Simulator ───────────────────────

const SYMBOLS = {
    'BTC/USD': { base: 29000, volatility: 0.022, name: 'Bitcoin' },
    'ETH/USD': { base: 1850, volatility: 0.025, name: 'Ethereum' },
    'AAPL': { base: 188, volatility: 0.012, name: 'Apple Inc.' },
    'TSLA': { base: 225, volatility: 0.030, name: 'Tesla' },
    'SPY': { base: 445, volatility: 0.008, name: 'S&P 500 ETF' },
    'NVDA': { base: 490, volatility: 0.028, name: 'NVIDIA' },
    'META': { base: 320, volatility: 0.018, name: 'Meta' },
    'MSFT': { base: 375, volatility: 0.010, name: 'Microsoft' },
};

const TIMEFRAMES = {
    '1m': { seconds: 60, bars: 300 },
    '5m': { seconds: 300, bars: 300 },
    '15m': { seconds: 900, bars: 300 },
    '1h': { seconds: 3600, bars: 500 },
    '4h': { seconds: 14400, bars: 500 },
    '1D': { seconds: 86400, bars: 500 },
    '1W': { seconds: 604800, bars: 300 },
};

// Seeded pseudo-random for reproducibility per symbol
function seededRandom(seed) {
    let s = seed;
    return function () {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
    };
}

function generateOHLCV(symbol, timeframe) {
    const cfg = SYMBOLS[symbol];
    const tf = TIMEFRAMES[timeframe];
    if (!cfg || !tf) return [];

    const rand = seededRandom(symbol.charCodeAt(0) * 997 + timeframe.charCodeAt(0) * 31);
    const now = Math.floor(Date.now() / 1000);
    const bars = [];

    let price = cfg.base;
    // Start from `bars` intervals ago
    let time = now - tf.seconds * tf.bars;
    // Align to bar boundary
    time = Math.floor(time / tf.seconds) * tf.seconds;

    // Long-term trend: slight upward drift
    const trend = 0.0001;

    for (let i = 0; i < tf.bars; i++) {
        const vol = cfg.volatility;
        const change = (rand() - 0.49 + trend) * vol;
        const open = price;
        const close = open * (1 + change);
        const high = Math.max(open, close) * (1 + rand() * vol * 0.5);
        const low = Math.min(open, close) * (1 - rand() * vol * 0.5);
        const volume = Math.floor(rand() * 5000 + 1000) * (cfg.base > 1000 ? 0.5 : 10);

        bars.push({
            time,
            open: parseFloat(open.toFixed(4)),
            high: parseFloat(high.toFixed(4)),
            low: parseFloat(low.toFixed(4)),
            close: parseFloat(close.toFixed(4)),
            volume: parseFloat(volume.toFixed(2)),
        });

        price = close;
        time += tf.seconds;
    }

    return bars;
}

// ─── Indicator Calculations ────────────────────────────────────────────────────

function calcSMA(data, period) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
        const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b.close, 0);
        result.push({ time: data[i].time, value: parseFloat((sum / period).toFixed(4)) });
    }
    return result;
}

function calcEMA(data, period) {
    const result = [];
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b.close, 0) / period;
    result.push({ time: data[period - 1].time, value: parseFloat(ema.toFixed(4)) });
    for (let i = period; i < data.length; i++) {
        ema = data[i].close * k + ema * (1 - k);
        result.push({ time: data[i].time, value: parseFloat(ema.toFixed(4)) });
    }
    return result;
}

function calcBollingerBands(data, period = 20, stdDev = 2) {
    const upper = [], middle = [], lower = [];
    for (let i = period - 1; i < data.length; i++) {
        const slice = data.slice(i - period + 1, i + 1).map(d => d.close);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
        const sd = Math.sqrt(variance);
        const t = data[i].time;
        upper.push({ time: t, value: parseFloat((mean + stdDev * sd).toFixed(4)) });
        middle.push({ time: t, value: parseFloat(mean.toFixed(4)) });
        lower.push({ time: t, value: parseFloat((mean - stdDev * sd).toFixed(4)) });
    }
    return { upper, middle, lower };
}

function calcRSI(data, period = 14) {
    const result = [];
    if (data.length < period + 1) return result;

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = data[i].close - data[i - 1].close;
        if (diff > 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    const rsi = (ag, al) => 100 - 100 / (1 + (al === 0 ? Infinity : ag / al));
    result.push({ time: data[period].time, value: parseFloat(rsi(avgGain, avgLoss).toFixed(2)) });

    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i].close - data[i - 1].close;
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        result.push({ time: data[i].time, value: parseFloat(rsi(avgGain, avgLoss).toFixed(2)) });
    }
    return result;
}

function calcMACD(data, fast = 12, slow = 26, signal = 9) {
    const emaFast = calcEMA(data, fast);
    const emaSlow = calcEMA(data, slow);
    const macdLine = [];

    // Align by time
    const slowMap = new Map(emaSlow.map(d => [d.time, d.value]));
    for (const f of emaFast) {
        if (slowMap.has(f.time)) {
            macdLine.push({ time: f.time, value: parseFloat((f.value - slowMap.get(f.time)).toFixed(4)) });
        }
    }

    // Signal line = EMA of macd
    const k = 2 / (signal + 1);
    let sig = macdLine.slice(0, signal).reduce((a, b) => a + b.value, 0) / signal;
    const signalLine = [{ time: macdLine[signal - 1].time, value: parseFloat(sig.toFixed(4)) }];
    for (let i = signal; i < macdLine.length; i++) {
        sig = macdLine[i].value * k + sig * (1 - k);
        signalLine.push({ time: macdLine[i].time, value: parseFloat(sig.toFixed(4)) });
    }

    // Histogram
    const sigMap = new Map(signalLine.map(d => [d.time, d.value]));
    const histogram = macdLine
        .filter(d => sigMap.has(d.time))
        .map(d => ({
            time: d.time,
            value: parseFloat((d.value - sigMap.get(d.time)).toFixed(4)),
            color: (d.value - sigMap.get(d.time)) >= 0 ? '#26a69a' : '#ef5350',
        }));

    return { macdLine, signalLine, histogram };
}

// ─── Live Tick Simulation ──────────────────────────────────────────────────────

const tickListeners = {};
const lastPrices = {};

function startTickSimulation() {
    // Initialize last prices from generated data
    for (const sym of Object.keys(SYMBOLS)) {
        const bars = generateOHLCV(sym, '1D');
        lastPrices[sym] = bars.length ? bars[bars.length - 1].close : SYMBOLS[sym].base;
    }

    setInterval(() => {
        for (const sym of Object.keys(SYMBOLS)) {
            const vol = SYMBOLS[sym].volatility / 20;
            const change = (Math.random() - 0.495) * vol;
            lastPrices[sym] = parseFloat((lastPrices[sym] * (1 + change)).toFixed(4));
            if (tickListeners[sym]) {
                tickListeners[sym].forEach(fn => fn(lastPrices[sym]));
            }
        }
    }, 1000);
}

function onTick(symbol, callback) {
    if (!tickListeners[symbol]) tickListeners[symbol] = [];
    tickListeners[symbol].push(callback);
}

function getLastPrice(symbol) {
    return lastPrices[symbol] || SYMBOLS[symbol]?.base || 0;
}

// Export to global scope
window.DataEngine = {
    SYMBOLS,
    TIMEFRAMES,
    generateOHLCV,
    calcSMA,
    calcEMA,
    calcBollingerBands,
    calcRSI,
    calcMACD,
    startTickSimulation,
    onTick,
    getLastPrice,
};
