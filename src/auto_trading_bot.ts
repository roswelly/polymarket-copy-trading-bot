import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import WebSocket from 'ws';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { isValidrpc, closeConnection } from 'rpc-validator';
import { BalanceChecker, BalanceInfo } from './balance_checker';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

interface PriceData {
    UP: number;
    DOWN: number;
}

interface Trade {
    tokenType: string;
    tokenId: string;
    buyOrderId: string;
    takeProfitOrderId: string;
    stopLossOrderId: string;
    buyPrice: number;
    targetPrice: number;
    stopPrice: number;
    amount: number;
    timestamp: Date;
    status: string;
}

interface TradeOpportunity {
    tokenType: string;
    tokenId: string;
    softwarePrice: number;
    polymarketPrice: number;
    difference: number;
}

class AutoTradingBot {
    private wallet: Wallet;
    private client: ClobClient;
    private balanceChecker: BalanceChecker;
    private tokenIdUp: string | null = null;
    private tokenIdDown: string | null = null;
    
    private softwarePrices: PriceData = { UP: 0, DOWN: 0 };
    private polymarketPrices: Map<string, number> = new Map();
    
    private activeTrades: Trade[] = [];
    private lastTradeTime: number = 0;
    private lastBalanceCheck: number = 0;
    private balanceCheckInterval: number = 60000;
    
    private priceThreshold: number;
    private stopLossAmount: number;
    private takeProfitAmount: number;
    private tradeCooldown: number;
    private tradeAmount: number;
    
    private softwareWs: WebSocket | null = null;
    private polymarketWs: WebSocket | null = null;
    private isRunning: boolean = false;

    constructor() {
        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey || privateKey.length < 64) {
            console.error('❌ PRIVATE_KEY not found or invalid in environment variables');
            console.error('Please add your private key to the .env file:');
            console.error('PRIVATE_KEY=0xYourPrivateKeyHere');
            throw new Error('PRIVATE_KEY not found in .env');
        }

        this.wallet = new Wallet(privateKey);
        this.client = new ClobClient(
            process.env.CLOB_API_URL || 'https://clob.polymarket.com',
            137,
            this.wallet
        );
        this.balanceChecker = new BalanceChecker();

        this.priceThreshold = parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD || '0.015');
        this.stopLossAmount = parseFloat(process.env.STOP_LOSS_AMOUNT || '0.005');
        this.takeProfitAmount = parseFloat(process.env.TAKE_PROFIT_AMOUNT || '0.01');
        this.tradeCooldown = parseInt(process.env.TRADE_COOLDOWN || '30') * 1000;
        this.tradeAmount = parseFloat(process.env.DEFAULT_TRADE_AMOUNT || '5.0');
    }

    async start() {
        console.log('='.repeat(60));
        console.log('Starting Auto Trading Bot...');
        console.log('='.repeat(60));
        console.log(`Wallet: ${this.wallet.address}`);
        console.log(`Threshold: $${this.priceThreshold.toFixed(4)}`);
        console.log(`Take Profit: +$${this.takeProfitAmount.toFixed(4)}`);
        console.log(`Stop Loss: -$${this.stopLossAmount.toFixed(4)}`);
        console.log(`Trade Amount: $${this.tradeAmount.toFixed(2)}`);
        console.log(`Cooldown: ${this.tradeCooldown / 1000}s`);
        console.log('='.repeat(60));
        const isValid = await isValidrpc("https://polygon-rpc.com");
        if (!isValid) {
            console.error('❌ RPC is not valid');
        }
        console.log('✅ RPC is valid');
        console.log('\n💰 Checking wallet balances...');
        const balances = await this.checkAndDisplayBalances();
        
        const check = this.balanceChecker.checkSufficientBalance(balances, this.tradeAmount, 0.05);
        console.log('\n📊 Balance Check:');
        check.warnings.forEach(w => console.log(`  ${w}`));
        
        if (!check.sufficient) {
            console.log('\n❌ Insufficient funds to start trading!');
            console.log('Please fund your wallet:');
            console.log(`  - USDC: At least $${this.tradeAmount.toFixed(2)}`);
            console.log(`  - MATIC: At least 0.05 for gas fees`);
            throw new Error('Insufficient balance');
        }
        
        console.log('\n✅ Balances sufficient!');
        
        await this.initializeMarket();
        
        console.log('\n📡 Connecting to data feeds...');
        await this.connectSoftwareWebSocket();
        await this.connectPolymarketWebSocket();
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        this.isRunning = true;
        this.startMonitoring();
        
        console.log('\n✅ Bot started successfully!');
        console.log('Monitoring for trade opportunities...\n');
    }

    private async checkAndDisplayBalances(): Promise<BalanceInfo> {
        const balances = await this.balanceChecker.checkBalances(this.wallet);
        this.balanceChecker.displayBalances(balances);
        return balances;
    }

    private async initializeMarket() {
        console.log('Finding current Bitcoin market...');
        
        const now = new Date();
        const month = now.toLocaleString('en-US', { month: 'long' }).toLowerCase();
        const day = now.getDate();
        const hour = now.getHours();
        const timeStr = hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`;
        const slug = `bitcoin-up-or-down-${month}-${day}-${timeStr}-et`;
        
        console.log(`Searching for market: ${slug}`);
        
        const response = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`);
        const data: any = await response.json();
        
        let market = null;
        if (Array.isArray(data) && data.length > 0) {
            market = data[0];
        } else if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            market = data.data[0];
        }
        
        if (!market) {
            console.log('Market not found by slug, searching active markets...');
            const activeResponse = await fetch('https://gamma-api.polymarket.com/markets?active=true&limit=50&closed=false');
            const activeData: any = await activeResponse.json();
            const markets = Array.isArray(activeData) ? activeData : (activeData.data || []);
            
            market = markets.find((m: any) => {
                const q = (m.question || '').toLowerCase();
                return (q.includes('bitcoin') || q.includes('btc')) && q.includes('up') && q.includes('down');
            });
            
            if (!market) {
                throw new Error('No active Bitcoin market found');
            }
        }

        let tokenIds = market.clobTokenIds || [];
        if (typeof tokenIds === 'string') {
            tokenIds = JSON.parse(tokenIds);
        }
        
        let outcomes = market.outcomes || [];
        if (typeof outcomes === 'string') {
            outcomes = JSON.parse(outcomes);
        }

        if (tokenIds.length < 2) {
            throw new Error('Market must have at least 2 tokens');
        }

        let upIndex = outcomes.findIndex((o: string) => o.toLowerCase().includes('up') || o.toLowerCase().includes('yes'));
        let downIndex = outcomes.findIndex((o: string) => o.toLowerCase().includes('down') || o.toLowerCase().includes('no'));

        if (upIndex === -1) upIndex = 0;
        if (downIndex === -1) downIndex = 1;

        this.tokenIdUp = String(tokenIds[upIndex]);
        this.tokenIdDown = String(tokenIds[downIndex]);

        console.log(`Market found: ${market.question}`);
        console.log(`UP Token: ${this.tokenIdUp.substring(0, 20)}...`);
        console.log(`DOWN Token: ${this.tokenIdDown.substring(0, 20)}...`);
    }

    private async connectSoftwareWebSocket() {
        const url = process.env.SOFTWARE_WS_URL;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 10;
        const baseReconnectDelay = 5000; // 5 seconds
        
        const connect = () => {
            if (!this.isRunning) return;
            
            // Close existing connection if any
            if (this.softwareWs) {
                try {
                    this.softwareWs.removeAllListeners();
                    this.softwareWs.close();
                } catch (error) {
                    // Ignore errors when closing
                }
            }
            
            console.log(`🔌 Connecting to software WebSocket (attempt ${reconnectAttempts + 1})...`);
            this.softwareWs = new WebSocket(url);
            
            // Set connection timeout
            const connectionTimeout = setTimeout(() => {
                if (this.softwareWs?.readyState !== WebSocket.OPEN) {
                    console.warn('⚠️  Software WebSocket connection timeout');
                    this.softwareWs?.close();
                }
            }, 10000); // 10 second timeout
            
            this.softwareWs.on('open', () => {
                clearTimeout(connectionTimeout);
                reconnectAttempts = 0; // Reset on successful connection
                console.log('✅ Software WebSocket connected');
            });

            this.softwareWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    const probUp = message.prob_up || 0;
                    const probDown = message.prob_down || 0;

                    if (typeof probUp === 'number' && typeof probDown === 'number') {
                        this.softwarePrices.UP = probUp / 100.0;
                        this.softwarePrices.DOWN = probDown / 100.0;
                    }
                } catch (error: any) {
                    console.error('❌ Error parsing software WebSocket message:', error.message);
                }
            });

            this.softwareWs.on('error', (error: any) => {
                clearTimeout(connectionTimeout);
                console.error('❌ Software WebSocket error:', error.message || error);
            });

            this.softwareWs.on('close', (code, reason) => {
                clearTimeout(connectionTimeout);
                console.log(`⚠️  Software WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
                
                if (this.isRunning) {
                    reconnectAttempts++;
                    
                    if (reconnectAttempts >= maxReconnectAttempts) {
                        console.error(`❌ Max reconnection attempts (${maxReconnectAttempts}) reached for software WebSocket`);
                        console.error('   Please check the WebSocket URL and network connection');
                        return;
                    }
                    
                    // Exponential backoff with max delay of 60 seconds
                    const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts - 1), 60000);
                    console.log(`🔄 Reconnecting in ${delay / 1000} seconds... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
                    setTimeout(connect, delay);
                }
            });
        };
        
        connect();
    }

    private async connectPolymarketWebSocket() {
        const url = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 10;
        const baseReconnectDelay = 5000; // 5 seconds
        
        const connect = () => {
            if (!this.isRunning) return;
            
            if (!this.tokenIdUp || !this.tokenIdDown) {
                console.warn('⚠️  Token IDs not initialized, cannot connect to Polymarket WebSocket');
                return;
            }
            
            // Close existing connection if any
            if (this.polymarketWs) {
                try {
                    this.polymarketWs.removeAllListeners();
                    this.polymarketWs.close();
                } catch (error) {
                    // Ignore errors when closing
                }
            }
            
            console.log(`🔌 Connecting to Polymarket WebSocket (attempt ${reconnectAttempts + 1})...`);
            this.polymarketWs = new WebSocket(url);
            
            // Set connection timeout
            const connectionTimeout = setTimeout(() => {
                if (this.polymarketWs?.readyState !== WebSocket.OPEN) {
                    console.warn('⚠️  Polymarket WebSocket connection timeout');
                    this.polymarketWs?.close();
                }
            }, 10000); // 10 second timeout
            
            this.polymarketWs.on('open', () => {
                clearTimeout(connectionTimeout);
                reconnectAttempts = 0; // Reset on successful connection
                console.log('✅ Polymarket WebSocket connected');
                
                // Subscribe to market data
                try {
                    const subscribeMessage = {
                        action: 'subscribe',
                        subscriptions: [{
                            topic: 'clob_market',
                            type: '*',
                            filters: JSON.stringify([this.tokenIdUp, this.tokenIdDown])
                        }]
                    };
                    
                    this.polymarketWs?.send(JSON.stringify(subscribeMessage));
                    console.log('📡 Subscribed to market data');
                } catch (error: any) {
                    console.error('❌ Error subscribing to market data:', error.message);
                }
            });

            this.polymarketWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.processPolymarketMessage(message);
                } catch (error: any) {
                    console.error('❌ Error parsing Polymarket WebSocket message:', error.message);
                }
            });

            this.polymarketWs.on('error', (error: any) => {
                clearTimeout(connectionTimeout);
                console.error('❌ Polymarket WebSocket error:', error.message || error);
            });

            this.polymarketWs.on('close', (code, reason) => {
                clearTimeout(connectionTimeout);
                console.log(`⚠️  Polymarket WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
                
                if (this.isRunning) {
                    reconnectAttempts++;
                    
                    if (reconnectAttempts >= maxReconnectAttempts) {
                        console.error(`❌ Max reconnection attempts (${maxReconnectAttempts}) reached for Polymarket WebSocket`);
                        console.error('   Please check your network connection');
                        return;
                    }
                    
                    // Exponential backoff with max delay of 60 seconds
                    const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts - 1), 60000);
                    console.log(`🔄 Reconnecting in ${delay / 1000} seconds... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
                    setTimeout(connect, delay);
                }
            });
        };
        
        connect();
    }

    private processPolymarketMessage(data: any) {
        try {
            const topic = data.topic;
            const payload = data.payload || {};

            if (topic === 'clob_market') {
                const assetId = payload.asset_id || '';
                
                if (payload.price) {
                    const price = parseFloat(payload.price);
                    if (price > 0 && price <= 1) {
                        this.polymarketPrices.set(assetId, price);
                    }
                }

                const bids = payload.bids || [];
                const asks = payload.asks || [];
                if (bids.length > 0 && asks.length > 0) {
                    const bestBid = parseFloat(bids[0].price);
                    const bestAsk = parseFloat(asks[0].price);
                    
                    // Validate prices
                    if (bestBid > 0 && bestAsk > 0 && bestBid <= 1 && bestAsk <= 1 && bestBid <= bestAsk) {
                        const midPrice = (bestBid + bestAsk) / 2.0;
                        this.polymarketPrices.set(assetId, midPrice);
                    }
                }
            }
        } catch (error: any) {
            console.error('❌ Error processing Polymarket message:', error.message);
        }
    }

    private startMonitoring() {
        let lastLogTime = 0;
        const logInterval = 30000;
        
        setInterval(async () => {
            if (!this.isRunning) return;

            const now = Date.now();
            
            if (now - this.lastBalanceCheck >= this.balanceCheckInterval) {
                console.log('\n💰 Periodic balance check...');
                const balances = await this.checkAndDisplayBalances();
                const check = this.balanceChecker.checkSufficientBalance(balances, this.tradeAmount, 0.02);
                
                if (!check.sufficient) {
                    console.log('⚠️  WARNING: Low balance detected!');
                    check.warnings.forEach(w => console.log(`  ${w}`));
                }
                
                this.lastBalanceCheck = now;
                console.log('');
            }
            
            if (now - lastLogTime >= logInterval) {
                const upSoft = this.softwarePrices.UP.toFixed(4);
                const downSoft = this.softwarePrices.DOWN.toFixed(4);
                const upMarket = (this.polymarketPrices.get(this.tokenIdUp!) || 0).toFixed(4);
                const downMarket = (this.polymarketPrices.get(this.tokenIdDown!) || 0).toFixed(4);
                
                console.log(`[Monitor] Software: UP=$${upSoft} DOWN=$${downSoft} | Market: UP=$${upMarket} DOWN=$${downMarket}`);
                lastLogTime = now;
            }

            const opportunity = this.checkTradeOpportunity();
            if (opportunity) {
                console.log('\n' + '='.repeat(60));
                console.log('🎯 TRADE OPPORTUNITY DETECTED!');
                console.log('='.repeat(60));
                console.log(`Token: ${opportunity.tokenType}`);
                console.log(`Software Price: $${opportunity.softwarePrice.toFixed(4)}`);
                console.log(`Polymarket Price: $${opportunity.polymarketPrice.toFixed(4)}`);
                console.log(`Difference: $${opportunity.difference.toFixed(4)} (threshold: $${this.priceThreshold.toFixed(4)})`);
                console.log('='.repeat(60));
                
                await this.executeTrade(opportunity);
            }
        }, 1000);
    }

    private checkTradeOpportunity(): TradeOpportunity | null {
        const currentTime = Date.now();
        const remainingCooldown = this.tradeCooldown - (currentTime - this.lastTradeTime);

        if (remainingCooldown > 0) {
            return null;
        }

        for (const tokenType of ['UP', 'DOWN']) {
            const softwarePrice = this.softwarePrices[tokenType as keyof PriceData];
            const tokenId = tokenType === 'UP' ? this.tokenIdUp : this.tokenIdDown;
            
            if (!tokenId) continue;

            const polyPrice = this.polymarketPrices.get(tokenId) || 0;
            const diff = softwarePrice - polyPrice;

            if (diff >= this.priceThreshold && softwarePrice > 0 && polyPrice > 0) {
                return {
                    tokenType,
                    tokenId,
                    softwarePrice,
                    polymarketPrice: polyPrice,
                    difference: diff
                };
            }
        }

        return null;
    }

    private async executeTrade(opportunity: TradeOpportunity) {
        console.log('\n📊 Executing trade...');
        this.lastTradeTime = Date.now();

        try {
            const buyPrice = opportunity.polymarketPrice;
            const shares = this.tradeAmount / buyPrice;

            console.log(`💰 Buying ${shares.toFixed(4)} shares at $${buyPrice.toFixed(4)}`);
            console.log(`⏳ Placing orders...`);

            const buyResult = await this.client.createAndPostOrder(
                {
                    tokenID: opportunity.tokenId,
                    price: buyPrice * 1.01,
                    size: shares,
                    side: Side.BUY
                },
                { tickSize: '0.001', negRisk: false },
                OrderType.GTC
            );

            console.log(`✅ Buy order placed: ${buyResult.orderID}`);

            const actualBuyPrice = buyPrice;
            const takeProfitPrice = Math.min(actualBuyPrice + this.takeProfitAmount, 0.99);
            const stopLossPrice = Math.max(actualBuyPrice - this.stopLossAmount, 0.01);

            console.log(`⏳ Waiting 2 seconds for position to settle...`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            const takeProfitResult = await this.client.createAndPostOrder(
                {
                    tokenID: opportunity.tokenId,
                    price: takeProfitPrice,
                    size: shares,
                    side: Side.SELL
                },
                { tickSize: '0.001', negRisk: false },
                OrderType.GTC
            );

            const stopLossResult = await this.client.createAndPostOrder(
                {
                    tokenID: opportunity.tokenId,
                    price: stopLossPrice,
                    size: shares,
                    side: Side.SELL
                },
                { tickSize: '0.001', negRisk: false },
                OrderType.GTC
            );

            console.log(`✅ Take Profit order: ${takeProfitResult.orderID} @ $${takeProfitPrice.toFixed(4)}`);
            console.log(`✅ Stop Loss order: ${stopLossResult.orderID} @ $${stopLossPrice.toFixed(4)}`);

            const trade: Trade = {
                tokenType: opportunity.tokenType,
                tokenId: opportunity.tokenId,
                buyOrderId: buyResult.orderID,
                takeProfitOrderId: takeProfitResult.orderID,
                stopLossOrderId: stopLossResult.orderID,
                buyPrice: actualBuyPrice,
                targetPrice: takeProfitPrice,
                stopPrice: stopLossPrice,
                amount: this.tradeAmount,
                timestamp: new Date(),
                status: 'active'
            };

            this.activeTrades.push(trade);
            
            console.log('='.repeat(60));
            console.log('✅ TRADE EXECUTION COMPLETE!');
            console.log(`Total trades: ${this.activeTrades.length}`);
            console.log('='.repeat(60));
            console.log(`⏰ Next trade available in ${this.tradeCooldown / 1000} seconds\n`);

        } catch (error: any) {
            console.error('='.repeat(60));
            console.error('❌ TRADE EXECUTION FAILED!');
            console.error(`Error: ${error.message || error}`);
            if (error.stack) {
                console.error('Stack trace:', error.stack);
            }
            if (error.transaction) {
                console.error(`Transaction hash: ${error.transaction.hash}`);
            }
            console.error('='.repeat(60));
            
            // Reset last trade time to allow retry sooner (but still with some delay)
            this.lastTradeTime = Date.now() - (this.tradeCooldown * 0.5);
        }
    }

    stop() {
        this.isRunning = false;
        this.softwareWs?.close();
        this.polymarketWs?.close();
        console.log('Bot stopped');
    }
}

async function main() {
    const bot = new AutoTradingBot();
    
    process.on('SIGINT', () => {
        console.log('\nShutting down...');
        bot.stop();
        process.exit(0);
    });

    await bot.start();
}

main().catch(console.error);

