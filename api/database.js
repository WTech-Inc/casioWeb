// api/database.js - 記憶體版本
class MemoryAuthDatabase {
    constructor() {
        // 記憶體儲存
        this.users = new Map();      // player_id -> 使用者資料
        this.sessions = new Map();   // session_id -> player_id
        this.gameHistory = [];       // 遊戲紀錄
        
        // 預設測試帳號
        this.createTestAccounts();
        
        console.log('🔐 記憶體認證系統已啟動');
    }
    
    createTestAccounts() {
        // 預設測試帳號
        const testAccounts = [
            { username: '玩家一', password: '123456', chips: 5000 },
            { username: '玩家二', password: '654321', chips: 3000 },
            { username: '測試員', password: 'test123', chips: 10000 }
        ];
        
        testAccounts.forEach(acc => {
            const playerId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.users.set(playerId, {
                player_id: playerId,
                username: acc.username,
                password: acc.password, // 實際應該要加密
                chips: acc.chips,
                wins: 0,
                losses: 0,
                total_bet: 0,
                created_at: new Date().toISOString(),
                last_login: new Date().toISOString()
            });
        });
    }
    
    // 🔑 註冊新使用者
    async register(username, password) {
        // 檢查使用者名稱是否已存在
        const existingUser = Array.from(this.users.values())
            .find(u => u.username === username);
        
        if (existingUser) {
            throw new Error('使用者名稱已存在');
        }
        
        if (password.length < 6) {
            throw new Error('密碼至少需要6個字元');
        }
        
        // 建立新使用者
        const playerId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newUser = {
            player_id: playerId,
            username: username,
            password: password, // 注意：實際應用應該加密！
            chips: 1000, // 初始籌碼
            wins: 0,
            losses: 0,
            total_bet: 0,
            created_at: new Date().toISOString(),
            last_login: new Date().toISOString()
        };
        
        this.users.set(playerId, newUser);
        
        // 建立 session
        const sessionId = this.createSession(playerId);
        
        return {
            sessionId,
            user: { ...newUser, password: undefined } // 不返回密碼
        };
    }
    
    // 🔓 登入
    async login(username, password) {
        // 尋找使用者
        const user = Array.from(this.users.values())
            .find(u => u.username === username && u.password === password);
        
        if (!user) {
            throw new Error('使用者名稱或密碼錯誤');
        }
        
        // 更新最後登入時間
        user.last_login = new Date().toISOString();
        this.users.set(user.player_id, user);
        
        // 建立 session
        const sessionId = this.createSession(user.player_id);
        
        return {
            sessionId,
            user: { ...user, password: undefined }
        };
    }
    
    // 🆔 建立 session
    createSession(playerId) {
        const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
        this.sessions.set(sessionId, {
            player_id: playerId,
            created_at: Date.now(),
            expires_at: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7天過期
        });
        
        // 定期清理過期 session
        this.cleanExpiredSessions();
        
        return sessionId;
    }
    
    // 🧹 清理過期 session
    cleanExpiredSessions() {
        const now = Date.now();
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.expires_at < now) {
                this.sessions.delete(sessionId);
            }
        }
    }
    
    // 👤 驗證 session
    async validateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        
        if (!session) {
            throw new Error('無效的登入狀態');
        }
        
        // 檢查是否過期
        if (session.expires_at < Date.now()) {
            this.sessions.delete(sessionId);
            throw new Error('登入已過期，請重新登入');
        }
        
        // 取得使用者資料
        const user = this.users.get(session.player_id);
        if (!user) {
            throw new Error('使用者不存在');
        }
        
        // 更新 session 時間
        session.expires_at = Date.now() + (7 * 24 * 60 * 60 * 1000);
        
        return {
            ...user,
            password: undefined // 不返回密碼
        };
    }
    
    // 🚪 登出
    async logout(sessionId) {
        this.sessions.delete(sessionId);
        return true;
    }
    
    // 💰 更新籌碼
    async updatePlayerChips(playerId, chipChange, isWin = false) {
        const player = this.users.get(playerId);
        if (!player) {
            throw new Error('玩家不存在');
        }
        
        player.chips += chipChange;
        
        if (isWin) {
            player.wins += 1;
        } else if (chipChange < 0) {
            player.losses += 1;
        }
        
        player.total_bet += Math.abs(chipChange);
        player.last_login = new Date().toISOString();
        
        return player;
    }
    
    // 📜 遊戲紀錄
    async saveGameHistory(record) {
        const historyEntry = {
            id: this.gameHistory.length + 1,
            ...record,
            created_at: new Date().toISOString()
        };
        this.gameHistory.push(historyEntry);
        return historyEntry.id;
    }
    
    async getPlayerHistory(playerId, limit = 10) {
        return this.gameHistory
            .filter(h => h.player_id === playerId)
            .slice(0, limit)
            .map(h => ({
                ...h,
                details: typeof h.details === 'string' ? JSON.parse(h.details) : h.details
            }));
    }
    
    // 🏆 排行榜
    async getLeaderboard(limit = 10) {
        return Array.from(this.users.values())
            .filter(u => u.chips > 0)
            .sort((a, b) => b.chips - a.chips)
            .slice(0, limit)
            .map((player, index) => ({
                ...player,
                password: undefined,
                rank: index + 1
            }));
    }
    
    // 👥 取得所有使用者（除錯用）
    getAllUsers() {
        return Array.from(this.users.values()).map(u => ({
            ...u,
            password: undefined
        }));
    }
}

// 匯出單例
module.exports = new MemoryAuthDatabase();