const express = require('express');
const cors = require('cors');
const db = require('./database');
const baccaratAPI = require('./games/baccarat');
const slotsAPI = require('./games/slots');
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// 🆔 從 cookie 或 header 取得 session
const getSessionId = (req) => {
    return req.headers['session-id'] || 
           req.cookies?.sessionId || 
           req.query.sessionId;
};

// 🔐 驗證 middleware
const authMiddleware = async (req, res, next) => {
    try {
        const sessionId = getSessionId(req);
        
        if (!sessionId) {
            return res.status(401).json({ 
                error: '請先登入',
                redirect: '/login.html'
            });
        }
        
        const user = await db.validateSession(sessionId);
        req.user = user;
        req.sessionId = sessionId;
        next();
    } catch (error) {
        res.status(401).json({ 
            error: error.message,
            redirect: '/login.html'
        });
    }
};

// 🏠 遊戲大廳
app.get('/api', (req, res) => {
    res.json({
        welcome: '🎰 歡迎來到快活娛樂城',
        message: '本遊戲使用虛擬貨幣 USDT，僅供娛樂用途',
        auth: {
            register: 'POST /api/auth/register',
            login: 'POST /api/auth/login',
            logout: 'POST /api/auth/logout',
            profile: 'GET /api/auth/profile'
        },
        games: {
            baccarat: { name: '開心百家樂', path: '/baccarat.html', minBet: 50, maxBet: 5000 },
            slots: { name: '幸運老虎機', path: '/slots.html', minBet: 10, maxBet: 1000 }
        },
        endpoints: {
            baccarat: 'POST /api/baccarat/bet',
            slots: 'POST /api/slots/spin',
            history: 'GET /api/history',
            leaderboard: 'GET /api/leaderboard',
            topup: 'POST /api/topup'
        }
    });
});

// 👤 使用者資料（需要登入）
app.get('/api/auth/profile', authMiddleware, async (req, res) => {
    try {
        res.json({
            success: true,
            user: req.user,
            sessionId: req.sessionId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 📝 註冊
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: '請提供使用者名稱和密碼' });
        }
        
        const result = await db.register(username, password);
        
        // 設定 cookie
        res.cookie('sessionId', result.sessionId, { 
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7天
            httpOnly: true 
        });
        
        res.json({
            success: true,
            message: '註冊成功！',
            sessionId: result.sessionId,
            user: result.user
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 🔓 登入
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: '請提供使用者名稱和密碼' });
        }
        
        const result = await db.login(username, password);
        
        // 設定 cookie
        res.cookie('sessionId', result.sessionId, { 
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7天
            httpOnly: true 
        });
        
        res.json({
            success: true,
            message: '登入成功！',
            sessionId: result.sessionId,
            user: result.user
        });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

// 🚪 登出
app.post('/api/auth/logout', authMiddleware, async (req, res) => {
    try {
        await db.logout(req.sessionId);
        
        // 清除 cookie
        res.clearCookie('sessionId');
        
        res.json({
            success: true,
            message: '已登出'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 🎲 百家樂下注（需要登入）
app.post('/api/baccarat/bet', authMiddleware, async (req, res) => {
    try {
        const { betOn, amount } = req.body;
        const playerId = req.user.player_id;
        
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
        
        // 檢查餘額
        if (req.user.chips < betAmount) {
            return res.status(400).json({ 
                error: `餘額不足！當前餘額: ${req.user.chips} USDT` 
            });
        }
        
        const result = await baccaratAPI.placeBet(playerId, betOn, betAmount);
        
        // 更新使用者資料
        req.user = await db.updatePlayerChips(
            playerId, 
            result.betDetails.netChange, 
            result.betDetails.winAmount > 0
        );
        
        res.json({
            ...result,
            user: req.user
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 🎰 老虎機（需要登入）
app.post('/api/slots/spin', authMiddleware, async (req, res) => {
    try {
        const { bet } = req.body;
        const playerId = req.user.player_id;
        
        const betAmount = parseInt(bet);
        if (isNaN(betAmount) || betAmount < 10 || betAmount > 1000) {
            return res.status(400).json({ 
                error: '下注金額必須在 10 到 1000 之間' 
            });
        }
        
        // 檢查餘額
        if (req.user.chips < betAmount) {
            return res.status(400).json({ 
                error: `餘額不足！當前餘額: ${req.user.chips} USDT` 
            });
        }
        
        const result = await slotsAPI.spin(playerId, betAmount);
        
        // 更新使用者資料
        req.user = await db.updatePlayerChips(
            playerId, 
            result.winAmount - betAmount, 
            result.winAmount > 0
        );
        
        res.json({
            ...result,
            user: req.user
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 📜 遊戲紀錄（需要登入）
app.get('/api/history', authMiddleware, async (req, res) => {
    try {
        const history = await db.getPlayerHistory(req.user.player_id, 20);
        res.json({ history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 🏆 排行榜（公開）
app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaderboard = await db.getLeaderboard(10);
        res.json({ leaderboard });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 💰 充值籌碼（需要登入）
app.post('/api/topup', authMiddleware, async (req, res) => {
    try {
        const { amount } = req.body;
        const playerId = req.user.player_id;
        
        const topupAmount = parseInt(amount) || 500;
        if (topupAmount < 100 || topupAmount > 5000) {
            return res.status(400).json({ 
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
        res.status(500).json({ error: error.message });
    }
});

// 🎯 遊戲統計（公開）
app.get('/api/stats', async (req, res) => {
    try {
        const leaderboard = await db.getLeaderboard(5);
        res.json({
            leaderboard,
            activePlayers: leaderboard.length,
            totalChipsInPlay: leaderboard.reduce((sum, p) => sum + p.chips, 0)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 錯誤處理
app.use((err, req, res, next) => {
    console.error('伺服器錯誤:', err.stack);
    res.status(500).json({
        error: '伺服器錯誤',
        message: process.env.NODE_ENV === 'development' ? err.message : '請稍後再試'
    });
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: '找不到頁面' });
});

module.exports = app;