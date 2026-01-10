# Polymarket Copy Trading Bot

A **real-time copy trading bot** for **Polymarket** that monitors a target wallet and mirrors its trades from your proxy wallet, with basic risk controls and persistence via MongoDB. Built with **TypeScript** on **Node.js**, and executes via Polymarket’s **Central Limit Order Book (CLOB)** API.

---

## Support the Project

If you find this bot helpful and profitable, I am really appreciate your support! Consider sending 11% of your profits to help maintain and improve this project:

**Wallet Address:** `DXxfenpMYgSngc7vfqQknK6ptUbubUVJRFUBh94Doywa`

---

## Overview

The Polymarket Copy Trading Bot continuously monitors target wallets and replicates their trading activity according to configurable risk parameters. It is designed for **professional deployment**, supporting automated trade execution, precise order handling, and comprehensive logging.

### Core Capabilities

* **Real-Time Trade Monitoring** – Continuously fetches and processes trades from target wallets
* **Automatic Trade Execution** – Mirrors buy/sell/merge operations with intelligent position matching
* **Advanced Risk Management** – Balance-based position sizing and retry mechanisms
* **Flexible Order Execution** – Supports FOK (Fill-or-Kill) order types
* **MongoDB Integration** – Persistent tracking of trades and positions
* **Multi-Outcome Compatibility** – Works seamlessly with binary and multi-outcome markets

---

## Proof of Ownership

The following image demonstrates ownership and control of the trading system:

<img width="1121" height="663" alt="Proof of ownership" src="https://github.com/user-attachments/assets/c10a8253-4198-4316-a52f-7e9e85c9d907" />

---

## Performance (PNL Snapshots)

Selected profit-and-loss snapshots from live trading sessions:

<img width="352" height="222" src="https://github.com/user-attachments/assets/294c51f5-d531-450c-904c-9c19e0184a23" />
<img width="290" height="201" src="https://github.com/user-attachments/assets/2b7633a6-d9f1-43f2-a14d-ba79f9c147b2" />
<img width="351" height="223" src="https://github.com/user-attachments/assets/7b7ad783-98b5-4b10-a0a7-166e90f56589" />\
<img width="442" height="257" src="https://github.com/user-attachments/assets/92674dca-76e8-4591-8b4b-54a7c5d4c39b" />


---

## System Architecture

### Technology Stack

* **Runtime**: Node.js 18+
* **Language**: TypeScript (v5.7+)
* **Blockchain**: Polygon (Ethereum-compatible L2)
* **Web3**: Ethers.js v5
* **Database**: MongoDB
* **APIs**:
  * `@polymarket/clob-client` - Polymarket CLOB trading client
  * Polymarket Data API - For fetching activities and positions
* **Utilities**: Axios, Mongoose, Ora (spinners)

### High-Level Flow

```
Polymarket Data API (HTTP Polling)
        ↓
Trade Monitor (Fetches & Validates Trades)
        ↓
MongoDB (Stores Trade History)
        ↓
Trade Executor (Reads Pending Trades)
        ↓
Position Analysis (Compares Wallets)
        ↓
CLOB Client (Executes Orders)
        ↓
Order Execution (Buy/Sell/Merge Strategies)
```

---

## Quickstart

### Prerequisites

- **Node.js** 18+ (npm included)
- **MongoDB** (local or remote)
- **Polygon wallet** funded with USDC (this bot trades from your proxy wallet)

### Setup Steps

1. **Clone the repository:**
```bash
git clone <repository-url>
cd polymarket-trading-bot
```

2. **Install dependencies:**
```bash
npm install
```

3. **Create environment configuration:**

Copy `env.example` to `.env` and fill in real values:

```bash
# macOS / Linux
cp env.example .env
```

```powershell
# Windows PowerShell
Copy-Item env.example .env
```

Then edit `.env` and set at least:

- `USER_ADDRESS`: wallet to copy
- `PROXY_WALLET`: your wallet that places orders
- `PRIVATE_KEY`: private key for `PROXY_WALLET` (**64 hex chars, no `0x` prefix**)
- `MONGO_URI`: Mongo connection string

4. **Start MongoDB:**
```bash
# Windows
net start MongoDB

# Linux/Mac
sudo systemctl start mongod
# or
mongod
```

5. **(Optional) Validate the repo + env wiring:**

```bash
node validate-bot.js
```

6. **Start the bot:**
```bash
# Development mode (with ts-node)
npm run dev

# Or build and run
npm run build
npm start
```

### Important security note

This bot currently **stores your proxy wallet private key in MongoDB** (see `src/index.ts`). Only run it on machines and databases you fully control, and treat the DB as sensitive as your key.

---

## ⚙️ Configuration Reference

| Variable              | Description                                    | Required |
| --------------------- | ---------------------------------------------- | -------- |
| `USER_ADDRESS`        | Target wallet address to copy trades from      | Yes      |
| `PROXY_WALLET`        | Your wallet address that executes trades       | Yes      |
| `PRIVATE_KEY`         | Your wallet private key (64 hex, no 0x)        | Yes      |
| `CLOB_HTTP_URL`       | Polymarket CLOB HTTP API endpoint              | Yes      |
| `CLOB_WS_URL`         | Polymarket WebSocket endpoint                  | Yes      |
| `MONGO_URI`           | MongoDB connection string                      | Yes      |
| `RPC_URL`             | Polygon RPC endpoint                           | Yes      |
| `USDC_CONTRACT_ADDRESS` | USDC token contract on Polygon              | Yes      |
| `FETCH_INTERVAL`      | Trade monitoring interval (seconds)             | No (default: 1) |
| `TOO_OLD_TIMESTAMP`   | Ignore trades older than X hours                | No (default: 24) |
| `RETRY_LIMIT`         | Maximum retry attempts for failed trades        | No (default: 3) |

---

## Usage

### Start Copy Trading

```bash
npm run dev
```

The bot will:

1. Connect to MongoDB
2. Initialize CLOB client and create/derive API keys
3. Start trade monitor (polls Polymarket Data API every `FETCH_INTERVAL` seconds)
4. Start trade executor (processes pending trades roughly once per second)
5. Monitor target wallet and execute copy trades automatically

### Expected Output

When running successfully, you should see:
```
MongoDB connected
Target User Wallet address is: 0x...
My Wallet address is: 0x...
API Key created/derived
Trade Monitor is running every 1 seconds
Executing Copy Trading
Waiting for new transactions...
```

### Trade Execution Flow

1. **Monitor**: Fetches user activities from Polymarket API
2. **Filter**: Identifies new TRADE type activities
3. **Store**: Saves new trades to MongoDB
4. **Execute**: Reads pending trades and determines action (buy/sell/merge)
5. **Match**: Compares positions between target wallet and your wallet
6. **Trade**: Executes orders via CLOB client
7. **Update**: Marks trades as processed in database

---

## Execution Logic

### Trade Lifecycle

1. **Fetch Activities**: Monitor target wallet via Polymarket Data API
2. **Filter Trades**: Identify TRADE type activities only
3. **Check Duplicates**: Verify trade hasn't been processed before
4. **Validate Timestamp**: Ignore trades older than configured threshold
5. **Save to Database**: Store new trades in MongoDB
6. **Read Pending Trades**: Query database for unprocessed trades
7. **Fetch Positions**: Get current positions for both wallets
8. **Get Balances**: Check USDC balances for both wallets
9. **Determine Condition**: Decide on buy/sell/merge based on positions
10. **Execute Order**: Place order via CLOB client using appropriate strategy
11. **Update Status**: Mark trade as processed in database

### Trading Strategies

* **Buy Strategy**: When target wallet buys, calculate position size based on balance ratio
* **Sell Strategy**: When target wallet sells, match the sell proportionally
* **Merge Strategy**: When target wallet closes position but you still hold, sell your position
* **Error Handling**: Retry failed orders up to RETRY_LIMIT, then mark as failed

---

## Project Structure

```
src/
 ├── index.ts                 # Main entry point
 ├── config/
 │   ├── db.ts                # MongoDB connection
 │   └── env.ts               # Environment variables
 ├── services/
 │   ├── tradeMonitor.ts      # Monitors target wallet trades
 │   ├── tradeExecutor.ts     # Executes copy trades
 │   └── createClobClient.ts # Alternative CLOB client (unused)
 ├── utils/
 │   ├── createClobClient.ts  # CLOB client initialization
 │   ├── fetchData.ts         # HTTP data fetching
 │   ├── getMyBalance.ts      # USDC balance checker
 │   ├── postOrder.ts         # Order execution logic
 │   └── spinner.ts           # Terminal spinner
 ├── models/
 │   └── userHistory.ts       # MongoDB schemas
 ├── interfaces/
 │   └── User.ts              # TypeScript interfaces
 └── test/
     └── test.ts              # Test utilities
```

---

## Logging & Monitoring

* Trade detection and execution
* Balance and allowance checks
* Redemption outcomes
* Structured logs for debugging and audits

Log levels: `info`, `success`, `warning`, `error`

---

## Risk Disclosure

* Copy trading amplifies both profits and losses
* Liquidity and slippage risks apply
* Gas fees incurred on every transaction
* WebSocket or API outages may impact execution

**Best Practices**:

* Start with low multipliers
* Enforce strict max order sizes
* Monitor balances regularly
* Test using dry-run modes

---

## Development

```bash
# Type check
npm run build

# Run in development mode
npm run dev

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

---


### Key Features

* Real-time trade monitoring and execution
* Intelligent position matching and sizing
* Automatic retry mechanisms for failed orders
* MongoDB-based trade history tracking
* Support for multiple market types

---

## Contact & Support

For deployment support, custom integrations, or professional inquiries:

**Telegram**: [@roswellecho](https://t.me/roswellecho)

---

## Troubleshooting

### Common Issues

1. **"USER_ADDRESS is not defined"**
   - Check your `.env` file exists and has all required variables

2. **"MongoDB connection error"**
   - Ensure MongoDB is running
   - Verify `MONGO_URI` is correct

3. **"Cannot find module '@polymarket/clob-client'"**
   - Run `npm install` to install dependencies

4. **"invalid hexlify value"**
   - Check `PRIVATE_KEY` is 64 hex characters without `0x` prefix

5. **"API Key creation failed"**
   - Verify `PRIVATE_KEY` matches `PROXY_WALLET`
   - Ensure wallet has proper permissions

### Testing

Before running in production:
1. Monitor first few trades carefully
2. Verify MongoDB is storing trades correctly
3. Check order execution logs

---

## License

MIT
