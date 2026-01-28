const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

class SQLiteAuthDatabase {
    constructor() {
        this.db = null;
        this.init();
    }
    
    async init() {
        return new Promise((resolve, reject) => {
            const dbPath = path.join(__dirname, 'casino.db');
            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('❌ 資料庫連接失敗:', err.message);
                    reject(err);
                    return;
                }
                
                console.log('✅ SQLite 資料庫連接成功');
                
                // 啟用外鍵
                this.db.run('PRAGMA foreign_keys = ON');
                
                // 建立所有表格
                this.createTables().then(() => {
                    console.log('📊 資料庫表格準備就緒');
                    resolve();
                }).catch(reject);
            });
        });
    }
    
    async createTables() {
        return new Promise((resolve, reject) => {
            // 1. 使用者表格
            this.db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    player_id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    chips INTEGER DEFAULT 1000,
                    wins INTEGER DEFAULT 0,
                    losses INTEGER DEFAULT 0,
                    total_bet INTEGER DEFAULT 0,
                    is_admin BOOLEAN DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_login DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                // 2. 登入會話表格
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS sessions (
                        session_id TEXT PRIMARY KEY,
                        player_id TEXT NOT NULL,
                        user_agent TEXT,
                        ip_address TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        expires_at DATETIME NOT NULL,
                        FOREIGN KEY (player_id) REFERENCES users(player_id) ON DELETE CASCADE
                    )
                `, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    // 3. 遊戲歷史表格
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS game_history (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            player_id TEXT NOT NULL,
                            game_type TEXT NOT NULL,
                            bet_amount INTEGER NOT NULL,
                            win_amount INTEGER NOT NULL,
                            result TEXT NOT NULL,
                            details TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (player_id) REFERENCES users(player_id) ON DELETE CASCADE
                        )
                    `, (err) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        
                        // 4. 充值訂單表格
                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS deposit_orders (
                                order_id TEXT PRIMARY KEY,
                                player_id TEXT NOT NULL,
                                amount INTEGER NOT NULL,
                                bonus INTEGER DEFAULT 0,
                                total_amount INTEGER NOT NULL,
                                payment_method TEXT NOT NULL,
                                wallet_address TEXT,
                                status TEXT DEFAULT 'pending',
                                notes TEXT,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                expires_at DATETIME NOT NULL,
                                completed_at DATETIME,
                                FOREIGN KEY (player_id) REFERENCES users(player_id) ON DELETE CASCADE
                            )
                        `, (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            
                            // 5. 系統設置表格
                            this.db.run(`
                                CREATE TABLE IF NOT EXISTS system_settings (
                                    key TEXT PRIMARY KEY,
                                    value TEXT NOT NULL,
                                    description TEXT,
                                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                )
                            `, (err) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                
                                // 建立預設管理員帳號
                                this.createDefaultAdmin().then(resolve).catch(reject);
                            });
                        });
                    });
                });
            });
        });
    }
    
    // 🔐 密碼加密
    hashPassword(password, salt = null) {
        if (!salt) {
            salt = crypto.randomBytes(16).toString('hex');
        }
        const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
        return { hash, salt };
    }
    
    // 👑 建立預設管理員帳號
    async createDefaultAdmin() {
        return new Promise((resolve, reject) => {
            const adminUsername = 'admin';
            const adminPassword = 'admin123';
            
            // 檢查是否已存在管理員
            this.db.get('SELECT * FROM users WHERE username = ?', [adminUsername], async (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                if (!row) {
                    try {
                        const { hash, salt } = this.hashPassword(adminPassword);
                        const playerId = `admin_${Date.now()}`;
                        
                        await this.runQuery(
                            `INSERT INTO users (player_id, username, password_hash, salt, chips, is_admin) 
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [playerId, adminUsername, hash, salt, 100000, 1]
                        );
                        
                        console.log('👑 預設管理員帳號已建立');
                    } catch (error) {
                        console.error('建立管理員帳號失敗:', error);
                    }
                }
                resolve();
            });
        });
    }
    
    // 🔄 重置資料庫
    async resetDatabase() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('DROP TABLE IF EXISTS game_history');
                this.db.run('DROP TABLE IF EXISTS deposit_orders');
                this.db.run('DROP TABLE IF EXISTS sessions');
                this.db.run('DROP TABLE IF EXISTS system_settings');
                this.db.run('DROP TABLE IF EXISTS users');
                
                this.createTables().then(() => {
                    console.log('🔄 資料庫已重置');
                    resolve();
                }).catch(reject);
            });
        });
    }
    
    // 🔑 註冊新使用者
    async register(username, password) {
        return new Promise(async (resolve, reject) => {
            try {
                // 檢查使用者名稱是否已存在
                const existingUser = await this.getQuery('SELECT * FROM users WHERE username = ?', [username]);
                if (existingUser) {
                    throw new Error('使用者名稱已存在');
                }
                
                if (password.length < 6) {
                    throw new Error('密碼至少需要6個字元');
                }
                
                // 加密密碼
                const { hash, salt } = this.hashPassword(password);
                const playerId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                // 建立新使用者
                await this.runQuery(
                    `INSERT INTO users (player_id, username, password_hash, salt, chips) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [playerId, username, hash, salt, 1000]
                );
                
                // 取得使用者資料
                const user = await this.getQuery('SELECT * FROM users WHERE player_id = ?', [playerId]);
                
                // 建立 session
                const sessionId = await this.createSession(playerId);
                
                resolve({
                    sessionId,
                    user: this.sanitizeUser(user)
                });
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 🔓 登入
    async login(username, password) {
        return new Promise(async (resolve, reject) => {
            try {
                // 尋找使用者
                const user = await this.getQuery('SELECT * FROM users WHERE username = ?', [username]);
                if (!user) {
                    throw new Error('使用者名稱或密碼錯誤');
                }
                
                // 驗證密碼
                const { hash } = this.hashPassword(password, user.salt);
                if (hash !== user.password_hash) {
                    throw new Error('使用者名稱或密碼錯誤');
                }
                
                // 更新最後登入時間
                await this.runQuery(
                    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE player_id = ?',
                    [user.player_id]
                );
                
                // 建立 session
                const sessionId = await this.createSession(user.player_id);
                
                resolve({
                    sessionId,
                    user: this.sanitizeUser(user)
                });
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 🆔 建立 session
    async createSession(playerId, userAgent = '', ipAddress = '') {
        return new Promise(async (resolve, reject) => {
            try {
                const sessionId = `sess_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                
                await this.runQuery(
                    `INSERT INTO sessions (session_id, player_id, user_agent, ip_address, expires_at) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [sessionId, playerId, userAgent, ipAddress, expiresAt.toISOString()]
                );
                
                // 清理過期 session
                this.cleanExpiredSessions();
                
                resolve(sessionId);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 🧹 清理過期 session
    async cleanExpiredSessions() {
        try {
            await this.runQuery('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
        } catch (error) {
            console.error('清理 session 失敗:', error);
        }
    }
    
    // 👤 驗證 session
    async validateSession(sessionId) {
        return new Promise(async (resolve, reject) => {
            try {
                // 取得 session
                const session = await this.getQuery(
                    'SELECT * FROM sessions WHERE session_id = ?',
                    [sessionId]
                );
                
                if (!session) {
                    throw new Error('無效的登入狀態');
                }
                
                // 檢查是否過期
                if (new Date(session.expires_at) < new Date()) {
                    await this.runQuery('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
                    throw new Error('登入已過期，請重新登入');
                }
                
                // 取得使用者資料
                const user = await this.getQuery(
                    'SELECT * FROM users WHERE player_id = ?',
                    [session.player_id]
                );
                
                if (!user) {
                    throw new Error('使用者不存在');
                }
                
                // 更新 session 時間
                const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                await this.runQuery(
                    'UPDATE sessions SET expires_at = ? WHERE session_id = ?',
                    [newExpiresAt.toISOString(), sessionId]
                );
                
                resolve(this.sanitizeUser(user));
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 🚪 登出
    async logout(sessionId) {
        try {
            await this.runQuery('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
            return true;
        } catch (error) {
            throw new Error('登出失敗');
        }
    }
    
    // 💰 更新籌碼
    async updatePlayerChips(playerId, chipChange, isWin = false) {
        return new Promise(async (resolve, reject) => {
            try {
                // 開始交易
                await this.runQuery('BEGIN TRANSACTION');
                
                // 取得當前玩家資料
                const player = await this.getQuery('SELECT * FROM users WHERE player_id = ?', [playerId]);
                if (!player) {
                    throw new Error('玩家不存在');
                }
                
                // 更新籌碼
                const newChips = player.chips + chipChange;
                
                // 更新勝負記錄
                let wins = player.wins;
                let losses = player.losses;
                let totalBet = player.total_bet + Math.abs(chipChange);
                
                if (isWin) {
                    wins += 1;
                } else if (chipChange < 0) {
                    losses += 1;
                }
                
                await this.runQuery(
                    `UPDATE users 
                     SET chips = ?, wins = ?, losses = ?, total_bet = ?, last_login = CURRENT_TIMESTAMP 
                     WHERE player_id = ?`,
                    [newChips, wins, losses, totalBet, playerId]
                );
                
                // 提交交易
                await this.runQuery('COMMIT');
                
                // 返回更新後的玩家資料
                const updatedPlayer = await this.getQuery('SELECT * FROM users WHERE player_id = ?', [playerId]);
                resolve(this.sanitizeUser(updatedPlayer));
            } catch (error) {
                await this.runQuery('ROLLBACK');
                reject(error);
            }
        });
    }
    
    // 📜 遊戲紀錄
    async saveGameHistory(record) {
        return new Promise(async (resolve, reject) => {
            try {
                const details = typeof record.details === 'object' 
                    ? JSON.stringify(record.details) 
                    : record.details;
                
                await this.runQuery(
                    `INSERT INTO game_history (player_id, game_type, bet_amount, win_amount, result, details) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [record.player_id, record.game_type, record.bet_amount, record.win_amount, record.result, details]
                );
                
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }
    
    async getPlayerHistory(playerId, limit = 10) {
        return new Promise(async (resolve, reject) => {
            try {
                const history = await this.allQuery(
                    `SELECT * FROM game_history 
                     WHERE player_id = ? 
                     ORDER BY created_at DESC 
                     LIMIT ?`,
                    [playerId, limit]
                );
                
                const formattedHistory = history.map(record => ({
                    ...record,
                    details: record.details ? JSON.parse(record.details) : null
                }));
                
                resolve(formattedHistory);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 🏆 排行榜
    async getLeaderboard(limit = 10) {
        return new Promise(async (resolve, reject) => {
            try {
                const leaderboard = await this.allQuery(
                    `SELECT player_id, username, chips, wins, losses, total_bet 
                     FROM users 
                     WHERE chips > 0 
                     ORDER BY chips DESC 
                     LIMIT ?`,
                    [limit]
                );
                
                resolve(leaderboard.map((player, index) => ({
                    ...player,
                    rank: index + 1
                })));
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 👥 取得所有使用者（管理員用）
    async getAllUsers() {
        return new Promise(async (resolve, reject) => {
            try {
                const users = await this.allQuery(
                    'SELECT player_id, username, chips, wins, losses, total_bet, is_admin, created_at, last_login FROM users'
                );
                resolve(users);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 📊 取得系統統計
    async getSystemStats() {
        return new Promise(async (resolve, reject) => {
            try {
                const stats = {};
                
                // 總玩家數
                const totalUsers = await this.getQuery('SELECT COUNT(*) as count FROM users');
                stats.totalUsers = totalUsers.count;
                
                // 總籌碼
                const totalChips = await this.getQuery('SELECT SUM(chips) as total FROM users');
                stats.totalChips = totalChips.total || 0;
                
                // 總下注
                const totalBet = await this.getQuery('SELECT SUM(total_bet) as total FROM users');
                stats.totalBet = totalBet.total || 0;
                
                // 今日註冊數
                const todayRegistrations = await this.getQuery(
                    'SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = DATE("now")'
                );
                stats.todayRegistrations = todayRegistrations.count;
                
                // 活躍玩家（最近7天）
                const activePlayers = await this.getQuery(
                    `SELECT COUNT(DISTINCT player_id) as count 
                     FROM game_history 
                     WHERE DATE(created_at) >= DATE("now", "-7 days")`
                );
                stats.activePlayers = activePlayers.count;
                
                resolve(stats);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 👑 管理員功能：修改玩家籌碼
    async adminUpdateChips(playerId, newChips) {
        return new Promise(async (resolve, reject) => {
            try {
                await this.runQuery(
                    'UPDATE users SET chips = ?, last_login = CURRENT_TIMESTAMP WHERE player_id = ?',
                    [newChips, playerId]
                );
                
                const updatedUser = await this.getQuery('SELECT * FROM users WHERE player_id = ?', [playerId]);
                resolve(this.sanitizeUser(updatedUser));
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 👑 管理員功能：刪除使用者
    async adminDeleteUser(playerId) {
        return new Promise(async (resolve, reject) => {
            try {
                await this.runQuery('DELETE FROM users WHERE player_id = ?', [playerId]);
                resolve(true);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 🛡️ 移除敏感資訊
    sanitizeUser(user) {
        if (!user) return null;
        
        const { password_hash, salt, ...sanitizedUser } = user;
        return sanitizedUser;
    }
    
    // 🛠️ 通用查詢方法
    runQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }
    
    getQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
    
    allQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    // 在 createTables 函數中，加入遊戲設定表格：

// 6. 遊戲設定表格
this.db.run(`
    CREATE TABLE IF NOT EXISTS game_settings (
        game_id TEXT PRIMARY KEY,
        game_name TEXT NOT NULL,
        win_rate DECIMAL(5,2) DEFAULT 45.00,
        volatility DECIMAL(5,2) DEFAULT 50.00,
        min_bet INTEGER DEFAULT 10,
        max_bet INTEGER DEFAULT 1000,
        jackpot_chance DECIMAL(5,2) DEFAULT 0.10,
        is_active BOOLEAN DEFAULT 1,
        description TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        reject(err);
        return;
    }
    
    // 7. 公共圖標設定表格
    this.db.run(`
        CREATE TABLE IF NOT EXISTS public_icons (
            icon_id TEXT PRIMARY KEY,
            icon_name TEXT NOT NULL,
            icon_code TEXT NOT NULL,
            category TEXT,
            is_active BOOLEAN DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            reject(err);
            return;
        }
        
        // 建立預設遊戲設定
        this.createDefaultGameSettings().then(resolve).catch(reject);
    });
});

// 新增函數：建立預設遊戲設定
async createDefaultGameSettings() {
    const defaultGames = [
        {
            game_id: 'baccarat',
            game_name: '開心百家樂',
            win_rate: 45.0,
            volatility: 50.0,
            min_bet: 50,
            max_bet: 5000,
            jackpot_chance: 0.5,
            description: '經典卡牌遊戲，莊家抽水 5%，和局 1:8'
        },
        {
            game_id: 'slots',
            game_name: '幸運老虎機',
            win_rate: 48.0,
            volatility: 60.0,
            min_bet: 10,
            max_bet: 1000,
            jackpot_chance: 0.3,
            description: '簡單刺激的拉霸遊戲，三個鑽石贏得 30 倍獎勵'
        },
        {
            game_id: 'blackjack',
            game_name: '21點',
            win_rate: 46.5,
            volatility: 40.0,
            min_bet: 20,
            max_bet: 2000,
            jackpot_chance: 0.2,
            description: '考驗技術與策略的撲克遊戲'
        },
        {
            game_id: 'roulette',
            game_name: '輪盤賭',
            win_rate: 47.0,
            volatility: 70.0,
            min_bet: 5,
            max_bet: 500,
            jackpot_chance: 0.1,
            description: '經典輪盤遊戲，36 倍超高賠率'
        }
    ];
    
    for (const game of defaultGames) {
        try {
            await this.runQuery(
                `INSERT OR IGNORE INTO game_settings 
                 (game_id, game_name, win_rate, volatility, min_bet, max_bet, jackpot_chance, description) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [game.game_id, game.game_name, game.win_rate, game.volatility, 
                 game.min_bet, game.max_bet, game.jackpot_chance, game.description]
            );
        } catch (error) {
            console.error(`建立遊戲設定失敗 ${game.game_id}:`, error);
        }
    }
    
    // 建立預設圖標
    const defaultIcons = [
        { icon_id: 'chip', icon_name: '籌碼', icon_code: '💰', category: 'general' },
        { icon_id: 'diamond', icon_name: '鑽石', icon_code: '💎', category: 'general' },
        { icon_id: 'money', icon_name: '金錢', icon_code: '💵', category: 'general' },
        { icon_id: 'coin', icon_name: '硬幣', icon_code: '🪙', category: 'general' },
        { icon_id: 'cherry', icon_name: '櫻桃', icon_code: '🍒', category: 'slots' },
        { icon_id: 'lemon', icon_name: '檸檬', icon_code: '🍋', category: 'slots' },
        { icon_id: 'star', icon_name: '星星', icon_code: '⭐', category: 'slots' },
        { icon_id: 'bell', icon_name: '鈴鐺', icon_code: '🔔', category: 'slots' },
        { icon_id: 'seven', icon_name: '七', icon_code: '7️⃣', category: 'slots' },
        { icon_id: 'card', icon_name: '撲克牌', icon_code: '🃏', category: 'cards' },
        { icon_id: 'dice', icon_name: '骰子', icon_code: '🎲', category: 'dice' },
        { icon_id: 'slot', icon_name: '老虎機', icon_code: '🎰', category: 'slots' },
        { icon_id: 'trophy', icon_name: '獎杯', icon_code: '🏆', category: 'general' },
        { icon_id: 'crown', icon_name: '皇冠', icon_code: '👑', category: 'general' },
        { icon_id: 'fire', icon_name: '火焰', icon_code: '🔥', category: 'general' }
    ];
    
    for (const [index, icon] of defaultIcons.entries()) {
        try {
            await this.runQuery(
                `INSERT OR IGNORE INTO public_icons 
                 (icon_id, icon_name, icon_code, category, sort_order) 
                 VALUES (?, ?, ?, ?, ?)`,
                [icon.icon_id, icon.icon_name, icon.icon_code, icon.category, index]
            );
        } catch (error) {
            console.error(`建立圖標失敗 ${icon.icon_id}:`, error);
        }
    }
}

// 新增函數：取得遊戲設定
async getGameSettings(gameId = null) {
    return new Promise(async (resolve, reject) => {
        try {
            if (gameId) {
                const game = await this.getQuery(
                    'SELECT * FROM game_settings WHERE game_id = ?',
                    [gameId]
                );
                resolve(game);
            } else {
                const games = await this.allQuery(
                    'SELECT * FROM game_settings ORDER BY game_name'
                );
                resolve(games);
            }
        } catch (error) {
            reject(error);
        }
    });
}

// 新增函數：更新遊戲設定
async updateGameSettings(gameId, settings) {
    return new Promise(async (resolve, reject) => {
        try {
            const { win_rate, volatility, min_bet, max_bet, jackpot_chance, is_active } = settings;
            
            await this.runQuery(
                `UPDATE game_settings 
                 SET win_rate = ?, volatility = ?, min_bet = ?, max_bet = ?, 
                     jackpot_chance = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE game_id = ?`,
                [win_rate, volatility, min_bet, max_bet, jackpot_chance, is_active, gameId]
            );
            
            const updated = await this.getQuery(
                'SELECT * FROM game_settings WHERE game_id = ?',
                [gameId]
            );
            resolve(updated);
        } catch (error) {
            reject(error);
        }
    });
}

// 新增函數：取得公共圖標
async getPublicIcons(category = null) {
    return new Promise(async (resolve, reject) => {
        try {
            let query = 'SELECT * FROM public_icons WHERE is_active = 1';
            const params = [];
            
            if (category) {
                query += ' AND category = ?';
                params.push(category);
            }
            
            query += ' ORDER BY sort_order, icon_name';
            
            const icons = await this.allQuery(query, params);
            resolve(icons);
        } catch (error) {
            reject(error);
        }
    });
}

// 新增函數：更新圖標
async updateIcon(iconId, data) {
    return new Promise(async (resolve, reject) => {
        try {
            const { icon_name, icon_code, category, sort_order, is_active } = data;
            
            await this.runQuery(
                `UPDATE public_icons 
                 SET icon_name = ?, icon_code = ?, category = ?, sort_order = ?, is_active = ?
                 WHERE icon_id = ?`,
                [icon_name, icon_code, category, sort_order, is_active, iconId]
            );
            
            resolve(true);
        } catch (error) {
            reject(error);
        }
    });
}

// 新增函數：新增圖標
async addIcon(data) {
    return new Promise(async (resolve, reject) => {
        try {
            const { icon_id, icon_name, icon_code, category } = data;
            
            await this.runQuery(
                `INSERT INTO public_icons (icon_id, icon_name, icon_code, category) 
                 VALUES (?, ?, ?, ?)`,
                [icon_id, icon_name, icon_code, category]
            );
            
            resolve(true);
        } catch (error) {
            reject(error);
        }
    });
}

// 新增函數：刪除圖標
async deleteIcon(iconId) {
    return new Promise(async (resolve, reject) => {
        try {
            await this.runQuery('DELETE FROM public_icons WHERE icon_id = ?', [iconId]);
            resolve(true);
        } catch (error) {
            reject(error);
        }
    });
}
}

// 匯出單例
const database = new SQLiteAuthDatabase();
module.exports = database;