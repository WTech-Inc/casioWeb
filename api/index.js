const express = require('express');
const cors = require('cors');
const db = require('./database');
const baccaratAPI = require('./games/baccarat');
const slotsAPI = require('./games/slots');
const path = require("path");
const adminAPI = require("./admin");
const DoubaoBot = require("./bot");

const app = express();

// 重要：靜態檔案要放在最前面！
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(cors());
app.use(express.json());

bot = new DoubaoBot();
// 優雅關閉處理
process.on('SIGINT', () => {
    console.log('\n🛑 收到關閉信號，正在優雅關閉...');
    bot.shutdown();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 收到終止信號，正在優雅關閉...');
    bot.shutdown();
    process.exit(0);
});

// 中間件：解析 cookie
const cookieParser = require('cookie-parser');
app.use(cookieParser());

// 🆔 取得 session ID
const getSessionId = (req) => {
    return req.headers['session-id'] || 
           req.cookies?.sessionId || 
           req.query.sessionId;
};

// 🔐 驗證 middleware（寬鬆版，先允許訪客）
const authMiddleware = async (req, res, next) => {
    try {
        const sessionId = getSessionId(req);
        
        if (sessionId) {
            try {
                const user = await db.validateSession(sessionId);
                req.user = user;
                req.sessionId = sessionId;
                req.isAuthenticated = true;
            } catch (sessionError) {
                // session 無效，但還是允許繼續
                req.isAuthenticated = false;
                console.log('Session 無效:', sessionError.message);
            }
        } else {
            req.isAuthenticated = false;
        }
        
        next();
    } catch (error) {
        console.error('Auth middleware 錯誤:', error);
        req.isAuthenticated = false;
        next();
    }
};

// 簡化版：允許未登入訪問
const optionalAuth = async (req, res, next) => {
    req.isAuthenticated = false;
    
    const sessionId = getSessionId(req);
    if (sessionId) {
        try {
            const user = await db.validateSession(sessionId);
            req.user = user;
            req.sessionId = sessionId;
            req.isAuthenticated = true;
        } catch (error) {
            // 忽略錯誤，繼續訪客模式
        }
    }
    
    next();
};

// 🏠 首頁路由（API 文檔）
app.get('/api', (req, res) => {
    res.json({
        name: '快活娛樂城 API',
        version: '1.0.0',
        status: 'online',
        authRequired: false,
        endpoints: {
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                logout: 'POST /api/auth/logout',
                profile: 'GET /api/auth/profile'
            },
            games: {
                baccarat: 'POST /api/baccarat/bet',
                slots: 'POST /api/slots/spin'
            },
            data: {
                history: 'GET /api/history',
                leaderboard: 'GET /api/leaderboard',
                stats: 'GET /api/stats'
            },
            admin: {
                dashboard: 'GET /api/admin/dashboard',
                users: 'GET /api/admin/users',
                games: 'GET /api/admin/games/history'
            }
        }
    });
});

// 👤 使用者資料（寬鬆版）
app.get('/api/auth/profile', optionalAuth, async (req, res) => {
    try {
        if (req.isAuthenticated) {
            res.json({
                success: true,
                authenticated: true,
                user: req.user,
                sessionId: req.sessionId
            });
        } else {
            // 創建訪客帳號
            const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const guestUser = {
                player_id: guestId,
                username: '訪客玩家',
                chips: 1000,
                wins: 0,
                losses: 0,
                total_bet: 0,
                isGuest: true
            };
            
            res.json({
                success: true,
                authenticated: false,
                user: guestUser,
                message: '訪客模式，請註冊以保存進度'
            });
        }
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 📝 註冊
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false,
                error: '請提供使用者名稱和密碼' 
            });
        }
        
        if (username.length < 3) {
            return res.status(400).json({
                success: false,
                error: '使用者名稱至少需要3個字元'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: '密碼至少需要6個字元'
            });
        }
        
        const result = await db.register(username, password);
        
        // 設定 cookie
        res.cookie('sessionId', result.sessionId, { 
            maxAge: 7 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            sameSite: 'lax'
        });
        
        res.json({
            success: true,
            message: `歡迎 ${username}！獲得 1,000 USDT 起始籌碼`,
            sessionId: result.sessionId,
            user: result.user
        });
    } catch (error) {
        res.status(400).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🔓 登入
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false,
                error: '請提供使用者名稱和密碼' 
            });
        }
        
        const result = await db.login(username, password);
        
        // 設定 cookie
        res.cookie('sessionId', result.sessionId, { 
            maxAge: 7 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            sameSite: 'lax'
        });
        
        res.json({
            success: true,
            message: `歡迎回來 ${username}！`,
            sessionId: result.sessionId,
            user: result.user
        });
    } catch (error) {
        res.status(401).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🚪 登出
app.post('/api/auth/logout', optionalAuth, async (req, res) => {
    try {
        if (req.sessionId) {
            await db.logout(req.sessionId);
        }
        
        // 清除 cookie
        res.clearCookie('sessionId');
        
        res.json({
            success: true,
            message: '已登出'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🎲 百家樂（需要登入，但先允許訪客）
app.post('/api/baccarat/bet', optionalAuth, async (req, res) => {
    try {
        const { betOn, amount } = req.body;
        
        // 驗證下注選項
        const validBets = ['player', 'banker', 'tie'];
        if (!validBets.includes(betOn)) {
            return res.status(400).json({ 
                success: false,
                error: '無效的下注選項' 
            });
        }
        
        // 驗證金額
        const betAmount = parseInt(amount);
        if (isNaN(betAmount) || betAmount < 50 || betAmount > 5000) {
            return res.status(400).json({ 
                success: false,
                error: '下注金額必須在 50 到 5000 之間' 
            });
        }
        
        // 處理訪客和登入玩家
        let playerId;
        let isGuest = false;
        
        if (req.isAuthenticated) {
            playerId = req.user.player_id;
        } else {
            // 訪客模式：使用臨時 ID
            isGuest = true;
            playerId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // 為訪客創建臨時資料
            if (!req.user) {
                req.user = {
                    player_id: playerId,
                    username: '訪客玩家',
                    chips: 1000,
                    wins: 0,
                    losses: 0,
                    total_bet: 0,
                    isGuest: true
                };
            }
        }
        
        // 檢查餘額
        if (req.user.chips < betAmount) {
            return res.status(400).json({ 
                success: false,
                error: `餘額不足！當前餘額: ${req.user.chips} USDT` 
            });
        }
        
        // 進行遊戲
        const gameResult = baccaratAPI.playRound(betOn);
        
        // 計算輸贏
        let winAmount = 0;
        let resultType = 'lose';
        
        if (gameResult.winner === betOn) {
            if (betOn === 'player') {
                winAmount = betAmount; // 1:1
            } else if (betOn === 'banker') {
                winAmount = Math.floor(betAmount * 0.95); // 莊家抽水5%
            }
            resultType = 'win';
        } else if (gameResult.winner === 'tie' && betOn === 'tie') {
            winAmount = betAmount * 8; // 和局1:8
            resultType = 'win';
        }
        
        const netChange = winAmount - betAmount;
        
        // 更新籌碼
        if (!isGuest && req.isAuthenticated) {
            // 登入玩家：更新資料庫
            const updatedUser = await db.updatePlayerChips(
                playerId, 
                netChange, 
                resultType === 'win'
            );
            
            // 保存紀錄
            await db.saveGameHistory({
                player_id: playerId,
                game_type: 'baccarat',
                bet_amount: betAmount,
                win_amount: winAmount,
                result: resultType,
                details: {
                    bet_on: betOn,
                    ...gameResult
                }
            });
            
            req.user = updatedUser;
        } else {
            // 訪客：只更新記憶體
            req.user.chips += netChange;
            if (resultType === 'win') {
                req.user.wins += 1;
            } else {
                req.user.losses += 1;
            }
            req.user.total_bet += betAmount;
        }
        
        res.json({
            success: true,
            gameResult,
            betDetails: {
                betOn,
                betAmount,
                winAmount,
                netChange,
                isGuest
            },
            user: {
                ...req.user,
                password: undefined
            },
            message: resultType === 'win' ? 
                `🎉 恭喜贏得 ${winAmount} USDT！` : 
                '下次會更好！'
        });
    } catch (error) {
        console.error('百家樂錯誤:', error);
        res.status(400).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🎰 老虎機（類似百家樂的處理）
app.post('/api/slots/spin', optionalAuth, async (req, res) => {
    try {
        const { bet } = req.body;
        
        const betAmount = parseInt(bet);
        if (isNaN(betAmount) || betAmount < 10 || betAmount > 1000) {
            return res.status(400).json({ 
                success: false,
                error: '下注金額必須在 10 到 1000 之間' 
            });
        }
        
        // 處理玩家身份
        let playerId;
        let isGuest = false;
        
        if (req.isAuthenticated) {
            playerId = req.user.player_id;
        } else {
            isGuest = true;
            playerId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            if (!req.user) {
                req.user = {
                    player_id: playerId,
                    username: '訪客玩家',
                    chips: 1000,
                    wins: 0,
                    losses: 0,
                    total_bet: 0,
                    isGuest: true
                };
            }
        }
        
        // 檢查餘額
        if (req.user.chips < betAmount) {
            return res.status(400).json({ 
                success: false,
                error: `餘額不足！當前餘額: ${req.user.chips} USDT` 
            });
        }
        
        // 遊戲邏輯
        const symbols = ['🍒', '🍋', '⭐', '7️⃣', '🔔', '💎'];
        const reels = [
            symbols[Math.floor(Math.random() * symbols.length)],
            symbols[Math.floor(Math.random() * symbols.length)],
            symbols[Math.floor(Math.random() * symbols.length)]
        ];
        
        let multiplier = 0;
        let message = '再接再厲！';
        
        if (reels[0] === reels[1] && reels[1] === reels[2]) {
            if (reels[0] === '7️⃣') {
                multiplier = 50;
                message = '🎉 傑克寶！三個7！';
            } else if (reels[0] === '💎') {
                multiplier = 30;
                message = '💎 鑽石連線！';
            } else {
                multiplier = 10;
                message = '🎯 恭喜連線！';
            }
        } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
            multiplier = 3;
            message = '✨ 兩個相同！';
        }
        
        const winAmount = betAmount * multiplier;
        const netChange = winAmount - betAmount;
        
        // 更新籌碼
        if (!isGuest && req.isAuthenticated) {
            const updatedUser = await db.updatePlayerChips(
                playerId, 
                netChange, 
                winAmount > 0
            );
            
            await db.saveGameHistory({
                player_id: playerId,
                game_type: 'slots',
                bet_amount: betAmount,
                win_amount: winAmount,
                result: winAmount > 0 ? 'win' : 'lose',
                details: { reels, multiplier }
            });
            
            req.user = updatedUser;
        } else {
            req.user.chips += netChange;
            if (winAmount > 0) {
                req.user.wins += 1;
            } else {
                req.user.losses += 1;
            }
            req.user.total_bet += betAmount;
        }
        
        res.json({
            success: true,
            reels,
            bet: betAmount,
            winAmount,
            multiplier,
            jackpot: multiplier === 50,
            message,
            user: {
                ...req.user,
                password: undefined
            }
        });
    } catch (error) {
        console.error('老虎機錯誤:', error);
        res.status(400).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 📜 遊戲紀錄（需要登入）
app.get('/api/history', optionalAuth, async (req, res) => {
    try {
        if (!req.isAuthenticated) {
            return res.json({
                success: true,
                history: [],
                message: '請登入以查看遊戲紀錄'
            });
        }
        
        const history = await db.getPlayerHistory(req.user.player_id, 20);
        res.json({ 
            success: true,
            history 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🏆 排行榜（公開）
app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaderboard = await db.getLeaderboard(10);
        res.json({ 
            success: true,
            leaderboard 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 💰 充值籌碼（需要登入）
app.post('/api/topup', optionalAuth, async (req, res) => {
    try {
        if (!req.isAuthenticated) {
            return res.status(401).json({ 
                success: false,
                error: '請先登入' 
            });
        }
        
        const { amount } = req.body;
        const playerId = req.user.player_id;
        
        const topupAmount = parseInt(amount) || 500;
        if (topupAmount < 100 || topupAmount > 5000) {
            return res.status(400).json({ 
                success: false,
                error: '充值金額必須在 100 到 5000 之間' 
            });
        }
        
        const updatedUser = await db.updatePlayerChips(playerId, topupAmount);
        
        res.json({
            success: true,
            message: `成功充值 ${topupAmount} USDT！`,
            user: updatedUser,
            note: '記住，這只是遊戲幣！享受遊戲樂趣，切勿沉迷。'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🎯 遊戲統計
app.get('/api/stats', async (req, res) => {
    try {
        const leaderboard = await db.getLeaderboard(5);
        res.json({
            success: true,
            stats: {
                leaderboard,
                activePlayers: leaderboard.length,
                totalChipsInPlay: leaderboard.reduce((sum, p) => sum + p.chips, 0),
                serverTime: new Date().toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 💰 USDT 充值選項
app.get('/api/topup/options', optionalAuth, (req, res) => {
    res.json({
        success: true,
        options: [
            { id: 'basic', amount: 1000, bonus: 0, label: '新手包', popular: false },
            { id: 'bronze', amount: 5000, bonus: 500, label: '青銅包', popular: false },
            { id: 'silver', amount: 10000, bonus: 1500, label: '白銀包', popular: true },
            { id: 'gold', amount: 50000, bonus: 10000, label: '黃金包', popular: true },
            { id: 'platinum', amount: 100000, bonus: 25000, label: '鉑金包', popular: false },
            { id: 'custom', amount: 0, bonus: 0, label: '自定義', popular: false }
        ],
        paymentMethods: [
            { id: 'trc20', name: 'TRC20 (推薦)', fee: 0, min: 100, max: 1000000 },
            { id: 'erc20', name: 'ERC20', fee: 10, min: 100, max: 1000000 },
            { id: 'binance', name: '幣安鏈', fee: 1, min: 50, max: 500000 },
            { id: 'test', name: '測試充值', fee: 0, min: 10, max: 1000 }
        ],
        note: '所有金額為虛擬 USDT，僅供遊戲娛樂使用'
    });
});

// 📤 創建充值訂單
app.post('/api/topup/create-order', optionalAuth, async (req, res) => {
    try {
        if (!req.isAuthenticated) {
            return res.status(401).json({ 
                success: false,
                error: '請先登入' 
            });
        }
        
        const { amount, paymentMethod, packageId } = req.body;
        
        const topupAmount = parseInt(amount);
        if (isNaN(topupAmount) || topupAmount < 10 || topupAmount > 1000000) {
            return res.status(400).json({ 
                success: false,
                error: '充值金額必須在 10 到 1,000,000 之間' 
            });
        }
        
        // 根據套餐計算獎勵
        let bonus = 0;
        let totalAmount = topupAmount;
        
        const packages = {
            'bronze': { bonus: 500 },
            'silver': { bonus: 1500 },
            'gold': { bonus: 10000 },
            'platinum': { bonus: 25000 }
        };
        
        if (packages[packageId]) {
            bonus = packages[packageId].bonus;
            totalAmount = topupAmount + bonus;
        }
        
        // 創建訂單
        const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
        const walletAddress = generateWalletAddress(paymentMethod);
        
        // 保存訂單（簡化版）
        const order = {
            orderId,
            playerId: req.user.player_id,
            username: req.user.username,
            amount: topupAmount,
            bonus: bonus,
            totalAmount: totalAmount,
            paymentMethod,
            walletAddress,
            status: 'pending',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30分鐘過期
        };
        
        // 這裡應該保存到資料庫，簡化版先返回
        res.json({
            success: true,
            order,
            instructions: getPaymentInstructions(paymentMethod, walletAddress, totalAmount),
            message: '請在30分鐘內完成轉帳'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// ✅ 模擬充值完成（測試用）
app.post('/api/topup/complete-test', optionalAuth, async (req, res) => {
    try {
        if (!req.isAuthenticated) {
            return res.status(401).json({ 
                success: false,
                error: '請先登入' 
            });
        }
        
        const { orderId, amount } = req.body;
        const playerId = req.user.player_id;
        
        const updatedUser = await db.updatePlayerChips(playerId, parseInt(amount));
        
        // 保存充值紀錄
        await db.saveGameHistory({
            player_id: playerId,
            game_type: 'deposit',
            bet_amount: 0,
            win_amount: parseInt(amount),
            result: 'deposit',
            details: { orderId, type: 'test_deposit' }
        });
        
        res.json({
            success: true,
            message: `✅ 成功充值 ${amount} USDT！`,
            user: updatedUser,
            orderId
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 👑 管理員路由（重要：必須在這裡！）
app.use("/api/admin", adminAPI);

// 輔助函數
function generateWalletAddress(method) {
    const addresses = {
        'trc20': 'Txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        'erc20': '0x0000000000000000000000000000000000000000',
        'binance': 'bnb1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        'test': 'TEST_WALLET_1234567890'
    };
    
    // 生成隨機地址（簡化）
    const randomPart = Math.random().toString(36).substr(2, 10).toUpperCase();
    return `${addresses[method] || addresses.trc20}_${randomPart}`;
}

function getPaymentInstructions(method, address, amount) {
    const instructions = {
        'trc20': `請轉帳 ${amount} USDT 到以下 TRC20 地址：\n\n${address}\n\n📌 注意事項：\n• 僅接受 USDT (TRC20)\n• 請確認網路為 TRON\n• 到帳時間：1-5分鐘\n• 轉帳完成後系統自動入帳`,
        'erc20': `請轉帳 ${amount} USDT 到以下 ERC20 地址：\n\n${address}\n\n📌 注意事項：\n• 僅接受 USDT (ERC20)\n• 需要 10 USDT 手續費\n• 到帳時間：5-30分鐘\n• 請確認 Gas 費足夠`,
        'binance': `請轉帳 ${amount} USDT 到以下 BEP20 地址：\n\n${address}\n\n📌 注意事項：\n• 僅接受 USDT (BEP20)\n• 需要 1 USDT 手續費\n• 到帳時間：1-3分鐘\n• 請確認網路為 BSC`,
        'test': `測試充值：點擊下方按鈕即可獲得 ${amount} USDT\n\n（僅供測試，非真實轉帳）`
    };
    
    return instructions[method] || instructions.trc20;
}

// 🌐 前端路由（必須放在最後！）
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// 錯誤處理
app.use((err, req, res, next) => {
    console.error('伺服器錯誤:', err.stack);
    res.status(500).json({
        success: false,
        error: '伺服器錯誤',
        message: process.env.NODE_ENV === 'development' ? err.message : '請稍後再試'
    });
});

// 健康檢查
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});
// 登入 Bot
bot.login(process.env.DISCORD_TOKEN);

module.exports = app;