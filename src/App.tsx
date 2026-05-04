import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Activity, Play, AlertCircle, CheckCircle, Upload, Check, Settings2 } from 'lucide-react';
import { checkCointegration, CointegrationResult, onLog, initPyodide } from './services/cointegration';
import { cn } from './lib/utils';

export default function App() {
  const [tickerY, setTickerY] = useState<string>('AAPL');
  const [tickerX, setTickerX] = useState<string>('MSFT');
  const [logs, setLogs] = useState<string[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<CointegrationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [fetchedDataX, setFetchedDataX] = useState<number[]>([]);
  const [fetchedDataY, setFetchedDataY] = useState<number[]>([]);
  const [fetchedDates, setFetchedDates] = useState<string[]>([]);
  
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initial pre-load of python
    initPyodide().then(() => setIsInitializing(false)).catch(() => setIsInitializing(false));
    
    // Subscribe to python progress logs
    const unsub = onLog((msg) => {
        setLogs(prev => [...prev.slice(-10), msg]);
    });
    return unsub;
  }, []);

  useEffect(() => {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const loadPreset = (y: string, x: string) => {
      setTickerY(y);
      setTickerX(x);
      setResult(null);
      setErrorMsg(null);
  };

  const handleRunAnalytics = async () => {
      setResult(null);
      setErrorMsg(null);
      
      const cleanY = tickerY.trim().toUpperCase();
      const cleanX = tickerX.trim().toUpperCase();
      
      if (!cleanY || !cleanX) {
          setErrorMsg('Error: Please provide both tickers.');
          return;
      }

      setIsRunning(true);
      setLogs(['Fetching historical data (5 years) from Yahoo Finance...']);
      try {
          // Fetch data from backend
          const res = await fetch('/api/market-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker1: cleanY, ticker2: cleanX })
          });
          
          if (!res.ok) {
            const errData = await res.json().catch(() => null);
            throw new Error((errData && errData.error) || 'Failed to fetch market data');
          }
          
          const data = await res.json();
          const yArr = data.y;
          const xArr = data.x;
          const datesArr = data.dates;
          
          if (xArr.length < 15 || yArr.length < 15) {
              throw new Error(`Not enough historical data points found (need >= 15, got ${xArr.length}).`);
          }
          if (xArr.length !== yArr.length) {
              throw new Error(`Data mismatch error.`);
          }
          
          setFetchedDataY(yArr);
          setFetchedDataX(xArr);
          setFetchedDates(datesArr);
          
          setLogs(prev => [...prev, `Data fetched: ${xArr.length} trading days. Running Diagnostics...`]);

          // Run Cointegration check in Pyodide
          const cointRes = await checkCointegration(yArr, xArr);
          setResult(cointRes);
      } catch (err: any) {
          setErrorMsg(err.message || 'An error occurred during verification.');
      } finally {
          setIsRunning(false);
      }
  };

  // Build chart datasets
  const rawChartData = result && fetchedDataX.length > 0 ? fetchedDataX.map((x, i) => ({
      index: fetchedDates[i] || i,
      x: x,
      y: fetchedDataY[i]
  })) : [];

  const residualChartData = result ? result.eg_y_on_x.residuals.map((r, i) => ({
      index: fetchedDates[i] || i,
      residual: r,
      zScore: result.backtest?.z_score[i] || 0,
  })) : [];


  return (
    <div className="flex flex-col min-h-[100vh] w-full font-sans text-stone-900 bg-[#E4E3E0] border-8 border-stone-900 selection:bg-stone-900 selection:text-white p-4 sm:p-6">
      <div className="w-full flex-1 flex flex-col max-w-none">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row items-center justify-between border-b border-stone-900 pb-6 mb-6">
            <div>
                <span className="text-[10px] uppercase tracking-widest font-bold opacity-60">Econometric Analysis Suite v4.1</span>
                <h1 className="font-serif italic text-3xl leading-none -mt-1 flex items-center gap-2">
                    Engle-Granger Diagnostics
                </h1>
            </div>
            {isInitializing ? (
                <div className="mt-4 md:mt-0 flex items-center gap-2 text-[10px] font-mono text-stone-900 border border-stone-900 px-3 py-1.5 font-bold uppercase animate-pulse">
                    <Settings2 className="h-3 w-3 animate-spin"/>
                    WASM PYTHON BOOTING
                </div>
            ) : (
                <div className="mt-4 md:mt-0 flex items-center gap-2 text-[10px] font-mono text-stone-900 pt-1">
                    <span className="uppercase tracking-widest opacity-60 font-bold">System Status</span>
                    <span className="flex items-center gap-1 font-bold">READY <span className="w-2 h-2 bg-green-600 rounded-full"></span></span>
                </div>
            )}
        </header>

        <div className="grid lg:grid-cols-12 gap-8 flex-1">
            
            {/* Left Sidebar - Data Configuration */}
            <div className="lg:col-span-4 space-y-6">
                
                <div className="bg-transparent border border-stone-900 p-6 flex flex-col">
                    <h2 className="font-serif italic text-lg mb-4 flex justify-between items-center text-stone-900">
                        Input Parameters
                    </h2>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="text-[10px] uppercase block mb-1 font-bold">Asset A (Dependent Variable Y)</label>
                            <input type="text"
                                value={tickerY}
                                onChange={(e) => setTickerY(e.target.value)}
                                className="w-full bg-transparent border border-stone-400 p-2 font-mono text-sm outline-none focus:border-stone-900 transition-all"
                                placeholder="e.g. GLD"
                            />
                        </div>
                        
                        <div>
                            <label className="text-[10px] uppercase block mb-1 font-bold">Asset B (Independent Variable X)</label>
                            <input type="text"
                                value={tickerX}
                                onChange={(e) => setTickerX(e.target.value)}
                                className="w-full bg-transparent border border-stone-400 p-2 font-mono text-sm outline-none focus:border-stone-900 transition-all"
                                placeholder="e.g. SLV"
                            />
                        </div>
                    </div>

                    <div className="mt-6 flex flex-col gap-2">
                        <p className="text-[10px] font-mono uppercase text-stone-500 font-bold mb-1">Load Example Tickers</p>
                        <div className="flex gap-2">
                            <button onClick={() => loadPreset('GLD', 'SLV')} className="flex-1 bg-stone-200 hover:bg-stone-300 border border-stone-400 text-[10px] font-mono uppercase font-bold py-2 transition-colors text-stone-900">
                                GLD / SLV
                            </button>
                            <button onClick={() => loadPreset('EWA', 'EWC')} className="flex-1 bg-stone-200 hover:bg-stone-300 border border-stone-400 text-[10px] font-mono uppercase font-bold py-2 transition-colors text-stone-900">
                                EWA / EWC
                            </button>
                        </div>
                    </div>

                    <button 
                        onClick={handleRunAnalytics}
                        disabled={isRunning || isInitializing}
                        className={cn(
                            "mt-8 w-full py-3 flex items-center justify-center gap-2 font-mono text-[10px] uppercase font-bold tracking-widest transition-all",
                            (isRunning || isInitializing) 
                                ? "bg-stone-300 text-stone-500 cursor-not-allowed border border-stone-400"
                                : "bg-stone-900 hover:bg-stone-800 text-[#E4E3E0] cursor-pointer"
                        )}
                    >
                        {isRunning ? (
                            <><Settings2 className="h-4 w-4 animate-spin" /> Computing OLS & ADF...</>
                        ) : (
                            <>Run Diagnostics</>
                        )}
                    </button>
                </div>

                {/* Execution Log */}
                <div className="bg-transparent border border-dashed border-stone-400 p-4 font-mono text-[10px]">
                    <h3 className="text-[10px] uppercase tracking-widest font-bold mb-2 opacity-60">Diagnostics Log</h3>
                    <div className="h-32 overflow-y-auto space-y-1.5 text-stone-500">
                        {logs.length === 0 ? (
                            <div className="italic">[NO_DATA] System standing by...</div>
                        ) : (
                            logs.map((log, i) => <div key={i}>[RES] {log}</div>)
                        )}
                        <div ref={logsEndRef} />
                    </div>
                </div>

            </div>

            {/* Right Main - Results & Charts */}
            <div className="lg:col-span-8 space-y-6">
                
                {errorMsg && (
                    <div className="p-4 border border-red-600 text-red-600 bg-red-100 font-mono text-sm flex items-start gap-3">
                       <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                       <p className="font-bold text-red-600">{errorMsg}</p>
                    </div>
                )}

                {/* Stat Cards */}
                {result && (
                    <div className="flex flex-col gap-6">
                        {/* Phase 0 */}
                        <div className="p-6 border border-stone-900 flex-1 bg-stone-100/50">
                            <h3 className="text-[10px] uppercase tracking-widest font-bold mb-4 flex items-center gap-2">
                               <span className="px-2 py-0.5 bg-stone-900 text-white">00</span> Integration Verification (Individual Unit Root)
                            </h3>
                            <div className="grid grid-cols-2 gap-6">
                                <div className="border border-stone-900 p-4 relative">
                                    <span className={cn(
                                        "absolute top-2 right-2 text-xs font-mono font-bold",
                                        result.adf_y.is_stationary ? "text-red-700" : "text-stone-900"
                                    )}>
                                        {result.adf_y.is_stationary ? "STATIONARY (I(0))" : "NON-STATIONARY (I(1))"}
                                    </span>
                                    <div className="text-[10px] uppercase font-bold opacity-40 mb-1">Asset A (Y)</div>
                                    <div className="font-mono text-2xl">p: {result.adf_y.p_value.toFixed(4)}</div>
                                    <div className="text-[10px] font-mono mt-2 text-stone-500">ADF Stat: {result.adf_y.t_stat.toFixed(4)}</div>
                                </div>
                                <div className="border border-stone-900 p-4 relative">
                                    <span className={cn(
                                        "absolute top-2 right-2 text-xs font-mono font-bold",
                                        result.adf_x.is_stationary ? "text-red-700" : "text-stone-900"
                                    )}>
                                        {result.adf_x.is_stationary ? "STATIONARY (I(0))" : "NON-STATIONARY (I(1))"}
                                    </span>
                                    <div className="text-[10px] uppercase font-bold opacity-40 mb-1">Asset B (X)</div>
                                    <div className="font-mono text-2xl">p: {result.adf_x.p_value.toFixed(4)}</div>
                                    <div className="text-[10px] font-mono mt-2 text-stone-500">ADF Stat: {result.adf_x.t_stat.toFixed(4)}</div>
                                </div>
                            </div>
                        </div>

                        {/* Phase 1 & 2 */}
                        <div className="p-6 border border-stone-900 flex-1 bg-stone-100/50 relative">
                            {result.eg_y_on_x.is_cointegrated !== result.eg_x_on_y.is_cointegrated && (
                                <div className="absolute top-4 right-4 text-[10px] uppercase font-bold text-amber-700 bg-amber-100 px-3 py-1.5 border border-amber-700">
                                    DISCREPANCY DETECTED: DIRECTION DEPENDENT
                                </div>
                            )}
                            <h3 className="text-[10px] uppercase tracking-widest font-bold mb-4 flex items-center gap-2">
                               <span className="px-2 py-0.5 bg-stone-900 text-white">01</span> Engle-Granger Result (Y ~ X)
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="border border-stone-900 p-4">
                                    <div className="text-[10px] uppercase font-bold opacity-40 mb-1">Residual ADF p-val</div>
                                    <div className="text-3xl font-serif text-stone-900">
                                        {result.eg_y_on_x.p_value.toExponential(4)}
                                    </div>
                                    <div className="text-[10px] font-mono mt-2 text-stone-500">
                                        t-stat: {result.eg_y_on_x.t_stat.toFixed(4)}
                                    </div>
                                </div>
        
                                <div className="border border-stone-900 p-4">
                                    <div className="text-[10px] uppercase font-bold opacity-40 mb-1">Hedge Ratio (&beta;)</div>
                                    <div className="text-3xl font-serif text-stone-900">
                                        {result.eg_y_on_x.beta.toFixed(4)}
                                    </div>
                                    <div className="text-[10px] font-mono mt-2 text-stone-500">
                                        Intercept (&alpha;): {result.eg_y_on_x.alpha.toFixed(4)}
                                    </div>
                                </div>
    
                                <div className={cn(
                                    "p-4 flex flex-col justify-center items-center text-center",
                                    result.eg_y_on_x.is_cointegrated 
                                        ? "bg-stone-900 text-[#E4E3E0]" 
                                        : "bg-stone-300 text-stone-900 border border-stone-900"
                                )}>
                                    <div className="text-[10px] uppercase font-bold tracking-tighter opacity-70 mb-1">Status (Y~X)</div>
                                    <div className={cn(
                                        "text-xl font-bold tracking-widest",
                                    )}>
                                        {result.eg_y_on_x.is_cointegrated ? "COINTEGRATED" : "NOT COINT"}
                                    </div>
                                </div>
                            </div>

                            <h3 className="text-[10px] uppercase tracking-widest font-bold mb-4 mt-6 flex items-center gap-2">
                               <span className="px-2 py-0.5 bg-stone-900 text-white">02</span> Reversed Engle-Granger Result (X ~ Y)
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="border border-stone-900 p-4">
                                    <div className="text-[10px] uppercase font-bold opacity-40 mb-1">Residual ADF p-val</div>
                                    <div className="text-3xl font-serif text-stone-900">
                                        {result.eg_x_on_y.p_value.toExponential(4)}
                                    </div>
                                    <div className="text-[10px] font-mono mt-2 text-stone-500">
                                        t-stat: {result.eg_x_on_y.t_stat.toFixed(4)}
                                    </div>
                                </div>
        
                                <div className="border border-stone-900 p-4">
                                    <div className="text-[10px] uppercase font-bold opacity-40 mb-1">Hedge Ratio (&beta;)</div>
                                    <div className="text-3xl font-serif text-stone-900">
                                        {result.eg_x_on_y.beta.toFixed(4)}
                                    </div>
                                    <div className="text-[10px] font-mono mt-2 text-stone-500">
                                        Intercept (&alpha;): {result.eg_x_on_y.alpha.toFixed(4)}
                                    </div>
                                </div>
    
                                <div className={cn(
                                    "p-4 flex flex-col justify-center items-center text-center",
                                    result.eg_x_on_y.is_cointegrated 
                                        ? "bg-stone-900 text-[#E4E3E0]" 
                                        : "bg-stone-300 text-stone-900 border border-stone-900"
                                )}>
                                    <div className="text-[10px] uppercase font-bold tracking-tighter opacity-70 mb-1">Status (X~Y)</div>
                                    <div className={cn(
                                        "text-xl font-bold tracking-widest",
                                    )}>
                                        {result.eg_x_on_y.is_cointegrated ? "COINTEGRATED" : "NOT COINT"}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Phase 3 */}
                        <div className="p-6 border border-stone-900 flex-1 bg-stone-100/50">
                            <h3 className="text-[10px] uppercase tracking-widest font-bold mb-4 flex items-center gap-2">
                               <span className="px-2 py-0.5 bg-stone-900 text-white">03</span> Johansen Cointegration Test (Trace)
                            </h3>
                            {result.johansen.trace_stat ? (
                            <div className="grid grid-cols-2 gap-6">
                                <div className="border border-stone-900 p-4 relative">
                                    <div className="text-[10px] uppercase font-bold opacity-40 mb-1">r = 0 (No cointegration)</div>
                                    <div className="font-mono text-2xl">Trace: {result.johansen.trace_stat[0].toFixed(2)}</div>
                                    <div className="text-[10px] font-mono mt-2 text-stone-500">Crit(95%): {result.johansen.trace_crit[0][1].toFixed(2)}</div>
                                </div>
                                <div className="border border-stone-900 p-4 relative">
                                    <div className="text-[10px] uppercase font-bold opacity-40 mb-1">r ≤ 1</div>
                                    <div className="font-mono text-2xl">Trace: {result.johansen.trace_stat[1].toFixed(2)}</div>
                                    <div className="text-[10px] font-mono mt-2 text-stone-500">Crit(95%): {result.johansen.trace_crit[1][1].toFixed(2)}</div>
                                </div>
                            </div>
                            ) : (
                                <div className="text-[10px] font-mono text-stone-500">Failed to compute Johansen</div>
                            )}
                            {result.johansen.trace_stat && (
                                <div className="mt-4 p-4 border border-stone-900 text-center font-bold">
                                    Johansen Status: {result.johansen.is_cointegrated ? "COINTEGRATED (r > 0)" : "NO COINTEGRATION"}
                                </div>
                            )}
                        </div>

                        {/* Phase 4: Backtest Results */}
                        {result.backtest && (
                            <div className="p-6 border border-stone-900 flex-1 bg-stone-100/50">
                                <h3 className="text-[10px] uppercase tracking-widest font-bold mb-4 flex items-center gap-2">
                                   <span className="px-2 py-0.5 bg-stone-900 text-white">04</span> Backtest (Pairs Strategy: Y~X Spread)
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="border border-stone-900 p-4 relative">
                                        <div className="text-[10px] uppercase font-bold opacity-40 mb-1">Total Return</div>
                                        <div className={cn("text-3xl font-serif text-stone-900", result.backtest.total_return >= 0 ? "text-green-700" : "text-red-700")}>
                                            {(result.backtest.total_return * 100).toFixed(2)}%
                                        </div>
                                    </div>
                                    <div className="border border-stone-900 p-4 relative">
                                        <div className="text-[10px] uppercase font-bold opacity-40 mb-1">Sharpe Ratio</div>
                                        <div className="text-3xl font-serif text-stone-900">
                                            {result.backtest.sharpe_ratio.toFixed(2)}
                                        </div>
                                    </div>
                                    <div className="border border-stone-900 p-4 relative">
                                        <div className="text-[10px] uppercase font-bold opacity-40 mb-1">Max Drawdown</div>
                                        <div className="text-3xl font-serif text-red-700">
                                            {(result.backtest.max_drawdown * 100).toFixed(2)}%
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Charts Area */}
                {result && (
                    <div className="space-y-6">
                        
                        {/* 1. Underlying Asset Prices */}
                        <div className="p-6 border border-stone-900 bg-transparent flex-1 mb-6">
                           <h3 className="text-[10px] uppercase tracking-widest font-bold mb-6 flex items-center gap-2">
                               <span className="px-2 py-0.5 bg-stone-900 text-white">05</span> Asset Prices
                           </h3>
                            <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={rawChartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="4" stroke="#d6d3d1" vertical={false} />
                                        <XAxis dataKey="index" stroke="#1c1917" fontSize={10} tickLine={false} axisLine={false} fontFamily="monospace" />
                                        <YAxis stroke="#1c1917" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} fontFamily="monospace" />
                                        <RechartsTooltip 
                                            contentStyle={{ backgroundColor: '#f5f5f4', borderColor: '#1c1917', borderRadius: '0px', fontFamily: 'monospace', fontSize: '10px' }}
                                            itemStyle={{ color: '#1c1917' }}
                                        />
                                        <Line type="monotone" name="Series Y" dataKey="y" stroke="#1c1917" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                                        <Line type="monotone" name="Series X" dataKey="x" stroke="#57534e" strokeDasharray="3 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* 2. Residual Spread */}
                        <div className="p-6 border border-stone-900 bg-stone-100/50 flex-1">
                           <h3 className="text-[10px] uppercase tracking-widest font-bold mb-2 flex items-center gap-2">
                               <span className="px-2 py-0.5 bg-stone-900 text-white">06</span> Residual Spread & Z-Score (Y ~ X, &epsilon;t)
                           </h3>
                           <p className="text-[10px] font-mono text-stone-500 mb-6 italic">Visualizing error term testing for Stationarity, and rolling Z-Score used for backtest signals.</p>
                            <div className="h-64 w-full border-t border-stone-300 pt-4 relative">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={residualChartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="4" stroke="#d6d3d1" vertical={false} />
                                        <XAxis dataKey="index" stroke="#1c1917" fontSize={10} tickLine={false} axisLine={false} fontFamily="monospace" />
                                        <YAxis yAxisId="left" stroke="#1c1917" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} fontFamily="monospace" />
                                        <YAxis yAxisId="right" orientation="right" stroke="#dc2626" fontSize={10} tickLine={false} axisLine={false} domain={[-5, 5]} fontFamily="monospace" />
                                        <ReferenceLine yAxisId="right" y={0} stroke="#1c1917" strokeDasharray="3 3" strokeWidth={0.5} />
                                        <ReferenceLine yAxisId="right" y={2} stroke="#dc2626" strokeDasharray="2 2" strokeWidth={0.5} opacity={0.5} />
                                        <ReferenceLine yAxisId="right" y={-2} stroke="#dc2626" strokeDasharray="2 2" strokeWidth={0.5} opacity={0.5} />
                                        <RechartsTooltip 
                                            contentStyle={{ backgroundColor: '#f5f5f4', borderColor: '#1c1917', borderRadius: '0px', fontFamily: 'monospace', fontSize: '10px' }}
                                            itemStyle={{ color: '#1c1917' }}
                                        />
                                        <Line yAxisId="left" type="monotone" name="Spread" dataKey="residual" stroke="#1c1917" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                                        <Line yAxisId="right" type="stepAfter" name="Z-Score" dataKey="zScore" stroke="#dc2626" strokeWidth={1} dot={false} opacity={0.7} isAnimationActive={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            
        </div>

        {/* Footer Metric Bar */}
        <footer className="mt-8 flex items-center justify-between px-6 py-2 border-t border-stone-900 bg-stone-200 text-[10px] font-mono mx-[-1.5rem] mb-[-1.5rem] sm:mx-[-1.5rem] sm:mb-[-1.5rem]">
            <div className="flex gap-4">
                <span className="font-bold text-stone-700">[ENGINE: PYODIDE 0.29.3]</span>
                <span className="text-stone-400">|</span>
                <span className="font-bold text-stone-700">[REACT: 19.x]</span>
            </div>
            <div className="tracking-widest font-bold text-stone-700">
                ENGL_GRANGER_DIAGNOSTIC_SUITE
            </div>
        </footer>
      </div>
    </div>
  );
}
