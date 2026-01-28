const express = require('express');
const router = express.Router();
const db = require('./database');

// 🔐 管理員驗證 middleware
const adminAuth = async (req, res, next) => {
    try {
        const sessionId = req.headers['session-id'];
        
        if (!sessionId) {
            return res.status(401).json({ 
                success: false,
                error: '請先登入' 
            });
        }
        
        const user = await db.validateSession(sessionId);
        
        if (!user.is_admin) {
            return res.status(403).json({ 
                success: false,
                error: '需要管理員權限' 
            });
        }
        
        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ 
            success: false,
            error: error.message 
        });
    }
};

// 📊 管理員儀表板數據
router.get('/api/admin/dashboard', adminAuth, async (req, res) => {
    try {
        const stats = await db.getSystemStats();
        
        // 最近註冊的玩家
        const recentUsers = await db.allQuery(
            'SELECT player_id, username, chips, created_at FROM users ORDER BY created_at DESC LIMIT 10'
        );
        
        // 最近遊戲記錄
        const recentGames = await db.allQuery(
            `SELECT g.*, u.username 
             FROM game_history g 
             JOIN users u ON g.player_id = u.player_id 
             ORDER BY g.created_at DESC LIMIT 10`
        );
        
        res.json({
            success: true,
            stats,
            recentUsers,
            recentGames: recentGames.map(game => ({
                ...game,
                details: game.details ? JSON.parse(game.details) : null
            }))
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 👥 取得所有玩家列表
router.get('/api/admin/users', adminAuth, async (req, res) => {
    try {
        const users = await db.getAllUsers();
        res.json({ 
            success: true,
            users 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 💰 修改玩家籌碼
router.post('/api/admin/users/:playerId/chips', adminAuth, async (req, res) => {
    try {
        const { playerId } = req.params;
        const { chips } = req.body;
        
        if (!chips || chips < 0) {
            return res.status(400).json({ 
                success: false,
                error: '請提供有效的籌碼數量' 
            });
        }
        
        const updatedUser = await db.adminUpdateChips(playerId, chips);
        
        res.json({
            success: true,
            message: `已更新玩家籌碼為 ${chips}`,
            user: updatedUser
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🗑️ 刪除玩家
router.delete('/api/admin/users/:playerId', adminAuth, async (req, res) => {
    try {
        const { playerId } = req.params;
        
        await db.adminDeleteUser(playerId);
        
        res.json({
            success: true,
            message: '玩家已刪除'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 📜 遊戲歷史記錄
router.get('/api/admin/games/history', adminAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20, playerId, gameType } = req.query;
        const offset = (page - 1) * limit;
        
        let query = `
            SELECT g.*, u.username 
            FROM game_history g 
            JOIN users u ON g.player_id = u.player_id 
        `;
        
        const params = [];
        const conditions = [];
        
        if (playerId) {
            conditions.push('g.player_id = ?');
            params.push(playerId);
        }
        
        if (gameType) {
            conditions.push('g.game_type = ?');
            params.push(gameType);
        }
        
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY g.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);
        
        const history = await db.allQuery(query, params);
        
        // 總數
        let countQuery = 'SELECT COUNT(*) as total FROM game_history g';
        let countParams = [];
        
        if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
            countParams = params.slice(0, -2); // 移除 LIMIT 和 OFFSET 參數
        }
        
        const countResult = await db.getQuery(countQuery, countParams);
        
        res.json({
            success: true,
            history: history.map(game => ({
                ...game,
                details: game.details ? JSON.parse(game.details) : null
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult.total,
                pages: Math.ceil(countResult.total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🔄 重置資料庫
router.post('/api/admin/reset-database', adminAuth, async (req, res) => {
    try {
        const { confirm } = req.body;
        
        if (!confirm || confirm !== 'YES_RESET') {
            return res.status(400).json({ 
                success: false,
                error: '請確認要重置資料庫' 
            });
        }
        
        await db.resetDatabase();
        
        res.json({
            success: true,
            message: '資料庫已成功重置'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 📈 財務報表
router.get('/api/admin/financial/report', adminAuth, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        let query = `
            SELECT 
                game_type,
                COUNT(*) as total_games,
                SUM(bet_amount) as total_bet,
                SUM(win_amount) as total_win,
                SUM(bet_amount - win_amount) as net_profit
            FROM game_history
        `;
        
        const params = [];
        
        if (startDate && endDate) {
            query += ' WHERE created_at BETWEEN ? AND ?';
            params.push(startDate, endDate);
        }
        
        query += ' GROUP BY game_type ORDER BY total_bet DESC';
        
        const report = await db.allQuery(query, params);
        
        // 總計
        const totals = await db.getQuery(`
            SELECT 
                COUNT(*) as total_games,
                SUM(bet_amount) as total_bet,
                SUM(win_amount) as total_win,
                SUM(bet_amount - win_amount) as net_profit
            FROM game_history
            ${startDate && endDate ? 'WHERE created_at BETWEEN ? AND ?' : ''}
        `, startDate && endDate ? [startDate, endDate] : []);
        
        res.json({
            success: true,
            report,
            totals
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 新增路由：遊戲設定管理

// 🎮 取得遊戲設定列表
router.get('/api/admin/game-settings', adminAuth, async (req, res) => {
    try {
        const games = await db.getGameSettings();
        res.json({ 
            success: true,
            games 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🎮 取得單一遊戲設定
router.get('/api/admin/game-settings/:gameId', adminAuth, async (req, res) => {
    try {
        const { gameId } = req.params;
        const game = await db.getGameSettings(gameId);
        
        if (!game) {
            return res.status(404).json({ 
                success: false,
                error: '遊戲設定不存在' 
            });
        }
        
        res.json({ 
            success: true,
            game 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🎮 更新遊戲設定
router.put('/api/admin/game-settings/:gameId', adminAuth, async (req, res) => {
    try {
        const { gameId } = req.params;
        const settings = req.body;
        
        // 驗證設定值
        const validationErrors = [];
        
        if (settings.win_rate && (settings.win_rate < 0 || settings.win_rate > 100)) {
            validationErrors.push('勝率必須在 0-100 之間');
        }
        
        if (settings.volatility && (settings.volatility < 0 || settings.volatility > 100)) {
            validationErrors.push('波動率必須在 0-100 之間');
        }
        
        if (settings.min_bet && settings.min_bet < 1) {
            validationErrors.push('最低下注必須大於 0');
        }
        
        if (settings.max_bet && settings.max_bet <= settings.min_bet) {
            validationErrors.push('最高下注必須大於最低下注');
        }
        
        if (validationErrors.length > 0) {
            return res.status(400).json({ 
                success: false,
                errors: validationErrors 
            });
        }
        
        const updatedGame = await db.updateGameSettings(gameId, settings);
        
        // 更新系統設置中的快取時間戳
        await db.runQuery(
            'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)',
            ['game_settings_updated', new Date().toISOString()]
        );
        
        res.json({
            success: true,
            message: '遊戲設定已更新',
            game: updatedGame
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🎯 取得公共圖標
router.get('/api/admin/icons', adminAuth, async (req, res) => {
    try {
        const { category } = req.query;
        const icons = await db.getPublicIcons(category);
        
        res.json({ 
            success: true,
            icons 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🎯 新增圖標
router.post('/api/admin/icons', adminAuth, async (req, res) => {
    try {
        const { icon_id, icon_name, icon_code, category } = req.body;
        
        if (!icon_id || !icon_name || !icon_code) {
            return res.status(400).json({ 
                success: false,
                error: '請提供完整的圖標資訊' 
            });
        }
        
        await db.addIcon({ icon_id, icon_name, icon_code, category: category || 'general' });
        
        res.json({
            success: true,
            message: '圖標已新增'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🎯 更新圖標
router.put('/api/admin/icons/:iconId', adminAuth, async (req, res) => {
    try {
        const { iconId } = req.params;
        const data = req.body;
        
        await db.updateIcon(iconId, data);
        
        res.json({
            success: true,
            message: '圖標已更新'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🎯 刪除圖標
router.delete('/api/admin/icons/:iconId', adminAuth, async (req, res) => {
    try {
        const { iconId } = req.params;
        
        await db.deleteIcon(iconId);
        
        res.json({
            success: true,
            message: '圖標已刪除'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 🎯 批量匯入圖標
router.post('/api/admin/icons/batch-import', adminAuth, async (req, res) => {
    try {
        const { icons } = req.body;
        
        if (!Array.isArray(icons)) {
            return res.status(400).json({ 
                success: false,
                error: '請提供圖標陣列' 
            });
        }
        
        let imported = 0;
        let skipped = 0;
        
        for (const icon of icons) {
            try {
                // 檢查是否已存在
                const existing = await db.getQuery(
                    'SELECT * FROM public_icons WHERE icon_code = ?',
                    [icon.icon_code]
                );
                
                if (!existing) {
                    await db.addIcon({
                        icon_id: `icon_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
                        icon_name: icon.icon_name || icon.icon_code,
                        icon_code: icon.icon_code,
                        category: icon.category || 'general'
                    });
                    imported++;
                } else {
                    skipped++;
                }
            } catch (error) {
                console.error('匯入圖標失敗:', error);
            }
        }
        
        res.json({
            success: true,
            message: `圖標匯入完成`,
            summary: {
                imported,
                skipped,
                total: icons.length
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 📊 取得設定儀表板統計
router.get('/api/admin/settings/stats', adminAuth, async (req, res) => {
    try {
        // 活躍遊戲數
        const activeGames = await db.getQuery(
            'SELECT COUNT(*) as count FROM game_settings WHERE is_active = 1'
        );
        
        // 總圖標數
        const totalIcons = await db.getQuery(
            'SELECT COUNT(*) as count FROM public_icons WHERE is_active = 1'
        );
        
        // 按分類統計圖標
        const iconsByCategory = await db.allQuery(
            'SELECT category, COUNT(*) as count FROM public_icons WHERE is_active = 1 GROUP BY category'
        );
        
        // 最後更新時間
        const lastUpdated = await db.getQuery(
            'SELECT value FROM system_settings WHERE key = ?',
            ['game_settings_updated']
        );
        
        res.json({
            success: true,
            stats: {
                activeGames: activeGames.count,
                totalIcons: totalIcons.count,
                iconsByCategory,
                lastUpdated: lastUpdated ? lastUpdated.value : null
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

module.exports = router;