import 'dotenv/config'
import express from 'express'
import { createPublicClient, createWalletClient, http, formatEther, parseEther, formatUnits, parseUnits, encodePacked, maxUint256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

// ╔══════════════════════════════════════════════════════════════╗
// ║          AUTONOMOUS TRADING BOT - ETHEREUM SEPOLIA          ║
// ║  Real prices · Technical analysis · Risk management         ║
// ╚══════════════════════════════════════════════════════════════╝

// === CONFIGURATION ===
const CONFIG = {
  // Trading
  minTradeETH: 0.005,
  gasReserveETH: 0.015,
  slippageBps: 300,           // 3% slippage tolerance
  minProfitBps: 50,           // 0.5% minimum expected profit to trade
  maxPositionPct: 0.6,        // Never put >60% in one asset
  // Risk
  maxDrawdownPct: 0.15,       // Stop trading at 15% drawdown from peak
  trailingStopPct: 0.05,      // 5% trailing stop per position
  cooldownBlocks: 10,         // Minimum blocks between trades
  maxTradesPerHour: 6,
  // Indicators
  smaFast: 10,
  smaSlow: 30,
  emaFast: 12,
  emaSlow: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  bbPeriod: 20,
  bbStdDev: 2,
  // Signal
  minConfluence: 0.35,        // Minimum signal strength to trade
  // Server
  port: 3000,
  priceUpdateInterval: 12000, // ~1 block
}

// === ADDRESSES (Ethereum Sepolia) ===
const ADDR = {
  WETH:     '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',
  LINK:     '0x779877A7B0D9E8603169DdbD7836e478b4624789',
  USDC:     '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  ROUTER:   '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
  FACTORY:  '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
  POOL_WETH_USDC: '0xC31a3878E3B0739866F8fC52b97Ae9611aBe427c',
  POOL_LINK_USDC: '0x2d021e62D1aE41946846462d4bD8A85BB3d49C2c',
}

const DECIMALS = { [ADDR.WETH]: 18, [ADDR.LINK]: 18, [ADDR.USDC]: 6 }

// === ABIs ===
const ERC20_ABI = [
  { name: 'balanceOf', inputs: [{type:'address'}], outputs: [{type:'uint256'}], stateMutability: 'view', type: 'function' },
  { name: 'approve', inputs: [{name:'spender',type:'address'},{name:'amount',type:'uint256'}], outputs: [{type:'bool'}], stateMutability: 'nonpayable', type: 'function' },
  { name: 'allowance', inputs: [{name:'owner',type:'address'},{name:'spender',type:'address'}], outputs: [{type:'uint256'}], stateMutability: 'view', type: 'function' },
]

const WETH_ABI = [
  ...ERC20_ABI,
  { name: 'deposit', inputs: [], outputs: [], stateMutability: 'payable', type: 'function' },
  { name: 'withdraw', inputs: [{name:'wad',type:'uint256'}], outputs: [], stateMutability: 'nonpayable', type: 'function' },
]

const POOL_ABI = [
  { name: 'slot0', inputs: [], outputs: [{name:'sqrtPriceX96',type:'uint160'},{name:'tick',type:'int24'},{name:'observationIndex',type:'uint16'},{name:'observationCardinality',type:'uint16'},{name:'observationCardinalityNext',type:'uint16'},{name:'feeProtocol',type:'uint8'},{name:'unlocked',type:'bool'}], stateMutability: 'view', type: 'function' },
  { name: 'liquidity', inputs: [], outputs: [{type:'uint128'}], stateMutability: 'view', type: 'function' },
  { name: 'token0', inputs: [], outputs: [{type:'address'}], stateMutability: 'view', type: 'function' },
  { name: 'token1', inputs: [], outputs: [{type:'address'}], stateMutability: 'view', type: 'function' },
]

const ROUTER_ABI = [
  {
    name: 'exactInputSingle',
    inputs: [{ name: 'params', type: 'tuple', components: [
      {name:'tokenIn',type:'address'},{name:'tokenOut',type:'address'},
      {name:'fee',type:'uint24'},{name:'recipient',type:'address'},
      {name:'amountIn',type:'uint256'},{name:'amountOutMinimum',type:'uint256'},
      {name:'sqrtPriceLimitX96',type:'uint160'}
    ]}],
    outputs: [{name:'amountOut',type:'uint256'}],
    stateMutability: 'payable', type: 'function'
  },
  {
    name: 'exactInput',
    inputs: [{ name: 'params', type: 'tuple', components: [
      {name:'path',type:'bytes'},{name:'recipient',type:'address'},
      {name:'amountIn',type:'uint256'},{name:'amountOutMinimum',type:'uint256'}
    ]}],
    outputs: [{name:'amountOut',type:'uint256'}],
    stateMutability: 'payable', type: 'function'
  },
]

// === CLIENTS ===
const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`)
const transport = http(process.env.RPC_URL)
const publicClient = createPublicClient({ chain: sepolia, transport })
const walletClient = createWalletClient({ account, chain: sepolia, transport })

// === STATE ===
const state = {
  running: false,
  // Balances (human-readable)
  ethBalance: 0,
  wethBalance: 0,
  linkBalance: 0,
  usdcBalance: 0,
  // Prices (in USDC)
  ethPrice: 0,
  linkPrice: 0,
  // Price history
  ethPriceHistory: [],    // { time, price }
  linkPriceHistory: [],
  // Indicators (latest values)
  indicators: {
    eth: { smaFast: 0, smaSlow: 0, ema12: 0, ema26: 0, rsi: 50, macd: 0, macdSignal: 0, macdHist: 0, bbUpper: 0, bbMiddle: 0, bbLower: 0, bbPctB: 0.5 },
    link: { smaFast: 0, smaSlow: 0, ema12: 0, ema26: 0, rsi: 50, macd: 0, macdSignal: 0, macdHist: 0, bbUpper: 0, bbMiddle: 0, bbLower: 0, bbPctB: 0.5 },
  },
  // Signals
  signals: { eth: 0, link: 0, ethDetails: {}, linkDetails: {} },
  // Trading
  lastBlock: 0,
  lastTradeBlock: 0,
  tradesExecuted: 0,
  tradeHistory: [],
  totalPNL: 0,
  portfolioPeakUSD: 0,
  currentDrawdown: 0,
  drawdownHalted: false,
  // Gas
  gasPrice: 0,
  // Config (mutable from dashboard)
  config: { ...CONFIG },
}

// EMA state (needs persistent accumulation)
const emaState = {
  eth: { ema12: null, ema26: null, macdEma9: null, rsiAvgGain: null, rsiAvgLoss: null },
  link: { ema12: null, ema26: null, macdEma9: null, rsiAvgGain: null, rsiAvgLoss: null },
}

// ══════════════════════════════════════════
//  TECHNICAL INDICATORS
// ══════════════════════════════════════════

function calcSMA(prices, period) {
  if (prices.length < period) return null
  const slice = prices.slice(-period)
  return slice.reduce((s, p) => s + p.price, 0) / period
}

function calcEMA(newPrice, prevEMA, period) {
  if (prevEMA === null) return newPrice
  const k = 2 / (period + 1)
  return newPrice * k + prevEMA * (1 - k)
}

function calcRSI(prices, period, prevAvgGain, prevAvgLoss) {
  if (prices.length < period + 1) return { rsi: 50, avgGain: null, avgLoss: null }

  if (prevAvgGain === null) {
    // Initial calculation using SMA
    let gains = 0, losses = 0
    const recent = prices.slice(-(period + 1))
    for (let i = 1; i < recent.length; i++) {
      const change = recent[i].price - recent[i - 1].price
      if (change > 0) gains += change
      else losses += Math.abs(change)
    }
    const avgGain = gains / period
    const avgLoss = losses / period
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    return { rsi: 100 - (100 / (1 + rs)), avgGain, avgLoss }
  }

  // Smoothed calculation
  const change = prices[prices.length - 1].price - prices[prices.length - 2].price
  const gain = change > 0 ? change : 0
  const loss = change < 0 ? Math.abs(change) : 0
  const avgGain = (prevAvgGain * (period - 1) + gain) / period
  const avgLoss = (prevAvgLoss * (period - 1) + loss) / period
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
  return { rsi: 100 - (100 / (1 + rs)), avgGain, avgLoss }
}

function calcBollingerBands(prices, period, stdDevMult) {
  if (prices.length < period) return null
  const slice = prices.slice(-period)
  const values = slice.map(p => p.price)
  const mean = values.reduce((s, v) => s + v, 0) / period
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period
  const stdDev = Math.sqrt(variance)
  const upper = mean + stdDevMult * stdDev
  const lower = mean - stdDevMult * stdDev
  const pctB = stdDev === 0 ? 0.5 : (values[values.length - 1] - lower) / (upper - lower)
  return { upper, middle: mean, lower, pctB: Math.max(0, Math.min(1, pctB)) }
}

function updateIndicators(asset, priceHistory) {
  const prices = priceHistory
  const currentPrice = prices.length > 0 ? prices[prices.length - 1].price : 0
  const es = emaState[asset]
  const ind = state.indicators[asset]

  // SMA
  ind.smaFast = calcSMA(prices, state.config.smaFast) || currentPrice
  ind.smaSlow = calcSMA(prices, state.config.smaSlow) || currentPrice

  // EMA
  es.ema12 = calcEMA(currentPrice, es.ema12, state.config.emaFast)
  es.ema26 = calcEMA(currentPrice, es.ema26, state.config.emaSlow)
  ind.ema12 = es.ema12
  ind.ema26 = es.ema26

  // MACD
  ind.macd = es.ema12 - es.ema26
  es.macdEma9 = calcEMA(ind.macd, es.macdEma9, state.config.macdSignal)
  ind.macdSignal = es.macdEma9
  ind.macdHist = ind.macd - ind.macdSignal

  // RSI
  const rsiResult = calcRSI(prices, state.config.rsiPeriod, es.rsiAvgGain, es.rsiAvgLoss)
  ind.rsi = rsiResult.rsi
  es.rsiAvgGain = rsiResult.avgGain
  es.rsiAvgLoss = rsiResult.avgLoss

  // Bollinger Bands
  const bb = calcBollingerBands(prices, state.config.bbPeriod, state.config.bbStdDev)
  if (bb) {
    ind.bbUpper = bb.upper
    ind.bbMiddle = bb.middle
    ind.bbLower = bb.lower
    ind.bbPctB = bb.pctB
  }
}

// ══════════════════════════════════════════
//  SIGNAL GENERATOR
// ══════════════════════════════════════════

function generateSignal(asset) {
  const ind = state.indicators[asset]
  const prices = asset === 'eth' ? state.ethPriceHistory : state.linkPriceHistory
  if (prices.length < state.config.smaSlow) return { composite: 0, details: { sma: 0, rsi: 0, macd: 0, bb: 0, trend: 0 } }

  const details = {}

  // 1. SMA Crossover (-1 to +1)
  if (ind.smaSlow > 0) {
    const ratio = (ind.smaFast - ind.smaSlow) / ind.smaSlow
    details.sma = Math.max(-1, Math.min(1, ratio * 20)) // Scale: 5% diff = full signal
  } else details.sma = 0

  // 2. RSI (-1 to +1)
  if (ind.rsi <= 30) details.rsi = (30 - ind.rsi) / 30        // Oversold → buy signal
  else if (ind.rsi >= 70) details.rsi = -(ind.rsi - 70) / 30   // Overbought → sell signal
  else details.rsi = 0

  // 3. MACD Histogram (-1 to +1)
  if (ind.bbMiddle > 0) {
    details.macd = Math.max(-1, Math.min(1, (ind.macdHist / ind.bbMiddle) * 100))
  } else details.macd = 0

  // 4. Bollinger %B (-1 to +1)
  details.bb = -(ind.bbPctB - 0.5) * 2 // Below middle = buy, above = sell

  // 5. Trend (price vs SMA slow) (-1 to +1)
  const currentPrice = prices[prices.length - 1].price
  if (ind.smaSlow > 0) {
    details.trend = Math.max(-1, Math.min(1, ((currentPrice - ind.smaSlow) / ind.smaSlow) * 10))
  } else details.trend = 0

  // Weighted composite
  const weights = { sma: 0.25, rsi: 0.20, macd: 0.20, bb: 0.20, trend: 0.15 }
  const composite = Object.keys(weights).reduce((sum, k) => sum + (details[k] || 0) * weights[k], 0)

  return { composite: Math.max(-1, Math.min(1, composite)), details }
}

// ══════════════════════════════════════════
//  PRICE ENGINE
// ══════════════════════════════════════════

function decodeSqrtPrice(sqrtPriceX96, decimals0, decimals1) {
  // price = (sqrtPriceX96 / 2^96)^2 gives token1/token0 in raw units
  // Adjust for decimals: multiply by 10^(decimals0 - decimals1)
  const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96)
  const priceRaw = sqrtPrice * sqrtPrice
  return priceRaw * Math.pow(10, decimals0 - decimals1)
}

async function fetchPrices() {
  try {
    // WETH/USDC pool: USDC(token0, 6dec), WETH(token1, 18dec)
    const wethSlot = await publicClient.readContract({
      address: ADDR.POOL_WETH_USDC, abi: POOL_ABI, functionName: 'slot0'
    })
    // price = WETH/USDC in raw → human = token1_per_token0
    const wethPerUsdc = decodeSqrtPrice(wethSlot[0], 6, 18)
    state.ethPrice = wethPerUsdc > 0 ? 1 / wethPerUsdc : 0 // USDC per WETH

    // LINK/USDC pool: LINK is 0x779..., USDC is 0x1c7...
    // 0x1c7 < 0x779 → USDC=token0, LINK=token1
    const linkSlot = await publicClient.readContract({
      address: ADDR.POOL_LINK_USDC, abi: POOL_ABI, functionName: 'slot0'
    })
    const linkPerUsdc = decodeSqrtPrice(linkSlot[0], 6, 18)
    state.linkPrice = linkPerUsdc > 0 ? 1 / linkPerUsdc : 0 // USDC per LINK

    // Record history
    const now = Date.now()
    if (state.ethPrice > 0) {
      state.ethPriceHistory.push({ time: now, price: state.ethPrice })
      if (state.ethPriceHistory.length > 500) state.ethPriceHistory.shift()
      updateIndicators('eth', state.ethPriceHistory)
    }
    if (state.linkPrice > 0) {
      state.linkPriceHistory.push({ time: now, price: state.linkPrice })
      if (state.linkPriceHistory.length > 500) state.linkPriceHistory.shift()
      updateIndicators('link', state.linkPriceHistory)
    }

    // Update signals
    const ethSig = generateSignal('eth')
    const linkSig = generateSignal('link')
    state.signals.eth = ethSig.composite
    state.signals.link = linkSig.composite
    state.signals.ethDetails = ethSig.details
    state.signals.linkDetails = linkSig.details

    return true
  } catch (e) {
    log(`Price fetch error: ${e.message.split('\n')[0]}`, 'ERROR')
    return false
  }
}

// ══════════════════════════════════════════
//  BALANCE ENGINE
// ══════════════════════════════════════════

async function updateBalances() {
  try {
    const [eth, weth, link, usdc] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({ address: ADDR.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n),
      publicClient.readContract({ address: ADDR.LINK, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n),
      publicClient.readContract({ address: ADDR.USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n),
    ])
    state.ethBalance = parseFloat(formatEther(eth))
    state.wethBalance = parseFloat(formatEther(weth))
    state.linkBalance = parseFloat(formatEther(link))
    state.usdcBalance = parseFloat(formatUnits(usdc, 6))
  } catch (e) {
    log(`Balance error: ${e.message.split('\n')[0]}`, 'ERROR')
  }
}

function getPortfolioUSD() {
  return (state.ethBalance + state.wethBalance) * state.ethPrice
       + state.linkBalance * state.linkPrice
       + state.usdcBalance
}

// ══════════════════════════════════════════
//  RISK MANAGER
// ══════════════════════════════════════════

function checkRisk() {
  const issues = []

  // Max drawdown check
  const portfolioUSD = getPortfolioUSD()
  if (portfolioUSD > state.portfolioPeakUSD) state.portfolioPeakUSD = portfolioUSD
  if (state.portfolioPeakUSD > 0) {
    state.currentDrawdown = (state.portfolioPeakUSD - portfolioUSD) / state.portfolioPeakUSD
    if (state.currentDrawdown > state.config.maxDrawdownPct) {
      state.drawdownHalted = true
      issues.push(`MAX DRAWDOWN ${(state.currentDrawdown * 100).toFixed(1)}%`)
    }
  }

  // Cooldown check
  if (state.lastBlock - state.lastTradeBlock < state.config.cooldownBlocks) {
    issues.push(`COOLDOWN (${state.config.cooldownBlocks - (state.lastBlock - state.lastTradeBlock)} blocks)`)
  }

  // Rate limit check
  const oneHourAgo = Date.now() - 3600000
  const recentTrades = state.tradeHistory.filter(t => t.time > oneHourAgo)
  if (recentTrades.length >= state.config.maxTradesPerHour) {
    issues.push(`RATE LIMIT (${recentTrades.length}/${state.config.maxTradesPerHour}/hr)`)
  }

  // Gas too high (>50 gwei is expensive for testnet)
  if (state.gasPrice > 50e9) {
    issues.push(`HIGH GAS (${(state.gasPrice / 1e9).toFixed(0)} gwei)`)
  }

  // Insufficient ETH for gas
  if (state.ethBalance < state.config.gasReserveETH) {
    issues.push(`LOW GAS RESERVE (${state.ethBalance.toFixed(4)} ETH)`)
  }

  return { ok: issues.length === 0, issues }
}

// ══════════════════════════════════════════
//  EXECUTION ENGINE
// ══════════════════════════════════════════

async function ensureApproval(tokenAddr, spender, amount) {
  try {
    const allowance = await publicClient.readContract({
      address: tokenAddr, abi: ERC20_ABI, functionName: 'allowance',
      args: [account.address, spender]
    })
    if (allowance < amount) {
      log(`Approving ${tokenAddr.slice(0, 10)}... for router`, 'TX')
      const tx = await walletClient.writeContract({
        address: tokenAddr, abi: ERC20_ABI, functionName: 'approve',
        args: [spender, maxUint256]
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      log(`Approved. TX: ${tx}`, 'TX')
    }
    return true
  } catch (e) {
    log(`Approval failed: ${e.message.split('\n')[0]}`, 'ERROR')
    return false
  }
}

async function wrapETH(amountETH) {
  try {
    const value = parseEther(amountETH.toFixed(18))
    log(`Wrapping ${amountETH.toFixed(6)} ETH → WETH`, 'TX')
    const tx = await walletClient.writeContract({
      address: ADDR.WETH, abi: WETH_ABI, functionName: 'deposit', value
    })
    await publicClient.waitForTransactionReceipt({ hash: tx })
    log(`Wrapped! TX: ${tx}`, 'TX')
    recordTrade('WRAP', 'ETH', 'WETH', amountETH, amountETH, tx)
    return true
  } catch (e) {
    log(`Wrap failed: ${e.message.split('\n')[0]}`, 'ERROR')
    return false
  }
}

async function swapExact(tokenIn, tokenOut, amountIn, fee = 3000) {
  const decimalsIn = DECIMALS[tokenIn] || 18
  const decimalsOut = DECIMALS[tokenOut] || 18
  const amountInRaw = decimalsIn === 18 ? parseEther(amountIn.toFixed(18)) : parseUnits(amountIn.toFixed(decimalsIn), decimalsIn)

  // Calculate minimum output with slippage
  let expectedOut = 0
  if (tokenIn === ADDR.WETH && tokenOut === ADDR.USDC) {
    expectedOut = amountIn * state.ethPrice
  } else if (tokenIn === ADDR.USDC && tokenOut === ADDR.WETH) {
    expectedOut = state.ethPrice > 0 ? amountIn / state.ethPrice : 0
  } else if (tokenIn === ADDR.LINK && tokenOut === ADDR.USDC) {
    expectedOut = amountIn * state.linkPrice
  } else if (tokenIn === ADDR.USDC && tokenOut === ADDR.LINK) {
    expectedOut = state.linkPrice > 0 ? amountIn / state.linkPrice : 0
  }

  const minOut = expectedOut * (1 - state.config.slippageBps / 10000)
  const amountOutMin = decimalsOut === 18 ? parseEther(Math.max(0, minOut).toFixed(18)) : parseUnits(Math.max(0, minOut).toFixed(decimalsOut), decimalsOut)

  if (!await ensureApproval(tokenIn, ADDR.ROUTER, amountInRaw)) return false

  const tokenNames = {
    [ADDR.WETH]: 'WETH', [ADDR.LINK]: 'LINK', [ADDR.USDC]: 'USDC'
  }
  log(`Swapping ${amountIn.toFixed(6)} ${tokenNames[tokenIn]} → ${tokenNames[tokenOut]} (min: ${minOut.toFixed(6)})`, 'TX')

  try {
    const tx = await walletClient.writeContract({
      address: ADDR.ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle',
      args: [{
        tokenIn, tokenOut, fee, recipient: account.address,
        amountIn: amountInRaw, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0n
      }]
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
    log(`Swapped! TX: ${tx} (gas: ${receipt.gasUsed})`, 'TX')
    recordTrade('SWAP', tokenNames[tokenIn], tokenNames[tokenOut], amountIn, expectedOut, tx)
    return true
  } catch (e) {
    log(`Swap failed: ${e.message.split('\n')[0]}`, 'ERROR')
    return false
  }
}

async function swapMultiHop(tokenIn, tokenMid, tokenOut, amountIn, fee1 = 3000, fee2 = 3000) {
  const decimalsIn = DECIMALS[tokenIn] || 18
  const amountInRaw = decimalsIn === 18 ? parseEther(amountIn.toFixed(18)) : parseUnits(amountIn.toFixed(decimalsIn), decimalsIn)

  const path = encodePacked(
    ['address', 'uint24', 'address', 'uint24', 'address'],
    [tokenIn, fee1, tokenMid, fee2, tokenOut]
  )

  if (!await ensureApproval(tokenIn, ADDR.ROUTER, amountInRaw)) return false

  const tokenNames = { [ADDR.WETH]: 'WETH', [ADDR.LINK]: 'LINK', [ADDR.USDC]: 'USDC' }
  log(`Multi-hop: ${tokenNames[tokenIn]} → ${tokenNames[tokenMid]} → ${tokenNames[tokenOut]}`, 'TX')

  try {
    const tx = await walletClient.writeContract({
      address: ADDR.ROUTER, abi: ROUTER_ABI, functionName: 'exactInput',
      args: [{ path, recipient: account.address, amountIn: amountInRaw, amountOutMinimum: 0n }]
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
    log(`Multi-hop done! TX: ${tx}`, 'TX')
    recordTrade('SWAP', tokenNames[tokenIn], tokenNames[tokenOut], amountIn, 0, tx)
    return true
  } catch (e) {
    log(`Multi-hop failed: ${e.message.split('\n')[0]}`, 'ERROR')
    return false
  }
}

function recordTrade(type, from, to, amountIn, amountOut, tx) {
  state.tradesExecuted++
  state.lastTradeBlock = state.lastBlock
  state.tradeHistory.push({
    time: Date.now(), type, from, to, amountIn, amountOut, tx,
    ethPrice: state.ethPrice, linkPrice: state.linkPrice,
    block: state.lastBlock
  })
  if (state.tradeHistory.length > 100) state.tradeHistory.shift()
}

// ══════════════════════════════════════════
//  TRADING STRATEGY
// ══════════════════════════════════════════

async function executeStrategy() {
  if (!state.running) return
  if (state.drawdownHalted) { log('Trading halted: max drawdown reached', 'RISK'); return }

  const risk = checkRisk()
  if (!risk.ok) { log(`Risk check failed: ${risk.issues.join(', ')}`, 'RISK'); return }

  const portfolioUSD = getPortfolioUSD()
  const ethSignal = state.signals.eth
  const linkSignal = state.signals.link

  // Calculate current allocation percentages
  const ethValueUSD = (state.ethBalance + state.wethBalance) * state.ethPrice
  const linkValueUSD = state.linkBalance * state.linkPrice
  const usdcValueUSD = state.usdcBalance
  const ethPct = portfolioUSD > 0 ? ethValueUSD / portfolioUSD : 0
  const linkPct = portfolioUSD > 0 ? linkValueUSD / portfolioUSD : 0
  const usdcPct = portfolioUSD > 0 ? usdcValueUSD / portfolioUSD : 0

  log(`Signal ETH: ${ethSignal.toFixed(3)} | LINK: ${linkSignal.toFixed(3)} | Alloc: ETH ${(ethPct*100).toFixed(0)}% LINK ${(linkPct*100).toFixed(0)}% USDC ${(usdcPct*100).toFixed(0)}%`, 'SIGNAL')

  // === DECISION LOGIC ===

  // Strong BUY signal for LINK → move funds into LINK
  if (linkSignal > state.config.minConfluence) {
    // If we have USDC, buy LINK
    if (state.usdcBalance > 1 && linkPct < state.config.maxPositionPct) {
      const buyAmount = state.usdcBalance * Math.min(0.5, Math.abs(linkSignal))
      if (buyAmount > 0.5) {
        await swapExact(ADDR.USDC, ADDR.LINK, buyAmount)
        return
      }
    }
    // If we have WETH but no USDC, sell WETH for USDC first
    if (state.wethBalance > 0.001 && state.usdcBalance < 1) {
      const sellAmount = state.wethBalance * Math.min(0.5, Math.abs(linkSignal))
      if (sellAmount > 0.0005) {
        await swapExact(ADDR.WETH, ADDR.USDC, sellAmount)
        return
      }
    }
    // If we have ETH, wrap some to WETH
    if (state.ethBalance > state.config.gasReserveETH + state.config.minTradeETH && state.wethBalance < 0.001) {
      const wrapAmount = (state.ethBalance - state.config.gasReserveETH) * Math.min(0.5, Math.abs(linkSignal))
      if (wrapAmount > state.config.minTradeETH) {
        await wrapETH(wrapAmount)
        return
      }
    }
  }

  // Strong SELL signal for LINK → move LINK to USDC
  if (linkSignal < -state.config.minConfluence && state.linkBalance > 0.01) {
    const sellAmount = state.linkBalance * Math.min(0.5, Math.abs(linkSignal))
    if (sellAmount > 0.005 && state.linkPrice > 0) {
      await swapExact(ADDR.LINK, ADDR.USDC, sellAmount)
      return
    }
  }

  // Strong BUY signal for ETH → move funds into WETH
  if (ethSignal > state.config.minConfluence) {
    if (state.usdcBalance > 1 && ethPct < state.config.maxPositionPct) {
      const buyAmount = state.usdcBalance * Math.min(0.5, Math.abs(ethSignal))
      if (buyAmount > 0.5) {
        await swapExact(ADDR.USDC, ADDR.WETH, buyAmount)
        return
      }
    }
    if (state.ethBalance > state.config.gasReserveETH + state.config.minTradeETH && state.wethBalance < 0.001) {
      const wrapAmount = (state.ethBalance - state.config.gasReserveETH) * Math.min(0.3, Math.abs(ethSignal))
      if (wrapAmount > state.config.minTradeETH) {
        await wrapETH(wrapAmount)
        return
      }
    }
  }

  // Strong SELL signal for ETH → move WETH to USDC
  if (ethSignal < -state.config.minConfluence && state.wethBalance > 0.001) {
    const sellAmount = state.wethBalance * Math.min(0.5, Math.abs(ethSignal))
    if (sellAmount > 0.0005) {
      await swapExact(ADDR.WETH, ADDR.USDC, sellAmount)
      return
    }
  }

  // Risk-off: if both signals are negative, park in USDC
  if (ethSignal < -0.2 && linkSignal < -0.2) {
    if (state.wethBalance > 0.001) {
      await swapExact(ADDR.WETH, ADDR.USDC, state.wethBalance * 0.3)
      return
    }
    if (state.linkBalance > 0.01 && state.linkPrice > 0) {
      await swapExact(ADDR.LINK, ADDR.USDC, state.linkBalance * 0.3)
      return
    }
  }
}

// ══════════════════════════════════════════
//  MAIN LOOP
// ══════════════════════════════════════════

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString().slice(11, 19)
  const prefix = { INFO: '📊', TX: '💱', ERROR: '❌', RISK: '🛡️', SIGNAL: '📡' }[level] || '·'
  const line = `[${ts}] ${prefix} ${msg}`
  console.log(line)
  state.tradeHistory.length > 0 || state.tradeHistory // keep log accessible
}

async function mainLoop() {
  try {
    const block = await publicClient.getBlockNumber()
    const blockNum = Number(block)
    if (blockNum <= state.lastBlock) return
    state.lastBlock = blockNum

    // Update gas price
    try { state.gasPrice = Number(await publicClient.getGasPrice()) } catch {}

    // Fetch real prices from pools
    await fetchPrices()

    // Update balances
    await updateBalances()

    // Update portfolio peak
    const portfolioUSD = getPortfolioUSD()
    if (portfolioUSD > state.portfolioPeakUSD) state.portfolioPeakUSD = portfolioUSD

    // Log status every 5 blocks
    if (blockNum % 5 === 0) {
      log(`Block ${blockNum} | ETH: ${state.ethBalance.toFixed(4)} WETH: ${state.wethBalance.toFixed(4)} LINK: ${state.linkBalance.toFixed(2)} USDC: ${state.usdcBalance.toFixed(2)} | ETH$${state.ethPrice.toFixed(2)} LINK$${state.linkPrice.toFixed(4)}`)
    }

    // Execute strategy
    if (state.running && state.ethPriceHistory.length >= state.config.smaSlow) {
      await executeStrategy()
    } else if (state.running && state.ethPriceHistory.length < state.config.smaSlow) {
      if (blockNum % 10 === 0) log(`Collecting price data... ${state.ethPriceHistory.length}/${state.config.smaSlow} samples needed`)
    }

  } catch (e) {
    log(`Loop error: ${e.message.split('\n')[0]}`, 'ERROR')
  }
}

// ══════════════════════════════════════════
//  DASHBOARD SERVER
// ══════════════════════════════════════════

const app = express()
app.use(express.json())

app.get('/', (req, res) => {
  res.send(DASHBOARD_HTML)
})

app.get('/api/state', (req, res) => {
  res.json({
    ...state,
    portfolioUSD: getPortfolioUSD(),
    wallet: account.address,
    gasGwei: (state.gasPrice / 1e9).toFixed(1),
  })
})

app.post('/api/control', (req, res) => {
  const { action } = req.body
  if (action === 'start') { state.running = true; state.drawdownHalted = false; log('Bot STARTED', 'INFO') }
  else if (action === 'stop') { state.running = false; log('Bot STOPPED', 'INFO') }
  else if (action === 'reset-drawdown') { state.drawdownHalted = false; state.portfolioPeakUSD = getPortfolioUSD(); log('Drawdown reset', 'RISK') }
  res.json({ running: state.running })
})

app.post('/api/config', (req, res) => {
  Object.assign(state.config, req.body)
  log(`Config updated: ${JSON.stringify(req.body)}`)
  res.json({ config: state.config })
})

// ══════════════════════════════════════════
//  DASHBOARD HTML
// ══════════════════════════════════════════

const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><title>Trading Bot</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Monaco','Menlo','Consolas',monospace;background:#0a0e1a;color:#e0e0e0;padding:12px}
.g{display:grid;gap:12px}
.g2{grid-template-columns:1fr 1fr}
.g3{grid-template-columns:1fr 1fr 1fr}
@media(max-width:900px){.g2,.g3{grid-template-columns:1fr}}
.c{background:#141824;border:1px solid #1e2538;border-radius:8px;padding:14px}
.c h3{color:#7aa2f7;font-size:.85em;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px}
h1{text-align:center;color:#7aa2f7;font-size:1.6em;margin-bottom:14px}
.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e2538;font-size:.85em}
.lbl{color:#888}.val{font-weight:bold}
.grn{color:#9ece6a}.red{color:#f7768e}.yel{color:#e0af68}.blu{color:#7aa2f7}.wht{color:#ccc}
canvas{width:100%;border-radius:4px;background:#0d1117}
.btn{padding:8px 16px;border:none;border-radius:4px;cursor:pointer;font-family:monospace;font-weight:bold;font-size:.8em;transition:all .2s}
.btn-go{background:#9ece6a;color:#000}.btn-go:hover{background:#b5e089}
.btn-stop{background:#f7768e;color:#fff}.btn-stop:hover{background:#ff8fa3}
.btn-cfg{background:#7aa2f7;color:#000}.btn-cfg:hover{background:#93b8ff}
.btn-rst{background:#e0af68;color:#000}
.ctrls{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
input[type=number]{background:#0d1117;border:1px solid #2a3050;color:#e0e0e0;padding:5px 8px;border-radius:4px;font-family:monospace;width:90px}
.cfg-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;font-size:.8em}
.cfg-grid label{color:#888}
.signal-bar{height:6px;border-radius:3px;background:#1e2538;overflow:hidden;margin:4px 0}
.signal-fill{height:100%;border-radius:3px;transition:width .3s}
.trades{max-height:180px;overflow-y:auto;font-size:.75em}
.trade-item{padding:5px 0;border-bottom:1px solid #1e2538}
.status{padding:8px;border-radius:4px;text-align:center;font-weight:bold;font-size:.9em}
.status.on{background:#1a2e1a;color:#9ece6a;border:1px solid #9ece6a}
.status.off{background:#2e1a1a;color:#f7768e;border:1px solid #f7768e}
.status.halt{background:#2e2a1a;color:#e0af68;border:1px solid #e0af68}
.piechart{display:flex;height:14px;border-radius:7px;overflow:hidden;margin:6px 0}
.pie-eth{background:#e0af68}.pie-link{background:#9ece6a}.pie-usdc{background:#7aa2f7}.pie-weth{background:#bb9af7}
</style></head><body>
<h1>AUTONOMOUS TRADING BOT</h1>
<div class="g g2">
  <div class="c">
    <h3>Control Center</h3>
    <div class="status off" id="status">STOPPED</div>
    <div class="ctrls">
      <button class="btn btn-go" onclick="ctl('start')">START</button>
      <button class="btn btn-stop" onclick="ctl('stop')">STOP</button>
      <button class="btn btn-rst" onclick="ctl('reset-drawdown')">RESET DD</button>
      <button class="btn btn-cfg" onclick="toggleCfg()">CONFIG</button>
    </div>
    <div id="cfgPanel" style="display:none">
      <div class="cfg-grid">
        <label>Min Trade ETH</label><input type="number" id="cfgMinTrade" step="0.001" value="0.005">
        <label>Gas Reserve ETH</label><input type="number" id="cfgGasReserve" step="0.001" value="0.015">
        <label>Slippage BPS</label><input type="number" id="cfgSlippage" step="50" value="300">
        <label>Max Position %</label><input type="number" id="cfgMaxPos" step="5" value="60">
        <label>Max Drawdown %</label><input type="number" id="cfgMaxDD" step="1" value="15">
        <label>Cooldown Blocks</label><input type="number" id="cfgCooldown" step="1" value="10">
        <label>Min Confluence</label><input type="number" id="cfgMinConf" step="0.05" value="0.35">
        <label>Trades/Hour</label><input type="number" id="cfgMaxTrades" step="1" value="6">
      </div>
      <div class="ctrls"><button class="btn btn-cfg" onclick="saveCfg()">SAVE CONFIG</button></div>
    </div>
  </div>
  <div class="c">
    <h3>Portfolio</h3>
    <div class="row"><span class="lbl">ETH</span><span class="val yel" id="vETH">0</span></div>
    <div class="row"><span class="lbl">WETH</span><span class="val" style="color:#bb9af7" id="vWETH">0</span></div>
    <div class="row"><span class="lbl">LINK</span><span class="val grn" id="vLINK">0</span></div>
    <div class="row"><span class="lbl">USDC</span><span class="val blu" id="vUSDC">0</span></div>
    <div class="piechart" id="pie"></div>
    <div class="row"><span class="lbl">Total (USD)</span><span class="val wht" id="vTotal">$0</span></div>
    <div class="row"><span class="lbl">Drawdown</span><span class="val" id="vDD">0%</span></div>
  </div>
</div>
<div class="g g2" style="margin-top:12px">
  <div class="c">
    <h3>ETH/USDC Price Chart</h3>
    <canvas id="chartETH" height="180"></canvas>
    <div class="row" style="margin-top:6px"><span class="lbl">ETH Price</span><span class="val yel" id="pETH">--</span></div>
    <div class="row"><span class="lbl">SMA ${CONFIG.smaFast}/${CONFIG.smaSlow}</span><span class="val" id="smaETH">--</span></div>
    <div class="row"><span class="lbl">RSI(${CONFIG.rsiPeriod})</span><span class="val" id="rsiETH">--</span></div>
    <div class="row"><span class="lbl">MACD Hist</span><span class="val" id="macdETH">--</span></div>
    <div class="row"><span class="lbl">BB %B</span><span class="val" id="bbETH">--</span></div>
    <div style="margin-top:6px;font-size:.8em"><span class="lbl">Signal:</span> <span class="val" id="sigETH">0</span></div>
    <div class="signal-bar"><div class="signal-fill" id="sigBarETH" style="width:50%;background:#888"></div></div>
  </div>
  <div class="c">
    <h3>LINK/USDC Price Chart</h3>
    <canvas id="chartLINK" height="180"></canvas>
    <div class="row" style="margin-top:6px"><span class="lbl">LINK Price</span><span class="val grn" id="pLINK">--</span></div>
    <div class="row"><span class="lbl">SMA ${CONFIG.smaFast}/${CONFIG.smaSlow}</span><span class="val" id="smaLINK">--</span></div>
    <div class="row"><span class="lbl">RSI(${CONFIG.rsiPeriod})</span><span class="val" id="rsiLINK">--</span></div>
    <div class="row"><span class="lbl">MACD Hist</span><span class="val" id="macdLINK">--</span></div>
    <div class="row"><span class="lbl">BB %B</span><span class="val" id="bbLINK">--</span></div>
    <div style="margin-top:6px;font-size:.8em"><span class="lbl">Signal:</span> <span class="val" id="sigLINK">0</span></div>
    <div class="signal-bar"><div class="signal-fill" id="sigBarLINK" style="width:50%;background:#888"></div></div>
  </div>
</div>
<div class="g g2" style="margin-top:12px">
  <div class="c">
    <h3>Trading Stats</h3>
    <div class="row"><span class="lbl">Trades</span><span class="val" id="vTrades">0</span></div>
    <div class="row"><span class="lbl">Block</span><span class="val" id="vBlock">--</span></div>
    <div class="row"><span class="lbl">Gas</span><span class="val" id="vGas">--</span></div>
    <div class="row"><span class="lbl">Samples</span><span class="val" id="vSamples">0</span></div>
    <div class="row"><span class="lbl">Network</span><span class="val">Sepolia</span></div>
    <div class="row"><span class="lbl">Router</span><span class="val">UniV3 SwapRouter02</span></div>
    <div class="row"><span class="lbl">Wallet</span><span class="val" id="vWallet" style="font-size:.75em">--</span></div>
  </div>
  <div class="c">
    <h3>Trade History</h3>
    <div class="trades" id="tradeLog"><div class="trade-item wht">Waiting for trades...</div></div>
  </div>
</div>
<script>
const $ = id => document.getElementById(id)

function drawChart(canvasId, priceHistory, indicators, color) {
  const canvas = $(canvasId)
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)
  const W = rect.width, H = rect.height

  if (!priceHistory || priceHistory.length < 2) {
    ctx.fillStyle = '#888'
    ctx.font = '12px monospace'
    ctx.fillText('Collecting data...', W/2-50, H/2)
    return
  }

  const prices = priceHistory.map(p => p.price)
  const min = Math.min(...prices) * 0.998
  const max = Math.max(...prices) * 1.002
  const range = max - min || 1
  const xStep = W / (prices.length - 1)
  const toY = v => H - 10 - ((v - min) / range) * (H - 20)

  // Grid
  ctx.strokeStyle = '#1e2538'
  ctx.lineWidth = 0.5
  for (let i = 0; i < 5; i++) {
    const y = 10 + i * (H - 20) / 4
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }

  // Bollinger bands
  if (indicators.bbUpper && indicators.bbLower && priceHistory.length >= 20) {
    ctx.fillStyle = color + '10'
    ctx.beginPath()
    ctx.moveTo(0, toY(indicators.bbUpper))
    ctx.lineTo(W, toY(indicators.bbUpper))
    ctx.lineTo(W, toY(indicators.bbLower))
    ctx.lineTo(0, toY(indicators.bbLower))
    ctx.fill()
  }

  // SMA slow
  if (indicators.smaSlow) {
    ctx.strokeStyle = '#f7768e80'
    ctx.lineWidth = 1
    ctx.setLineDash([4,4])
    const y = toY(indicators.smaSlow)
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    ctx.setLineDash([])
  }

  // SMA fast
  if (indicators.smaFast) {
    ctx.strokeStyle = '#9ece6a80'
    ctx.lineWidth = 1
    ctx.setLineDash([2,2])
    const y = toY(indicators.smaFast)
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    ctx.setLineDash([])
  }

  // Price line
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  prices.forEach((p, i) => {
    const x = i * xStep, y = toY(p)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.stroke()

  // Price labels
  ctx.fillStyle = '#888'
  ctx.font = '10px monospace'
  ctx.fillText(max.toPrecision(6), 4, 12)
  ctx.fillText(min.toPrecision(6), 4, H - 2)
  ctx.fillText(prices[prices.length-1].toPrecision(6), W - 70, 12)
}

function sigColor(v) {
  if (v > 0.3) return '#9ece6a'
  if (v < -0.3) return '#f7768e'
  return '#e0af68'
}

async function update() {
  try {
    const r = await fetch('/api/state')
    const d = await r.json()

    // Status
    const s = $('status')
    if (d.drawdownHalted) { s.textContent = 'HALTED (DRAWDOWN)'; s.className = 'status halt' }
    else if (d.running) { s.textContent = 'RUNNING'; s.className = 'status on' }
    else { s.textContent = 'STOPPED'; s.className = 'status off' }

    // Balances
    $('vETH').textContent = d.ethBalance.toFixed(6)
    $('vWETH').textContent = d.wethBalance.toFixed(6)
    $('vLINK').textContent = d.linkBalance.toFixed(4)
    $('vUSDC').textContent = d.usdcBalance.toFixed(2)
    $('vTotal').textContent = '$' + d.portfolioUSD.toFixed(2)
    $('vDD').textContent = (d.currentDrawdown * 100).toFixed(1) + '%'
    $('vDD').className = 'val ' + (d.currentDrawdown > 0.1 ? 'red' : d.currentDrawdown > 0.05 ? 'yel' : 'grn')

    // Portfolio pie
    const total = d.portfolioUSD || 1
    const eP = ((d.ethBalance * d.ethPrice) / total * 100)
    const wP = ((d.wethBalance * d.ethPrice) / total * 100)
    const lP = ((d.linkBalance * d.linkPrice) / total * 100)
    const uP = (d.usdcBalance / total * 100)
    $('pie').innerHTML =
      '<div class="pie-eth" style="width:'+eP+'%"></div>' +
      '<div class="pie-weth" style="width:'+wP+'%"></div>' +
      '<div class="pie-link" style="width:'+lP+'%"></div>' +
      '<div class="pie-usdc" style="width:'+uP+'%"></div>'

    // Prices & indicators
    $('pETH').textContent = '$' + d.ethPrice.toFixed(2)
    $('pLINK').textContent = '$' + d.linkPrice.toFixed(6)
    $('smaETH').textContent = d.indicators.eth.smaFast.toFixed(2) + ' / ' + d.indicators.eth.smaSlow.toFixed(2)
    $('rsiETH').textContent = d.indicators.eth.rsi.toFixed(1)
    $('rsiETH').className = 'val ' + (d.indicators.eth.rsi > 70 ? 'red' : d.indicators.eth.rsi < 30 ? 'grn' : 'wht')
    $('macdETH').textContent = d.indicators.eth.macdHist.toFixed(4)
    $('bbETH').textContent = (d.indicators.eth.bbPctB * 100).toFixed(1) + '%'

    $('smaLINK').textContent = d.indicators.link.smaFast.toFixed(6) + ' / ' + d.indicators.link.smaSlow.toFixed(6)
    $('rsiLINK').textContent = d.indicators.link.rsi.toFixed(1)
    $('rsiLINK').className = 'val ' + (d.indicators.link.rsi > 70 ? 'red' : d.indicators.link.rsi < 30 ? 'grn' : 'wht')
    $('macdLINK').textContent = d.indicators.link.macdHist.toFixed(6)
    $('bbLINK').textContent = (d.indicators.link.bbPctB * 100).toFixed(1) + '%'

    // Signals
    const eS = d.signals.eth, lS = d.signals.link
    $('sigETH').textContent = (eS>0?'+':'') + eS.toFixed(3)
    $('sigETH').style.color = sigColor(eS)
    $('sigBarETH').style.width = ((eS+1)/2*100)+'%'
    $('sigBarETH').style.background = sigColor(eS)

    $('sigLINK').textContent = (lS>0?'+':'') + lS.toFixed(3)
    $('sigLINK').style.color = sigColor(lS)
    $('sigBarLINK').style.width = ((lS+1)/2*100)+'%'
    $('sigBarLINK').style.background = sigColor(lS)

    // Stats
    $('vTrades').textContent = d.tradesExecuted
    $('vBlock').textContent = d.lastBlock
    $('vGas').textContent = d.gasGwei + ' gwei'
    $('vSamples').textContent = d.ethPriceHistory.length + ' / ' + d.config.smaSlow
    $('vWallet').textContent = d.wallet.slice(0,8) + '...' + d.wallet.slice(-6)

    // Charts
    drawChart('chartETH', d.ethPriceHistory, d.indicators.eth, '#e0af68')
    drawChart('chartLINK', d.linkPriceHistory, d.indicators.link, '#9ece6a')

    // Trade log
    if (d.tradeHistory.length > 0) {
      $('tradeLog').innerHTML = d.tradeHistory.slice().reverse().map(t =>
        '<div class="trade-item">' +
        '<span class="wht">' + new Date(t.time).toLocaleTimeString() + '</span> ' +
        '<span class="blu">' + t.type + '</span> ' +
        t.amountIn.toFixed(4) + ' ' + t.from + ' → ' + t.to +
        ' <span class="wht">blk ' + t.block + '</span></div>'
      ).join('')
    }
  } catch(e) { console.error('Update error:', e) }
}

function ctl(action) {
  fetch('/api/control', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action})})
  setTimeout(update, 300)
}

function toggleCfg() {
  const p = $('cfgPanel')
  p.style.display = p.style.display === 'none' ? 'block' : 'none'
}

function saveCfg() {
  fetch('/api/config', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
    minTradeETH: +$('cfgMinTrade').value,
    gasReserveETH: +$('cfgGasReserve').value,
    slippageBps: +$('cfgSlippage').value,
    maxPositionPct: $('cfgMaxPos').value / 100,
    maxDrawdownPct: $('cfgMaxDD').value / 100,
    cooldownBlocks: +$('cfgCooldown').value,
    minConfluence: +$('cfgMinConf').value,
    maxTradesPerHour: +$('cfgMaxTrades').value,
  })})
  toggleCfg()
}

setInterval(update, 2000)
update()
</script></body></html>`

// ══════════════════════════════════════════
//  STARTUP
// ══════════════════════════════════════════

async function start() {
  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║   AUTONOMOUS TRADING BOT - ETH SEPOLIA   ║')
  console.log('╚══════════════════════════════════════════╝')
  console.log(`Wallet: ${account.address}`)
  console.log(`WETH/USDC Pool: ${ADDR.POOL_WETH_USDC}`)
  console.log(`LINK/USDC Pool: ${ADDR.POOL_LINK_USDC}`)
  console.log(`Router: ${ADDR.ROUTER}`)

  // Initial data fetch
  await updateBalances()
  await fetchPrices()
  log(`ETH: ${state.ethBalance.toFixed(4)} | WETH: ${state.wethBalance.toFixed(4)} | LINK: ${state.linkBalance.toFixed(2)} | USDC: ${state.usdcBalance.toFixed(2)}`)
  log(`ETH Price: $${state.ethPrice.toFixed(2)} | LINK Price: $${state.linkPrice.toFixed(6)}`)

  // Start main loop
  setInterval(mainLoop, CONFIG.priceUpdateInterval)
  mainLoop()

  // Start dashboard
  app.listen(CONFIG.port, () => {
    console.log(`\n📊 Dashboard: http://localhost:${CONFIG.port}`)
    console.log('Press START on dashboard to begin trading\n')
  })
}

start().catch(e => { console.error('Fatal:', e); process.exit(1) })
