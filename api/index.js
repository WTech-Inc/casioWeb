const express = require('express');
const cors = require('cors');
const db = require('./database');
const baccaratAPI = require('./games/baccarat');
const slotsAPI = require('./games/slots');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 產生玩家 ID（從 cookie 或 header）
const getPlayerId = (req) => {
    return req.headers['player-id'] || 
           req.cookies?.playerId || 
           `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// 🏠 遊戲大廳
app.get('/api', (req, res) => {
    res.json({
        welcome: '🎰 歡迎來到快活娛樂城',
        message: '本遊戲使用虛擬貨幣usdt，僅供娛樂用途',
        games: {
            baccarat: { name: '開心百家樂', path: '/baccarat.html', minBet: 50, maxBet: 5000 },
            slots: { name: '幸運老虎機', path: '/slots.html', minBet: 10, maxBet: 1000 }
        },
        endpoints: {
            player: 'GET /api/player',
            baccarat: 'POST /api/baccarat/bet',
            slots: 'POST /api/slots/spin',
            history: 'GET /api/history',
            leaderboard: 'GET /api/leaderboard',
            topup: 'POST /api/topup'
        }
    });
});

// 👤 玩家資訊
app.get('/api/player', async (req, res) => {
    try {
        const playerId = getPlayerId(req);
        const player = await db.getOrCreatePlayer(playerId);
        
        // 設定 cookie
        res.cookie('playerId', playerId, { maxAge: 30 * 24 * 60 * 60 * 1000 });
        
        res.json({
            success: true,
            player,
            sessionId: playerId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 🎲 百家樂下注
app.post('/api/baccarat/bet', async (req, res) => {
    try {
        const { betOn, amount } = req.body;
        const playerId = getPlayerId(req);
        
        // 驗證下注選項
        const validBets = ['player', 'banker', 'tie'];
        if (!validBets.includes(betOn)) {
            return res.status(400).json({ error: '無效的下注選項' });
        }
        
        // 驗證金額
        const betAmount = parseInt(amount);
        if (isNaN(betAmount) || betAmount < 50 || betAmount > 5000) {
            return res.status(400).json({ 
                error: '下注金額必須在 50 到 5000 之間' 
            });
        }
        
        const result = await baccaratAPI.placeBet(playerId, betOn, betAmount);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 🎰 老虎機
app.post('/api/slots/spin', async (req, res) => {
    try {
        const { bet } = req.body;
        const playerId = getPlayerId(req);
        
        const betAmount = parseInt(bet);
        if (isNaN(betAmount) || betAmount < 10 || betAmount > 1000) {
            return res.status(400).json({ 
                error: '下注金額必須在 10 到 1000 之間' 
            });
        }
        
        const result = await slotsAPI.spin(playerId, betAmount);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 📜 遊戲紀錄
app.get('/api/history', async (req, res) => {
    try {
        const playerId = getPlayerId(req);
        const history = await db.getPlayerHistory(playerId, 20);
        res.json({ history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 🏆 排行榜
app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaderboard = await db.getLeaderboard(10);
        res.json({ leaderboard });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 💰 充值籌碼
app.post('/api/topup', async (req, res) => {
    try {
        const { amount } = req.body;
        const playerId = getPlayerId(req);
        
        const topupAmount = parseInt(amount) || 500;
        if (topupAmount < 100 || topupAmount > 5000) {
            return res.status(400).json({ 
                error: '充值金額必須在 100 到 5000 之間' 
            });
        }
        
        const player = await db.updatePlayerChips(playerId, topupAmount);
        
        res.json({
            success: true,
            message: `成功充值 ${topupAmount} 籌碼`,
            player,
            note: '記住，這只是遊戲幣！享受遊戲樂趣，切勿沉迷。'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 🎯 遊戲統計
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await baccaratAPI.getStatistics();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 錯誤處理
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: '伺服器錯誤',
        message: process.env.NODE_ENV === 'development' ? err.message : '請稍後再試'
    });
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: '找不到頁面' });
});

// 匯出給 Vercel
module.exports = app;