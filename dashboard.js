import 'dotenv/config'
import express from 'express'
import { createPublicClient, http, formatEther } from 'viem'
import { sepolia } from 'viem/chains'

const app = express()
const PORT = 3000

app.use(express.json())

const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.RPC_URL) })
const WETH = '0xfFf9976782d46CC05630D1f6eBAb6204F0990080'.toLowerCase()
const LINK = '0x779877A7B0D9E8603169DdbD7836e478b4624789'.toLowerCase()
const WALLET = '0xF86DcFC45532697ABE3ef2AfdAa20CAC44f86B8F'

const ERC20_ABI = [
  { name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }
]

// Shared state with bot
let botState = {
  isRunning: false,
  ethBalance: 0,
  wethBalance: 0,
  linkBalance: 0,
  tradesExecuted: 0,
  lastBlock: 0,
  totalPNL: 0,
  volatility: 0,
  priceHistory: [],
  config: {
    minTradeAmount: 0.01,
    gasReserve: 0.02,
    volatilityThreshold: 0.05,
    enabled: true
  }
}

async function updateStats() {
  try {
    const eth = await publicClient.getBalance({ address: WALLET })

    let weth = 0n, link = 0n

    try {
      weth = await publicClient.readContract({
        address: WETH,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [WALLET]
      })
    } catch (e) {
      // Failed
    }

    try {
      link = await publicClient.readContract({
        address: LINK,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [WALLET]
      })
    } catch (e) {
      // Failed
    }

    botState.ethBalance = parseFloat(formatEther(eth))
    botState.wethBalance = parseFloat(formatEther(weth))
    botState.linkBalance = parseFloat(formatEther(link))
  } catch (e) {
    console.error(`Update error: ${e.message}`)
  }
}

// HTML Dashboard
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Autonomous Trading Bot</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Monaco', 'Menlo', monospace;
          background: linear-gradient(135deg, #0a0e27 0%, #1a1f3a 100%);
          color: #00ff00;
          padding: 20px;
          min-height: 100vh;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { text-align: center; color: #00ff88; margin-bottom: 30px; font-size: 2.5em; }

        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }

        .card {
          background: #1a1f3a;
          padding: 20px;
          border-radius: 8px;
          border-left: 3px solid #00ff88;
          box-shadow: 0 0 20px rgba(0,255,136,0.1);
        }

        .card h2 { color: #00ccff; margin-bottom: 15px; font-size: 1.2em; }

        .stat-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #333;
        }
        .stat-label { color: #00ccff; }
        .stat-value { color: #00ff00; font-weight: bold; }

        .status {
          padding: 10px;
          border-radius: 4px;
          margin-bottom: 10px;
          text-align: center;
          font-weight: bold;
        }
        .status.running { background: #1a3a1a; color: #00ff00; border: 1px solid #00ff00; }
        .status.stopped { background: #3a1a1a; color: #ff4444; border: 1px solid #ff4444; }

        .controls {
          display: flex;
          gap: 10px;
          margin-top: 15px;
          flex-wrap: wrap;
        }

        button {
          flex: 1;
          min-width: 100px;
          padding: 10px 15px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-family: monospace;
          font-weight: bold;
          transition: all 0.3s;
        }

        .btn-start {
          background: #00ff00;
          color: #000;
        }
        .btn-start:hover { background: #00dd00; }

        .btn-stop {
          background: #ff4444;
          color: #fff;
        }
        .btn-stop:hover { background: #ff2222; }

        .btn-config {
          background: #00ccff;
          color: #000;
        }
        .btn-config:hover { background: #00aadd; }

        .input-group {
          margin: 10px 0;
          display: flex;
          gap: 10px;
          align-items: center;
        }

        input {
          background: #0a0e27;
          border: 1px solid #00ff88;
          color: #00ff00;
          padding: 8px;
          border-radius: 4px;
          font-family: monospace;
          width: 120px;
        }

        .alert {
          background: #1a2a1a;
          padding: 10px;
          border-left: 3px solid #00ff00;
          margin: 10px 0;
          border-radius: 4px;
        }

        .trades-list {
          max-height: 200px;
          overflow-y: auto;
          font-size: 0.9em;
          margin-top: 10px;
        }

        .trade-item {
          padding: 8px;
          border-bottom: 1px solid #333;
          color: #00dd00;
        }

        .portfolio-pie {
          display: flex;
          height: 20px;
          border-radius: 10px;
          overflow: hidden;
          margin: 10px 0;
          box-shadow: 0 0 10px rgba(0,255,136,0.2);
        }

        .pie-eth { background: #ff9500; }
        .pie-weth { background: #00ccff; }
        .pie-link { background: #00ff88; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 AUTONOMOUS TRADING BOT</h1>

        <div class="grid">
          <!-- Status & Controls -->
          <div class="card">
            <h2>⚙️ Control Center</h2>
            <div class="status" id="status">Checking...</div>
            <div class="controls">
              <button class="btn-start" onclick="startBot()">▶️ START</button>
              <button class="btn-stop" onclick="stopBot()">⏹️ STOP</button>
              <button class="btn-config" onclick="showConfig()">⚙️ CONFIG</button>
            </div>
            <div id="configPanel" style="display:none; margin-top: 15px;">
              <div class="input-group">
                <label>Min Trade:</label>
                <input type="number" id="minTrade" value="0.01" step="0.001">
              </div>
              <div class="input-group">
                <label>Gas Reserve:</label>
                <input type="number" id="gasReserve" value="0.02" step="0.001">
              </div>
              <div class="input-group">
                <label>Volatility:</label>
                <input type="number" id="volatility" value="0.05" step="0.01">
              </div>
              <button class="btn-config" onclick="saveConfig()">💾 SAVE</button>
            </div>
          </div>

          <!-- Portfolio -->
          <div class="card">
            <h2>💼 Portfolio</h2>
            <div class="stat-row">
              <span class="stat-label">ETH:</span>
              <span class="stat-value" id="ethVal">0.0000</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">WETH:</span>
              <span class="stat-value" id="wethVal">0.0000</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">LINK:</span>
              <span class="stat-value" id="linkVal">0.0000</span>
            </div>
            <div class="portfolio-pie" id="pie"></div>
            <div class="stat-row" style="margin-top: 10px;">
              <span class="stat-label">Total Value:</span>
              <span class="stat-value" id="totalVal">0.0000</span>
            </div>
          </div>
        </div>

        <div class="grid">
          <!-- Stats -->
          <div class="card">
            <h2>📊 Trading Stats</h2>
            <div class="stat-row">
              <span class="stat-label">Trades Executed:</span>
              <span class="stat-value" id="trades">0</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Last Block:</span>
              <span class="stat-value" id="block">--</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Volatility:</span>
              <span class="stat-value" id="vol">0.00%</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">P&L:</span>
              <span class="stat-value" id="pnl">+0.0000</span>
            </div>
          </div>

          <!-- Network -->
          <div class="card">
            <h2>🔗 Network</h2>
            <div class="stat-row">
              <span class="stat-label">Chain:</span>
              <span class="stat-value">Ethereum Sepolia</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Router:</span>
              <span class="stat-value">Uniswap V3</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">RPC:</span>
              <span class="stat-value">drpc.org</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Wallet:</span>
              <span class="stat-value" style="font-size: 0.9em;">0xF86D...86B8F</span>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>📈 Activity Log</h2>
          <div class="trades-list" id="tradesList">
            <div class="trade-item">Monitoring started...</div>
          </div>
        </div>

        <div class="alert">
          ✅ Bot Dashboard Active | 🔄 Auto-refresh: 2 seconds | 🎯 Autonomous Trading Enabled
        </div>
      </div>

      <script>
        async function updateDashboard() {
          try {
            const res = await fetch('/api/stats')
            const data = await res.json()

            // Update stats
            document.getElementById('ethVal').textContent = data.ethBalance.toFixed(4)
            document.getElementById('wethVal').textContent = data.wethBalance.toFixed(4)
            document.getElementById('linkVal').textContent = data.linkBalance.toFixed(4)
            document.getElementById('trades').textContent = data.tradesExecuted
            document.getElementById('block').textContent = data.lastBlock || '--'
            document.getElementById('vol').textContent = (data.volatility * 100).toFixed(2) + '%'
            document.getElementById('pnl').textContent = (data.totalPNL > 0 ? '+' : '') + data.totalPNL.toFixed(4)

            // Portfolio pie
            const total = data.ethBalance + data.wethBalance + data.linkBalance
            const ethPct = total > 0 ? (data.ethBalance / total * 100) : 33.33
            const wethPct = total > 0 ? (data.wethBalance / total * 100) : 33.33
            const linkPct = total > 0 ? (data.linkBalance / total * 100) : 33.34

            document.getElementById('pie').innerHTML = \`
              <div class="pie-eth" style="width: \${ethPct}%"></div>
              <div class="pie-weth" style="width: \${wethPct}%"></div>
              <div class="pie-link" style="width: \${linkPct}%"></div>
            \`

            document.getElementById('totalVal').textContent = total.toFixed(4)

            // Status
            const status = document.getElementById('status')
            if (data.isRunning) {
              status.textContent = '🟢 RUNNING'
              status.className = 'status running'
            } else {
              status.textContent = '🔴 STOPPED'
              status.className = 'status stopped'
            }
          } catch (e) {
            console.error('Update failed:', e)
          }
        }

        function startBot() {
          fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) })
          updateDashboard()
        }

        function stopBot() {
          fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) })
          updateDashboard()
        }

        function showConfig() {
          const panel = document.getElementById('configPanel')
          panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
        }

        function saveConfig() {
          const config = {
            minTradeAmount: parseFloat(document.getElementById('minTrade').value),
            gasReserve: parseFloat(document.getElementById('gasReserve').value),
            volatilityThreshold: parseFloat(document.getElementById('volatility').value)
          }
          fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
          showConfig()
        }

        // Auto-refresh
        setInterval(updateDashboard, 2000)
        updateDashboard()
      </script>
    </body>
    </html>
  `)
})

// API Routes
app.get('/api/stats', (req, res) => {
  try {
    res.json(botState)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/control', (req, res) => {
  const { action } = req.body
  if (action === 'start') {
    botState.isRunning = true
    res.json({ status: 'started' })
  } else if (action === 'stop') {
    botState.isRunning = false
    res.json({ status: 'stopped' })
  } else {
    res.status(400).json({ error: 'Invalid action' })
  }
})

app.post('/api/config', (req, res) => {
  botState.config = { ...botState.config, ...req.body, enabled: true }
  res.json({ config: botState.config })
})

// Update stats periodically
setInterval(updateStats, 5000)

app.listen(PORT, async () => {
  console.log(`📊 Dashboard: http://localhost:${PORT}`)
  await updateStats()
})

// Export state for bot access
export { botState }
