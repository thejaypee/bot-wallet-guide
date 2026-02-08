import 'dotenv/config'
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`)
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL) })
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.RPC_URL) })

// Base Sepolia addresses
const WETH = '0x4200000000000000000000000000000000000006'
const USDC = '0x07865c6E87B9F70255377e024ace6630C1Eaa37F' // Using standard test USDC
const UNISWAP_V3_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481'

const WETH_ABI = [
  { name: 'deposit', inputs: [], outputs: [], stateMutability: 'payable', type: 'function' },
  { name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { name: 'withdraw', inputs: [{ name: 'wad', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' }
]

const ERC20_ABI = [
  { name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }
]

const UNISWAP_ROUTER_ABI = [
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

async function init() {
  const block = await publicClient.getBlockNumber()
  const eth = await publicClient.getBalance({ address: account.address })

  console.log('\n🤖 BASE SEPOLIA TRADING BOT')
  console.log(`📍 ${account.address}`)
  console.log(`💰 ETH: ${formatEther(eth)}`)
  console.log(`Block: ${block}\n`)

  try {
    const weth = await publicClient.readContract({
      address: WETH,
      abi: WETH_ABI,
      functionName: 'balanceOf',
      args: [account.address]
    })
    console.log(`WETH: ${formatEther(weth)}`)

    const usdc = await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address]
    })
    console.log(`USDC: ${(Number(usdc) / 1e6).toFixed(6)}\n`)
  } catch (e) {
    console.log(`Error reading balances\n`)
  }
}

async function wrapETH(amountEth) {
  try {
    console.log(`\n💱 Wrapping ${amountEth} ETH to WETH...`)
    const tx = await walletClient.writeContract({
      address: WETH,
      abi: WETH_ABI,
      functionName: 'deposit',
      value: parseEther(amountEth.toString())
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
    console.log(`✅ Wrapped! TX: ${tx}`)
    console.log(`Block: ${receipt.blockNumber}\n`)
    return true
  } catch (e) {
    console.error(`❌ Wrap failed: ${e.message.split('\n')[0]}`)
    return false
  }
}

async function swapWETHforUSDC(amountWeth) {
  try {
    console.log(`\n💱 Swapping ${amountWeth} WETH for USDC on Uniswap V3...`)

    // Approve WETH spending
    console.log(`⏳ Approving WETH...`)
    const approveTx = await walletClient.writeContract({
      address: WETH,
      abi: WETH_ABI,
      functionName: 'approve',
      args: [UNISWAP_V3_ROUTER, parseEther(amountWeth.toString())]
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
    console.log(`✅ Approved\n`)

    // Execute swap
    console.log(`⏳ Executing swap on Uniswap V3...`)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20)
    const amountInWei = parseEther(amountWeth.toString())

    const tx = await walletClient.writeContract({
      address: UNISWAP_V3_ROUTER,
      abi: UNISWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn: WETH,
        tokenOut: USDC,
        fee: 3000n,
        recipient: account.address,
        deadline: deadline,
        amountIn: amountInWei,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n
      }]
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
    console.log(`✅ Swapped! TX: ${tx}`)
    console.log(`Block: ${receipt.blockNumber}\n`)
    return true
  } catch (e) {
    console.error(`❌ Swap failed: ${e.message.split('\n')[0]}`)
    return false
  }
}

async function run() {
  await init()

  const eth = await publicClient.getBalance({ address: account.address })
  const ethAmount = parseFloat(formatEther(eth))

  if (ethAmount > 0.01) {
    console.log(`✅ Ready. Gas reserve: ${ethAmount.toFixed(6)} ETH\n`)
    console.log(`When ready to trade:`)
    console.log(`  node bot.js wrap 0.01   (wrap 0.01 ETH to WETH, keep rest for gas)\n`)
  } else {
    console.log(`⚠️  Low ETH (${ethAmount.toFixed(6)} ETH)\n`)
  }

  // Just keep monitoring
  let count = 0
  setInterval(async () => {
    count++
    const bal = await publicClient.getBalance({ address: account.address })
    const wethBal = await publicClient.readContract({
      address: WETH,
      abi: WETH_ABI,
      functionName: 'balanceOf',
      args: [account.address]
    })
    const usdcBal = await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address]
    })

    if (count % 10 === 0) {
      console.log(`[${count}] ETH: ${formatEther(bal)} | WETH: ${formatEther(wethBal)} | USDC: ${(Number(usdcBal) / 1e6).toFixed(6)}`)
    }
  }, 5000)
}

// Handle command line args
const args = process.argv.slice(2)
if (args[0] === 'wrap' && args[1]) {
  const amount = parseFloat(args[1])
  wrapETH(amount).then(() => run())
} else if (args[0] === 'swap' && args[1]) {
  const amount = parseFloat(args[1])
  swapWETHforUSDC(amount).then(() => run())
} else {
  console.log('\nUsage:')
  console.log('  node bot.js            - Start monitoring')
  console.log('  node bot.js wrap NUM   - Wrap ETH to WETH')
  console.log('  node bot.js swap NUM   - Swap WETH for USDC on Uniswap V3\n')
  run()
}
