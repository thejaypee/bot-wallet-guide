import 'dotenv/config'
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`)
const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.RPC_URL) })
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(process.env.RPC_URL) })

// Ethereum Sepolia addresses
const WETH = '0xfFf9976782d46CC05630D1f6eBAb6204F0990080'.toLowerCase()
const LINK = '0x779877A7B0D9C06BeA21cd42eb15DaFF404C0b37'.toLowerCase()
const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'.toLowerCase()

const WETH_ABI = [
  { name: 'deposit', inputs: [], outputs: [], stateMutability: 'payable', type: 'function' },
  { name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { name: 'withdraw', inputs: [{ name: 'wad', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' }
]

const ERC20_ABI = [
  { name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }
]

const UNISWAP_V3_ROUTER_ABI = [
  {
    name: 'exactInputSingle',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'recipient', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' }
      ]
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function'
  }
]

// Trading state
const state = {
  ethBalance: 0n,
  wethBalance: 0n,
  linkBalance: 0n,
  priceHistory: [],
  lastBlock: 0,
  tradesExecuted: 0,
  totalPNL: 0
}

// Trading configuration
const CONFIG = {
  minTradeAmount: 0.01, // Minimum ETH to wrap
  gasReserve: 0.02, // Keep 0.02 ETH for gas
  rebalanceThreshold: 0.5, // Rebalance if portfolio ratio drifts 50%
  volatilityWindow: 20, // Number of prices to track for volatility
  volatilityThreshold: 0.05, // 5% volatility to trigger rebalance
}

async function updateBalances() {
  try {
    const eth = await publicClient.getBalance({ address: account.address })

    let weth = 0n, link = 0n

    try {
      weth = await publicClient.readContract({
        address: WETH,
        abi: WETH_ABI,
        functionName: 'balanceOf',
        args: [account.address]
      })
    } catch (e) {
      // WETH reading failed, set to 0
      weth = 0n
    }

    try {
      link = await publicClient.readContract({
        address: LINK,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address]
      })
    } catch (e) {
      // LINK reading failed, set to 0
      link = 0n
    }

    state.ethBalance = eth
    state.wethBalance = weth
    state.linkBalance = link

    return {
      eth: parseFloat(formatEther(eth)),
      weth: parseFloat(formatEther(weth)),
      link: parseFloat(formatEther(link))
    }
  } catch (e) {
    console.error(`[ERROR] updateBalances: ${e.message.split('\n')[0]}`)
    return { eth: 0, weth: 0, link: 0 }
  }
}

async function getPrice() {
  // Simulate price based on balance ratio (simple market price indicator)
  const wethAmount = parseFloat(formatEther(state.wethBalance))
  const linkAmount = parseFloat(formatEther(state.linkBalance))

  if (wethAmount === 0) return 1.0 // Default: 1 WETH = 1 LINK
  return linkAmount / wethAmount
}

function calculateVolatility() {
  if (state.priceHistory.length < 2) return 0

  const prices = state.priceHistory.slice(-CONFIG.volatilityWindow)
  const mean = prices.reduce((a, b) => a + b) / prices.length
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length
  return Math.sqrt(variance) / mean
}

async function shouldRebalance() {
  const balances = await updateBalances()
  const volatility = calculateVolatility()

  console.log(`[INFO] Volatility: ${(volatility * 100).toFixed(2)}% | ETH: ${balances.eth.toFixed(4)} | WETH: ${balances.weth.toFixed(4)} | LINK: ${balances.link.toFixed(2)}`)

  // Rebalance if: high volatility OR portfolio heavily skewed to one asset
  if (volatility > CONFIG.volatilityThreshold) {
    console.log(`⚡ High volatility detected (${(volatility * 100).toFixed(2)}%)`)
    return true
  }

  // Check if portfolio is imbalanced (e.g., all in LINK, no WETH)
  const totalValue = balances.weth + balances.link // Rough approximation
  if (totalValue > 0) {
    const linkRatio = balances.link / totalValue
    if (linkRatio > 0.95 || linkRatio < 0.05) {
      console.log(`⚖️ Portfolio imbalanced (LINK ratio: ${(linkRatio * 100).toFixed(1)}%)`)
      return true
    }
  }

  return false
}

async function autoWrapETH() {
  const balances = await updateBalances()
  const availableETH = balances.eth - CONFIG.gasReserve

  if (availableETH > CONFIG.minTradeAmount && balances.weth < 0.01) {
    try {
      console.log(`\n🔄 [AUTO] Wrapping ${availableETH.toFixed(4)} ETH to WETH...`)
      const tx = await walletClient.writeContract({
        address: WETH,
        abi: WETH_ABI,
        functionName: 'deposit',
        value: parseEther(availableETH.toString())
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      console.log(`✅ [DONE] Wrapped! TX: ${tx}`)
      state.tradesExecuted++
      return true
    } catch (e) {
      console.error(`❌ Wrap failed: ${e.message.split('\n')[0]}`)
      return false
    }
  }
  return false
}

async function autoSwapWETH() {
  const balances = await updateBalances()

  if (balances.weth < 0.001) return false

  try {
    console.log(`\n💱 [AUTO] Swapping ${balances.weth.toFixed(4)} WETH for LINK...`)

    // Approve
    await walletClient.writeContract({
      address: WETH,
      abi: WETH_ABI,
      functionName: 'approve',
      args: [UNISWAP_V3_ROUTER, state.wethBalance]
    })

    // Swap
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20)
    const tx = await walletClient.writeContract({
      address: UNISWAP_V3_ROUTER,
      abi: UNISWAP_V3_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn: WETH,
        tokenOut: LINK,
        fee: 3000n,
        recipient: account.address,
        deadline: deadline,
        amountIn: state.wethBalance,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n
      }]
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
    console.log(`✅ [DONE] Swapped! TX: ${tx}`)
    state.tradesExecuted++
    return true
  } catch (e) {
    console.error(`❌ Swap failed: ${e.message.split('\n')[0]}`)
    return false
  }
}

async function runBot() {
  console.log('\n🤖 AUTONOMOUS TRADING BOT STARTED')
  console.log(`📍 ${account.address}`)
  console.log(`🔗 Ethereum Sepolia | Uniswap V3\n`)

  const balances = await updateBalances()
  console.log(`Initial portfolio:`)
  console.log(`  ETH: ${balances.eth.toFixed(4)}`)
  console.log(`  WETH: ${balances.weth.toFixed(4)}`)
  console.log(`  LINK: ${balances.link.toFixed(2)}\n`)

  let blockCount = 0
  const checkAndTrade = async () => {
    try {
      const currentBlock = await publicClient.getBlockNumber()

      if (Number(currentBlock) > state.lastBlock) {
        state.lastBlock = Number(currentBlock)
        blockCount++

        const price = await getPrice()
        state.priceHistory.push(price)

        // Keep history bounded
        if (state.priceHistory.length > CONFIG.volatilityWindow * 2) {
          state.priceHistory.shift()
        }

        // Periodic status update
        if (blockCount % 5 === 0) {
          console.log(`\n[Block ${state.lastBlock}] Monitoring... (${state.tradesExecuted} trades executed)`)

          // Check if rebalancing needed
          if (await shouldRebalance()) {
            console.log(`\n🎯 Trading signal: REBALANCE PORTFOLIO`)

            const balances = await updateBalances()

            // If mostly LINK, wrap and swap
            if (balances.weth < 0.001 && balances.eth > CONFIG.gasReserve + CONFIG.minTradeAmount) {
              await autoWrapETH()
            }

            // If have WETH, swap it
            if (balances.weth > 0.001) {
              await autoSwapWETH()
            }
          }
        }
      }

      setTimeout(checkAndTrade, 1000)
    } catch (e) {
      console.error(`[ERROR] ${e.message}`)
      setTimeout(checkAndTrade, 5000)
    }
  }

  checkAndTrade()
}

// Start the bot
runBot().catch(console.error)
