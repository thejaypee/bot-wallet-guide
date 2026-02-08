import 'dotenv/config'
import express from 'express'
import { createPublicClient, http, formatEther } from 'viem'
import { baseSepolia } from 'viem/chains'

const app = express()
const PORT = 3000

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL) })
const WETH = '0x4200000000000000000000000000000000000006'
const LINK = '0xE4aB69C077896252FAFBD49EFD26B5D171A32410'
const WALLET = '0xF86DcFC45532697ABE3ef2AfdAa20CAC44f86B8F'

const ERC20_ABI = [
  { name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }
]

let stats = { eth: 0, weth: 0, link: 0, block: 0 }

async function updateStats() {
  try {
    const eth = await publicClient.getBalance({ address: WALLET })
    const weth = await publicClient.readContract({
      address: WETH,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [WALLET]
    })
    const link = await publicClient.readContract({
      address: LINK,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [WALLET]
    })
    const block = await publicClient.getBlockNumber()

    stats = {
      eth: parseFloat(formatEther(eth)),
      weth: parseFloat(formatEther(weth)),
      link: parseFloat(formatEther(link)),
      block: Number(block)
    }
  } catch (e) {
    console.error(`Update error: ${e.message}`)
  }
}

app.get('/', (req, res) => {
  const now = new Date().toLocaleTimeString()
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Base Sepolia Trading Bot</title>
      <style>
        body { font-family: monospace; background: #0a0e27; color: #00ff00; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        h1 { text-align: center; color: #00ff88; }
        .stats { background: #1a1f3a; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .stat-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #333; }
        .stat-label { color: #00ccff; }
        .stat-value { color: #00ff00; font-weight: bold; font-size: 16px; }
        .alert { background: #1a2a1a; padding: 10px; border-left: 3px solid #00ff00; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 BASE SEPOLIA TRADING BOT</h1>
        <div class="stats">
          <div class="stat-row">
            <span class="stat-label">ETH:</span>
            <span class="stat-value" id="eth">${stats.eth.toFixed(6)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">WETH:</span>
            <span class="stat-value" id="weth">${stats.weth.toFixed(6)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">LINK:</span>
            <span class="stat-value" id="link">${stats.link.toFixed(6)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Block:</span>
            <span class="stat-value" id="block">${stats.block}</span>
          </div>
        </div>

        <div class="alert">
          ✅ Bot ready at /home/sauly/trading-bot<br>
          🔄 Auto-refresh: 5 seconds<br>
          ⚙️ API: http://localhost:3000/api/stats
        </div>
      </div>

      <script>
        function refresh() {
          fetch('/api/stats')
            .then(r => r.json())
            .then(d => {
              document.getElementById('eth').textContent = d.eth.toFixed(6)
              document.getElementById('weth').textContent = d.weth.toFixed(6)
              document.getElementById('link').textContent = d.link.toFixed(6)
              document.getElementById('block').textContent = d.block
            })
        }
        setInterval(refresh, 5000)
      </script>
    </body>
    </html>
  `)
})

app.get('/api/stats', (req, res) => {
  try {
    res.json({
      eth: stats.eth,
      weth: stats.weth,
      link: stats.link,
      block: stats.block,
      timestamp: new Date().toISOString()
    })
  } catch (e) {
    console.error(`API error: ${e.message}`)
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, async () => {
  console.log(`📊 Dashboard: http://localhost:${PORT}`)
  await updateStats()
  setInterval(updateStats, 5000)
})
