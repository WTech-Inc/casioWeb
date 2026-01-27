const db = require('../database');

class BaccaratGame {
    constructor() {
        this.cards = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
        this.fourDecks = new Array(208);
        this.currentIndex = 0;
        this.initDecks(4);
        this.shuffleCards();
    }

    // 初始化牌組（4副牌）
    initDecks(numDecks) {
        let index = 0;
        for (let deck = 0; deck < numDecks; deck++) {
            for (let i = 0; i < this.cards.length; i++) {
                for (let j = 0; j < 4; j++) {
                    this.fourDecks[index++] = this.cards[i];
                }
            }
        }
    }

    // 洗牌
    shuffleCards() {
        for (let i = this.fourDecks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.fourDecks[i], this.fourDecks[j]] = [this.fourDecks[j], this.fourDecks[i]];
        }
        this.currentIndex = 0;
    }

    // 抽牌
    drawCard() {
        if (this.currentIndex >= this.fourDecks.length - 10) {
            this.shuffleCards();
        }
        return this.fourDecks[this.currentIndex++];
    }

    // 計算點數
    calculatePoints(cards) {
        let points = 0;
        for (const card of cards) {
            if (!card) continue;
            
            switch (card) {
                case "A": points += 1; break;
                case "K": case "Q": case "J": case "10": points += 0; break;
                case "9": points += 9; break;
                case "8": points += 8; break;
                case "7": points += 7; break;
                case "6": points += 6; break;
                case "5": points += 5; break;
                case "4": points += 4; break;
                case "3": points += 3; break;
                case "2": points += 2; break;
            }
        }
        return points % 10;
    }

    // 計算前兩張牌點數
    calculateFirstTwoPoints(cards) {
        if (cards.length < 2) return 0;
        return this.calculatePoints(cards.slice(0, 2));
    }

    // 進行一局遊戲
    playRound(betOn) {
        const playerCards = [];
        const bankerCards = [];

        // 發前兩張牌
        playerCards.push(this.drawCard());
        playerCards.push(this.drawCard());
        bankerCards.push(this.drawCard());
        bankerCards.push(this.drawCard());

        // 閒家補牌規則
        const playerPoints = this.calculateFirstTwoPoints(playerCards);
        if (playerPoints <= 5) {
            playerCards.push(this.drawCard());
        }

        // 莊家補牌規則
        const bankerPoints = this.calculateFirstTwoPoints(bankerCards);
        let bankerThirdCard = null;
        
        if (bankerPoints <= 2) {
            // 莊家0-2點必須補牌
            bankerThirdCard = this.drawCard();
            bankerCards.push(bankerThirdCard);
        } else if (bankerPoints === 3) {
            // 莊家3點，除非閒家第三張牌是8
            if (playerCards.length === 3 && playerCards[2] !== "8") {
                bankerThirdCard = this.drawCard();
                bankerCards.push(bankerThirdCard);
            }
        } else if (bankerPoints === 4) {
            // 莊家4點，除非閒家第三張牌是0,1,8,9
            if (playerCards.length === 3 && ![0, 1, 8, 9].includes(this.getCardValue(playerCards[2]))) {
                bankerThirdCard = this.drawCard();
                bankerCards.push(bankerThirdCard);
            }
        } else if (bankerPoints === 5) {
            // 莊家5點，除非閒家第三張牌是0,1,2,3,8,9
            if (playerCards.length === 3 && ![0, 1, 2, 3, 8, 9].includes(this.getCardValue(playerCards[2]))) {
                bankerThirdCard = this.drawCard();
                bankerCards.push(bankerThirdCard);
            }
        } else if (bankerPoints === 6) {
            // 莊家6點，如果閒家第三張牌是6或7則補牌
            if (playerCards.length === 3 && [6, 7].includes(this.getCardValue(playerCards[2]))) {
                bankerThirdCard = this.drawCard();
                bankerCards.push(bankerThirdCard);
            }
        }
        // 莊家7點或以上不補牌

        // 計算最終點數
        const finalPlayerPoints = this.calculatePoints(playerCards);
        const finalBankerPoints = this.calculatePoints(bankerCards);

        // 判斷結果
        let result;
        let winner;
        
        if (finalPlayerPoints > finalBankerPoints) {
            result = "閒家贏";
            winner = "player";
        } else if (finalBankerPoints > finalPlayerPoints) {
            result = "莊家贏";
            winner = "banker";
        } else {
            result = "和局";
            winner = "tie";
        }

        return {
            playerCards: [...playerCards],
            bankerCards: [...bankerCards],
            playerPoints: finalPlayerPoints,
            bankerPoints: finalBankerPoints,
            result,
            winner,
            roundDetails: {
                playerFirstTwoPoints: playerPoints,
                bankerFirstTwoPoints: bankerPoints,
                playerThirdCard: playerCards[2] || null,
                bankerThirdCard: bankerThirdCard
            }
        };
    }

    getCardValue(card) {
        switch (card) {
            case "A": return 1;
            case "K": case "Q": case "J": case "10": return 0;
            case "9": return 9;
            case "8": return 8;
            case "7": return 7;
            case "6": return 6;
            case "5": return 5;
            case "4": return 4;
            case "3": return 3;
            case "2": return 2;
            default: return 0;
        }
    }
}

// API 路由處理
class BaccaratAPI {
    constructor() {
        this.game = new BaccaratGame();
    }

    async placeBet(playerId, betOn, betAmount) {
        // 檢查玩家餘額
        const player = await db.getOrCreatePlayer(playerId);
        if (player.chips < betAmount) {
            throw new Error(`籌碼不足！當前籌碼: ${player.chips}, 下注: ${betAmount}`);
        }

        // 進行遊戲
        const gameResult = this.game.playRound(betOn);

        // 計算賠付
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

        // 更新玩家籌碼
        const chipChange = winAmount - betAmount; // 淨變化
        const updatedPlayer = await db.updatePlayerChips(
            playerId, 
            chipChange, 
            resultType === 'win'
        );

        // 保存遊戲紀錄
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

        return {
            gameResult,
            betDetails: {
                betOn,
                betAmount,
                winAmount,
                netChange: chipChange
            },
            player: updatedPlayer,
            message: resultType === 'win' ? 
                `恭喜！贏得 ${winAmount} 籌碼！` : 
                '下次會更好！'
        };
    }

    async getStatistics() {
        const stats = await db.getLeaderboard(5);
        return {
            leaderboard: stats,
            activePlayers: stats.length,
            totalChipsInPlay: stats.reduce((sum, p) => sum + p.chips, 0)
        };
    }
}

module.exports = new BaccaratAPI();