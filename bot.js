import 'dotenv/config'
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`)
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL) })
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.RPC_URL) })

// Base Sepolia WETH
const WETH = '0x4200000000000000000000000000000000000006'

const WETH_ABI = [
  { name: 'deposit', inputs: [], outputs: [], stateMutability: 'payable', type: 'function' },
  { name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { name: 'withdraw', inputs: [{ name: 'wad', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable', type: 'function' }
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
    console.log(`WETH: ${formatEther(weth)}\n`)
  } catch (e) {
    console.log(`Error reading WETH\n`)
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

    if (count % 10 === 0) {
      console.log(`[${count}] ETH: ${formatEther(bal)} | WETH: ${formatEther(wethBal)}`)
    }
  }, 5000)
}

// Handle command line args
const args = process.argv.slice(2)
if (args[0] === 'wrap' && args[1]) {
  const amount = parseFloat(args[1])
  wrapETH(amount).then(() => run())
} else {
  run()
}
