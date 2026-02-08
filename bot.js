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

    const link = await publicClient.readContract({
      address: LINK,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address]
    })
    console.log(`LINK: ${formatEther(link)}\n`)
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

async function swapWETHforLINK(amountWeth) {
  try {
    console.log(`\n💱 Swapping ${amountWeth} WETH for LINK on Ethereum Sepolia...`)

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

    // Execute V3 swap
    console.log(`⏳ Executing swap on Uniswap V3...`)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20)
    const amountInWei = parseEther(amountWeth.toString())

    const tx = await walletClient.writeContract({
      address: UNISWAP_V3_ROUTER,
      abi: UNISWAP_V3_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn: WETH,
        tokenOut: LINK,
        fee: 3000n, // 0.3% fee tier
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

  // Monitor balances at every block
  let lastBlock = 0
  const checkBalances = async () => {
    const currentBlock = await publicClient.getBlockNumber()

    if (currentBlock > lastBlock) {
      lastBlock = Number(currentBlock)
      const bal = await publicClient.getBalance({ address: account.address })
      const wethBal = await publicClient.readContract({
        address: WETH,
        abi: WETH_ABI,
        functionName: 'balanceOf',
        args: [account.address]
      })
      const linkBal = await publicClient.readContract({
        address: LINK,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address]
      })

      console.log(`[Block ${lastBlock}] ETH: ${formatEther(bal)} | WETH: ${formatEther(wethBal)} | LINK: ${formatEther(linkBal)}`)
    }

    setTimeout(checkBalances, 1000)
  }

  checkBalances()
}

// Handle command line args
const args = process.argv.slice(2)
if (args[0] === 'wrap' && args[1]) {
  const amount = parseFloat(args[1])
  wrapETH(amount).then(() => run())
} else if (args[0] === 'swap' && args[1]) {
  const amount = parseFloat(args[1])
  swapWETHforLINK(amount).then(() => run())
} else {
  console.log('\nUsage:')
  console.log('  node bot.js            - Start monitoring balances (updates per block)')
  console.log('  node bot.js wrap NUM   - Wrap ETH to WETH')
  console.log('  node bot.js swap NUM   - Swap WETH for LINK on Uniswap V3\n')
  run()
}
