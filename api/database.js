const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

class Database {
    constructor() {
        this.db = new sqlite3.Database(path.join(__dirname, 'casino.db'));
        this.initDatabase();
    }

    initDatabase() {
        // 玩家資料表
        this.db.run(`
            CREATE TABLE IF NOT EXISTS players (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id TEXT UNIQUE,
                username TEXT UNIQUE,
                chips INTEGER DEFAULT 1000,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                total_bet INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 遊戲紀錄
        this.db.run(`
            CREATE TABLE IF NOT EXISTS game_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id TEXT,
                game_type TEXT,
                bet_amount INTEGER,
                win_amount INTEGER,
                result TEXT,
                details TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player_id) REFERENCES players(player_id)
            )
        `);

        // 百家樂牌局紀錄
        this.db.run(`
            CREATE TABLE IF NOT EXISTS baccarat_games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT UNIQUE,
                player_cards TEXT,
                banker_cards TEXT,
                player_points INTEGER,
                banker_points INTEGER,
                result TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    // 玩家相關方法
    async getOrCreatePlayer(playerId, username = null) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM players WHERE player_id = ?',
                [playerId],
                async (err, row) => {
                    if (err) reject(err);
                    
                    if (!row) {
                        // 創建新玩家
                        const newPlayer = {
                            player_id: playerId,
                            username: username || `玩家_${Date.now()}`,
                            chips: 1000,
                            wins: 0,
                            losses: 0,
                            total_bet: 0
                        };
                        
                        await this.createPlayer(newPlayer);
                        resolve(newPlayer);
                    } else {
                        resolve(row);
                    }
                }
            );
        });
    }

    async createPlayer(player) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO players (player_id, username, chips, wins, losses, total_bet) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [player.player_id, player.username, player.chips, player.wins, player.losses, player.total_bet],
                function(err) {
                    if (err) reject(err);
                    resolve({ id: this.lastID, ...player });
                }
            );
        });
    }

    async updatePlayerChips(playerId, chipChange, isWin = false) {
        return new Promise((resolve, reject) => {
            // 先取得當前籌碼
            this.db.get(
                'SELECT chips, wins, losses FROM players WHERE player_id = ?',
                [playerId],
                (err, player) => {
                    if (err) reject(err);
                    
                    const newChips = player.chips + chipChange;
                    const updates = {
                        chips: newChips,
                        wins: isWin ? player.wins + 1 : player.wins,
                        losses: !isWin && chipChange < 0 ? player.losses + 1 : player.losses,
                        total_bet: player.total_bet + Math.abs(chipChange)
                    };
                    
                    this.db.run(
                        `UPDATE players SET 
                         chips = ?, wins = ?, losses = ?, total_bet = ?,
                         last_login = CURRENT_TIMESTAMP
                         WHERE player_id = ?`,
                        [updates.chips, updates.wins, updates.losses, updates.total_bet, playerId],
                        (updateErr) => {
                            if (updateErr) reject(updateErr);
                            resolve({ ...player, ...updates });
                        }
                    );
                }
            );
        });
    }

    // 遊戲紀錄
    async saveGameHistory(record) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO game_history 
                 (player_id, game_type, bet_amount, win_amount, result, details) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    record.player_id,
                    record.game_type,
                    record.bet_amount,
                    record.win_amount,
                    record.result,
                    JSON.stringify(record.details || {})
                ],
                function(err) {
                    if (err) reject(err);
                    resolve(this.lastID);
                }
            );
        });
    }

    async getPlayerHistory(playerId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM game_history 
                 WHERE player_id = ? 
                 ORDER BY created_at DESC 
                 LIMIT ?`,
                [playerId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                }
            );
        });
    }

    async getLeaderboard(limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT username, chips, wins, losses, total_bet,
                 RANK() OVER (ORDER BY chips DESC) as rank
                 FROM players 
                 ORDER BY chips DESC 
                 LIMIT ?`,
                [limit],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                }
            );
        });
    }
}

module.exports = new Database();