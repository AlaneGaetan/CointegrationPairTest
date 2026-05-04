import { loadPyodide } from 'pyodide';

// Store the python instance globally to prevent reloading
let pyodideInstance: any = null;
let isLoadingPyodide = false;

// Event listeners to push progress updates
type LogCallback = (msg: string) => void;
let logListeners: LogCallback[] = [];

export function onLog(callback: LogCallback) {
    logListeners.push(callback);
    return () => {
        logListeners = logListeners.filter(l => l !== callback);
    };
}

function emitLog(msg: string) {
    console.log(msg);
    logListeners.forEach(cb => cb(msg));
}

export async function initPyodide() {
    if (pyodideInstance) return pyodideInstance;
    if (isLoadingPyodide) {
        // Wait until loaded
        while (isLoadingPyodide) {
           await new Promise(r => setTimeout(r, 200));
        }
        return pyodideInstance;
    }

    isLoadingPyodide = true;
    try {
        emitLog("Initializing Pyodide (Python WebAssembly)...");
        const pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/"
        });
        
        emitLog("Pyodide loaded. Loading micropip...");
        await pyodide.loadPackage('micropip');
        const micropip = pyodide.pyimport('micropip');
        
        emitLog("Installing standard library: pandas, statsmodels... (This may take up to 10 seconds)");
        await micropip.install(['pandas', 'statsmodels']);
        
        emitLog("Python environment ready!");
        pyodideInstance = pyodide;
    } catch (err) {
        emitLog("Error loading Python environment: " + String(err));
        console.error("Failed to initialize Pyodide:", err);
        throw err;
    } finally {
        isLoadingPyodide = false;
    }
    return pyodideInstance;
}

export interface ADFResult {
    t_stat: number;
    p_value: number;
    is_stationary: boolean; // p < 0.05
}

export interface EGResult {
    t_stat: number;
    p_value: number;
    critical_values: {
        '1%': number;
        '5%': number;
        '10%': number;
    };
    is_cointegrated: boolean;
    beta: number;
    alpha: number;
    residuals: number[];
}

export interface JohansenResult {
    trace_stat: number[];
    trace_crit: number[][]; // 90%, 95%, 99%
    eigen_stat: number[];
    eigen_crit: number[][];
    is_cointegrated: boolean; // if at least one cointegrating vector
}

export interface BacktestResult {
    total_return: number;
    sharpe_ratio: number;
    max_drawdown: number;
    max_drawdown_duration: number;
    trades_count: number;
    daily_returns: number[];
    cumulative_returns: number[];
    positions: number[];
    z_score: number[];
    spread_series: number[];
}

export interface CointegrationResult {
    adf_y: ADFResult;
    adf_x: ADFResult;
    eg_y_on_x: EGResult;
    eg_x_on_y: EGResult;
    johansen: JohansenResult;
    backtest: BacktestResult;
}

export async function checkCointegration(
    y: number[], 
    x: number[],
    backtestParams = { betaMode: 'constant' as 'constant' | 'rolling', betaWindow: 60, zscoreWindow: 20, leverage: 1, transactionCost: 0.001 }
): Promise<CointegrationResult> {
    emitLog("Starting diagnostics...");
    const pyodide = await initPyodide();
    
    emitLog("Running Engle-Granger Two-Step Method...");

    // Prepare python execution string
    const pythonCode = `
import json
import pandas as pd
import numpy as np
import statsmodels.api as sm
from statsmodels.tsa.stattools import adfuller
from statsmodels.tsa.vector_ar.vecm import coint_johansen

def run_test(y_data, x_data, beta_mode, beta_window, zscore_window, leverage, tc):
    try:
        y = pd.Series(y_data)
        x = pd.Series(x_data)
        
        if len(y) != len(x):
            return json.dumps({"success": False, "error": "Series lengths do not match"})
        if len(y) < 15:
            return json.dumps({"success": False, "error": "Not enough data points for ADF test (need >= 15)"})
            
        # STEP 0: Pre-check Unit Root Test on Individual Series
        adf_y = adfuller(y, autolag='AIC')
        adf_x = adfuller(x, autolag='AIC')
        
        adf_y_res = {
            "t_stat": float(adf_y[0]),
            "p_value": float(adf_y[1]),
            "is_stationary": bool(adf_y[1] < 0.05)
        }
        
        adf_x_res = {
            "t_stat": float(adf_x[0]),
            "p_value": float(adf_x[1]),
            "is_stationary": bool(adf_x[1] < 0.05)
        }

        # Engle-Granger Function
        def engle_granger(dependent, independent):
            ind_with_const = sm.add_constant(independent)
            model = sm.OLS(dependent, ind_with_const).fit()
            alpha = float(model.params.iloc[0]) if len(model.params) > 1 else float(model.params.iloc[0])
            beta = float(model.params.iloc[1]) if len(model.params) > 1 else 0.0
            result = adfuller(model.resid, autolag='AIC')
            return {
                "t_stat": float(result[0]),
                "p_value": float(result[1]),
                "critical_values": {
                    "1%": float(result[4]["1%"]),
                    "5%": float(result[4]["5%"]),
                    "10%": float(result[4]["10%"])
                },
                "is_cointegrated": bool(result[1] < 0.05),
                "beta": beta,
                "alpha": alpha,
                "residuals": model.resid.tolist()
            }

        eg_y_on_x = engle_granger(y, x)
        eg_x_on_y = engle_granger(x, y)

        # Johansen Test
        johansen_res = None
        try:
            data = np.column_stack((y, x))
            j_res = coint_johansen(data, det_order=0, k_ar_diff=1)
            # trace statistic
            trace_stat = j_res.lr1.tolist()
            trace_crit = j_res.cvt.tolist() # 3 cols for 90%, 95%, 99%
            eigen_stat = j_res.lr2.tolist()
            eigen_crit = j_res.cvm.tolist()
            
            # check 95% critical value of trace stat (index 1) for the first hypothesis (r=0)
            is_coint = bool(trace_stat[0] > trace_crit[0][1])
            
            johansen_res = {
                "trace_stat": trace_stat,
                "trace_crit": trace_crit,
                "eigen_stat": eigen_stat,
                "eigen_crit": eigen_crit,
                "is_cointegrated": is_coint
            }
        except Exception as e:
             johansen_res = {"error": str(e)}

        # Backtest module
        def run_backtest(y, x, const_beta, const_spread, b_mode, b_win, z_win, lev, tc_rate):
            y_series = pd.Series(y)
            x_series = pd.Series(x)
            
            exposure_beta = pd.Series(const_beta, index=y_series.index)
            spread_series = pd.Series(const_spread)
            
            if b_mode == "rolling":
                dynamic_spread = pd.Series(np.nan, index=y_series.index)
                rolling_beta = pd.Series(np.nan, index=y_series.index)
                
                # We need at least b_win points
                for i in range(int(b_win), len(y_series)):
                    y_win = y_series.iloc[i-int(b_win):i]
                    x_win = x_series.iloc[i-int(b_win):i]
                    X_win = sm.add_constant(x_win)
                    try:
                        model = sm.OLS(y_win, X_win).fit()
                        a = model.params.iloc[0]
                        b = model.params.iloc[1]
                        
                        rolling_beta.iloc[i] = b
                        # spread is realized out-of-sample today
                        dynamic_spread.iloc[i] = y_series.iloc[i] - (a + b * x_series.iloc[i])
                    except:
                        pass
                        
                # Fill initial nan with full-sample values just to avoid cutting series length 
                # or just leave them as NaN and positions won't trigger
                spread_series = dynamic_spread
                exposure_beta = rolling_beta
                
            rolling_mean = spread_series.rolling(window=int(z_win)).mean()
            rolling_std = spread_series.rolling(window=int(z_win)).std()
            z_score = (spread_series - rolling_mean) / rolling_std
            
            positions = np.zeros(len(spread_series))
            current_pos = 0
            
            for i in range(len(z_score)):
                z = z_score.iloc[i]
                if pd.isna(z) or np.isnan(z):
                    positions[i] = 0
                    continue
                    
                if z > 2.0:
                    current_pos = -1 # Short spread
                elif z < -2.0:
                    current_pos = 1 # Long spread
                elif current_pos == -1 and z <= 0.0:
                    current_pos = 0
                elif current_pos == 1 and z >= 0.0:
                    current_pos = 0
                    
                positions[i] = current_pos
                
            pos_series = pd.Series(positions).shift(1).fillna(0)
            spread_diff = spread_series.diff()
            
            # Gross exposure: Price of Y + |beta| * Price of X
            capital_exposure = exposure_beta.shift(1).abs()
            capital_exposure = capital_exposure.fillna(method='bfill').fillna(const_beta) # fallback
            capital = y_series.shift(1) + capital_exposure * x_series.shift(1)
            capital[capital == 0] = 1 # Avoid division by zero
            capital = capital.fillna(method='bfill').fillna(1)
            
            # Calculate trades and fees
            pos_changes = pos_series.diff().fillna(0)
            num_trades = int((pos_changes != 0).sum())
            
            # Transaction costs applied as percentage to notional value swapped
            notional_traded = pos_changes.abs() * capital
            tc_amount = notional_traded * float(tc_rate)
            
            daily_pnl = pos_series * spread_diff - tc_amount
            daily_ret = (daily_pnl / capital).fillna(0) * float(lev)
            
            cum_ret = (1 + daily_ret).cumprod()
            total_ret = cum_ret.iloc[-1] - 1 if len(cum_ret) > 0 else 0.0
            
            mean_ret = daily_ret.mean()
            std_ret = daily_ret.std()
            sharpe = (mean_ret / std_ret) * np.sqrt(252) if std_ret > 0 else 0.0
            
            rolling_max = cum_ret.cummax()
            drawdowns = cum_ret / rolling_max - 1
            max_dd = drawdowns.min() if len(drawdowns) > 0 else 0.0
            
            dd_duration = np.zeros(len(cum_ret))
            curr_duration = 0
            for i in range(len(cum_ret)):
                if cum_ret.iloc[i] >= rolling_max.iloc[i]:
                    curr_duration = 0
                else:
                    curr_duration += 1
                dd_duration[i] = curr_duration
            max_dd_duration = float(np.max(dd_duration)) if len(dd_duration) > 0 else 0.0
            
            return {
                "total_return": float(total_ret),
                "sharpe_ratio": float(sharpe),
                "max_drawdown": float(max_dd),
                "max_drawdown_duration": max_dd_duration,
                "trades_count": num_trades,
                "daily_returns": daily_ret.tolist(),
                "cumulative_returns": cum_ret.tolist(),
                "positions": positions.tolist(),
                "z_score": z_score.fillna(0).tolist(),
                "spread_series": spread_series.fillna(0).tolist()
            }

        bt_res = run_backtest(y, x, eg_y_on_x['beta'], eg_y_on_x['residuals'], beta_mode, beta_window, zscore_window, leverage, tc)

        return json.dumps({
            "success": True,
            "adf_y": adf_y_res,
            "adf_x": adf_x_res,
            "eg_y_on_x": eg_y_on_x,
            "eg_x_on_y": eg_x_on_y,
            "johansen": johansen_res,
            "backtest": bt_res
        })
    except Exception as e:
        import traceback
        return json.dumps({"success": False, "error": str(e), "trace": traceback.format_exc()})

run_test(y_data_in, x_data_in, beta_mode_in, beta_window_in, zscore_window_in, leverage_in, tc_in)
`;


    // Pass data into python scope
    pyodide.globals.set("y_data_in", pyodide.toPy(y));
    pyodide.globals.set("x_data_in", pyodide.toPy(x));
    pyodide.globals.set("beta_mode_in", backtestParams.betaMode);
    pyodide.globals.set("beta_window_in", backtestParams.betaWindow);
    pyodide.globals.set("zscore_window_in", backtestParams.zscoreWindow);
    pyodide.globals.set("leverage_in", backtestParams.leverage);
    pyodide.globals.set("tc_in", backtestParams.transactionCost);
    
    // Execute python script
    const resultStr = await pyodide.runPythonAsync(pythonCode);
    
    // Cleanup reference variables to avoid memory leaks in WebAssembly
    pyodide.globals.delete("y_data_in");
    pyodide.globals.delete("x_data_in");
    pyodide.globals.delete("beta_mode_in");
    pyodide.globals.delete("beta_window_in");
    pyodide.globals.delete("zscore_window_in");
    pyodide.globals.delete("leverage_in");
    pyodide.globals.delete("tc_in");
    
    const result = JSON.parse(resultStr);
    
    if (!result.success) {
        emitLog("Diagnostics failed: " + result.error);
        throw new Error(result.error);
    }
    
    emitLog("Diagnostics complete! Analyzed " + y.length + " data points.");
    
    return result as CointegrationResult;
}

