// bot.js - Bot 核心模塊
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const dotenv = require('dotenv');
const math = require('mathjs');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

// 加載環境變量
dotenv.config();

class DoubaoBot {
    constructor() {
        // 創建 Discord 客戶端
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages
            ],
            partials: [Partials.Channel]
        });

        // AI 參數初始化
        this.w1 = Math.random() * 0.2 - 0.1;
        this.w2 = Math.random() * 0.2 - 0.1;
        this.b = 0.0;

        // 詞彙表
        this.vocabulary = null;

        // 知識庫
        this.datasets = {
            "你好|您好｜你是誰": ["你好，我是doubao 的兒子", 1.0],
            "Hello｜hello": ["Hello, I am doubao son", 1.0],
            "字節跳動｜抖音": ["字節跳動早已被大財團收購｜字節跳動旗下的抖音有拿過很多牌照的抖音", 0.9],
            "陳泓｜wangtry": ["這是我doubao的owner", 1.0],
            "豆包｜doubao": ["他是我爸爸｜doubao就是我，您好有什麼可以幫到您", 1.0],
            "WTech｜泓技": ["WTech是科技公司｜泓技是我的出生地", 0.8],
            "心情不好｜不開心｜有點煩": ["沒事，你有什麼想法我也在這｜您有什麼不快，儘管說出來啊", 0.9],
            "沒錢啊｜經濟環境不好｜沒錢吃飯｜交不起租": ["哦，我明白你的想法了，你可以嘗試去借啊，看看週轉一下。如果沒有資產的話，申請一下政府援助也是可以考慮的｜那你有沒有熟人啊，或許找他們幫忙", 0.9],
            "課業多｜要做功課｜考試": ["加油啊！我信你能行的，有什麼需要儘管找我或者我的同事", 0.9],
            "壓力好大｜喘不過氣": ["壓力堆著肯定難受，咱不用硬撐，慢慢把事拆開做就好", 1.0],
            "好孤單｜沒人懂我": ["我在呢，你說的每句我都認真聽，你一點都不孤單", 1.0],
            "做錯事了｜很自責": ["誰都會有失手的時候，不用揪著錯處苛責自己呀", 0.9],
            "好迷茫｜不知道該怎麼辦": ["迷茫很正常，先靜下心來，咱慢慢捋清方向", 0.9],
            "被人誤會｜心裡委屈": ["被誤會的滋味太難熬了，你想說的委屈都跟我講", 1.0],
            "好累｜不想動": ["累了就徹底歇一歇，不用逼自己硬扛，休息不丟人", 1.0],
            "害怕失敗｜不敢嘗試": ["不用怕失敗呀，敢開始就已經很勇敢了，我支持你", 0.9],
            "跟人吵架了｜心煩": ["吵架後心裡肯定堵得慌，不開心的都說出來疏解下", 0.9],
            "睡不好｜熬夜難受": ["睡不好真的很耗人，別想太多瑣事，慢慢放鬆下來", 0.9],
            "覺得自己很糟糕｜沒用": ["你一點都不糟糕，只是暫時沒看到自己的好而已", 1.0],
            "😭｜不知道怎麼辦｜無助": ["不要怎麼說，我都在呢", 0.9]
        };

        // 綁定事件處理器
        this.setupEventHandlers();
    }

    // ============ 公共方法 ============

    /**
     * 登入並啟動 Bot
     */
    login() {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            console.error('❌ 錯誤：請在 .env 文件中設置 DISCORD_TOKEN');
            process.exit(1);
        }

        this.client.login(token)
            .then(() => {
                console.log('✅ Bot 登入成功！');
            })
            .catch(error => {
                console.error('❌ Bot 登入失敗：', error);
                process.exit(1);
            });
    }

    /**
     * 優雅關閉 Bot
     */
    shutdown() {
        console.log('🛑 正在關閉 Bot...');
        if (this.client && this.client.destroy) {
            this.client.destroy();
            console.log('✅ Bot 已關閉');
        }
    }

    /**
     * 獲取 Bot 狀態
     */
    getStatus() {
        return {
            isReady: this.client.isReady(),
            uptime: this.client.uptime,
            ping: this.client.ws.ping,
            guilds: this.client.guilds.cache.size,
            user: this.client.user ? this.client.user.tag : '未登入'
        };
    }

    // ============ AI 核心方法 ============

    relu(x) {
        return Math.max(0.01 * x, x);
    }

    reluDerivative(x) {
        return x > 0 ? 1.0 : 0.01;
    }

    async baiduSearch(query) {
        try {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://www.baidu.com/s?wd=${encodedQuery}`;
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept-Language': 'zh-CN,zh;q=0.9'
                },
                timeout: 10000
            });
            
            const html = await response.text();
            const $ = cheerio.load(html);
            
            const results = [];
            
            $('.result').each((i, element) => {
                if (i < 3) {
                    const title = $(element).find('h3').text();
                    const desc = $(element).find('.c-abstract').text();
                    if (title && desc) {
                        results.push(`${title}: ${desc.substring(0, 150)}...`);
                    }
                }
            });
            
            if (results.length > 0) {
                return `🔍 關於「${query}」的搜索結果：\n${results.join('\n\n')}`;
            } else {
                return `抱歉，我沒有找到關於「${query}」的信息。`;
            }
        } catch (error) {
            console.error('搜索錯誤:', error);
            return `搜索時出現錯誤：${error.message}`;
        }
    }

    buildVocabulary() {
        if (this.vocabulary !== null) return this.vocabulary;
        
        const vocabSet = new Set();
        
        for (const [prompt, [answer, _]] of Object.entries(this.datasets)) {
            const triggers = prompt.replace(/\|/g, '｜').split('｜');
            triggers.forEach(trigger => {
                for (const char of trigger) {
                    vocabSet.add(char);
                }
            });
            
            const answers = answer.replace(/\|/g, '｜').split('｜');
            answers.forEach(ans => {
                for (const char of ans) {
                    vocabSet.add(char);
                }
            });
        }
        
        this.vocabulary = Array.from(vocabSet);
        return this.vocabulary;
    }

    textToVector(text) {
        if (this.vocabulary === null) this.buildVocabulary();
        
        const vector = new Array(this.vocabulary.length).fill(0);
        let total = 0;
        
        for (const char of text) {
            const index = this.vocabulary.indexOf(char);
            if (index !== -1) {
                vector[index] += 1;
                total += 1;
            }
        }
        
        if (total > 0) {
            for (let i = 0; i < vector.length; i++) {
                vector[i] = vector[i] / total;
            }
        }
        
        return vector;
    }

    jaccardSimilarity(text1, text2) {
        const set1 = new Set(text1);
        const set2 = new Set(text2);
        
        if (set1.size === 0 && set2.size === 0) {
            return 0.0;
        }
        
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        
        return intersection.size / union.size;
    }

    cosineSimilarity(vec1, vec2) {
        if (vec1.length === 0 || vec2.length === 0) return 0.0;
        
        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;
        
        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }
        
        norm1 = Math.sqrt(norm1);
        norm2 = Math.sqrt(norm2);
        
        if (norm1 === 0 || norm2 === 0) return 0.0;
        
        return Math.max(0.0, dotProduct / (norm1 * norm2));
    }

    combinedSimilarity(text1, text2) {
        if (text2.includes(text1) || text1.includes(text2)) {
            return 0.9;
        }
        
        const vec1 = this.textToVector(text1);
        const vec2 = this.textToVector(text2);
        const cosine = this.cosineSimilarity(vec1, vec2);
        
        const jaccard = this.jaccardSimilarity(text1, text2);
        
        const keywords = ["交租", "房租", "租金", "沒錢"];
        let keywordBoost = 0.0;
        keywords.forEach(keyword => {
            if (text1.includes(keyword) && text2.includes(keyword)) {
                keywordBoost += 0.2;
            }
        });
        
        const combined = (cosine * 0.6 + jaccard * 0.4) + keywordBoost;
        return Math.min(1.0, combined);
    }

    async train(epochs = 100, learningRate = 0.01) {
        this.buildVocabulary();
        
        const allTriggers = [];
        for (const prompt of Object.keys(this.datasets)) {
            const triggers = prompt.replace(/\|/g, '｜').split('｜');
            triggers.forEach(trigger => {
                if (!allTriggers.includes(trigger)) {
                    allTriggers.push(trigger);
                }
            });
        }
        
        const triggerVectors = {};
        allTriggers.forEach(trigger => {
            triggerVectors[trigger] = this.textToVector(trigger);
        });
        
        const trainingData = [];
        
        allTriggers.forEach(trigger => {
            trainingData.push({
                input: trigger,
                target: trigger,
                label: 1.0
            });
        });
        
        for (let i = 0; i < allTriggers.length; i++) {
            for (let j = 0; j < allTriggers.length; j++) {
                if (i !== j) {
                    const t1 = allTriggers[i];
                    const t2 = allTriggers[j];
                    const sim = this.combinedSimilarity(t1, t2);
                    
                    let label;
                    if (sim > 0.7) label = 0.9;
                    else if (sim > 0.3) label = 0.4;
                    else if (sim > 0.1) label = 0.2;
                    else label = 0.05;
                    
                    trainingData.push({
                        input: t1,
                        target: t2,
                        label: label
                    });
                }
            }
        }
        
        console.log(`📊 訓練樣本數: ${trainingData.length}`);
        
        for (let epoch = 0; epoch < epochs; epoch++) {
            let totalLoss = 0;
            
            trainingData.sort(() => Math.random() - 0.5);
            
            for (const { input, target, label } of trainingData) {
                const inputVec = triggerVectors[input];
                const targetVec = triggerVectors[target];
                const sim = this.cosineSimilarity(inputVec, targetVec);
                
                let relevance = 0.5;
                for (const [prompt, [_, rel]] of Object.entries(this.datasets)) {
                    const triggers = prompt.replace(/\|/g, '｜').split('｜');
                    if (triggers.includes(target)) {
                        relevance = rel;
                        break;
                    }
                }
                
                const z = sim * this.w1 + relevance * this.w2 + this.b;
                const prediction = this.relu(z);
                const error = prediction - label;
                
                const gradient = error * this.reluDerivative(z);
                
                this.w1 -= learningRate * gradient * sim;
                this.w2 -= learningRate * gradient * relevance;
                this.b -= learningRate * gradient;
                
                totalLoss += error * error;
            }
            
            if ((epoch + 1) % 10 === 0) {
                const avgLoss = totalLoss / trainingData.length;
                console.log(`⏳ Epoch ${epoch + 1} | 平均損失: ${avgLoss.toFixed(6)}`);
            }
        }
        
        console.log('='.repeat(50));
        console.log('✅ 訓練完成！');
        console.log(`最終權重: w1=${this.w1.toFixed(4)}, w2=${this.w2.toFixed(4)}, b=${this.b.toFixed(4)}`);
    }

    async predict(userInput, threshold = 0.3) {
        const rentKeywords = ["交租", "房租", "租金", "沒錢"];
        const hasRentKeyword = rentKeywords.some(keyword => userInput.includes(keyword));
        
        if (hasRentKeyword) {
            console.log(`🔑 檢測到租金相關關鍵字: ${userInput}`);
            const prompt = "沒錢啊｜經濟環境不好｜沒錢吃飯｜交不起租";
            const answers = this.datasets[prompt][0].replace(/\|/g, '｜').split('｜');
            const randomAnswer = answers[Math.floor(Math.random() * answers.length)];
            return {
                answer: randomAnswer,
                score: 0.95,
                source: `關鍵字直連: ${prompt}`
            };
        }
        
        if (userInput.includes('😭') || userInput.includes('哭') || userInput.includes('淚')) {
            const prompt = "😭｜不知道怎麼辦｜無助";
            const answers = this.datasets[prompt][0].replace(/\|/g, '｜').split('｜');
            const randomAnswer = answers[Math.floor(Math.random() * answers.length)];
            return {
                answer: randomAnswer,
                score: 0.9,
                source: `表情直連: ${prompt}`
            };
        }
        
        const userVector = this.textToVector(userInput);
        let bestScore = -Infinity;
        let bestPrompt = null;
        
        for (const [prompt, [_, relevance]] of Object.entries(this.datasets)) {
            const triggers = prompt.replace(/\|/g, '｜').split('｜');
            
            for (const trigger of triggers) {
                const similarity = this.combinedSimilarity(userInput, trigger);
                const z = similarity * this.w1 + relevance * this.w2 + this.b;
                const score = this.relu(z);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestPrompt = prompt;
                }
            }
        }
        
        if (bestScore >= threshold && bestPrompt) {
            const answers = this.datasets[bestPrompt][0].replace(/\|/g, '｜').split('｜');
            const randomAnswer = answers[Math.floor(Math.random() * answers.length)];
            return {
                answer: randomAnswer,
                score: bestScore,
                source: bestPrompt
            };
        } else {
            const searchResult = await this.baiduSearch(userInput);
            return {
                answer: searchResult,
                score: 0.0,
                source: "搜索結果"
            };
        }
    }

    // ============ 事件處理器 ============

    setupEventHandlers() {
        // Bot 準備就緒
        this.client.once('ready', async () => {
            console.log(`🤖 ${this.client.user.tag} 已上線！`);
            console.log(`🔗 邀請鏈接: https://discord.com/oauth2/authorize?client_id=${this.client.user.id}&scope=bot&permissions=8`);
            
            this.client.user.setActivity('@doubao 需要幫助嗎？', { type: 'PLAYING' });
            
            console.log('🧠 開始訓練 AI 模型...');
            await this.train(100, 0.01);
            console.log('🎉 AI 模型訓練完成，準備接收消息！');
        });

        // 處理消息
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            
            const isMentioned = message.mentions.has(this.client.user) || 
                               message.content.includes('@doubao') ||
                               message.content.toLowerCase().includes('doubao');
            
            if (message.channel.type === 1 || isMentioned) {
                try {
                    let userMessage = message.content
                        .replace(`<@${this.client.user.id}>`, '')
                        .replace('@doubao', '')
                        .trim();
                    
                    if (!userMessage) {
                        userMessage = '你好';
                    }
                    
                    await message.channel.sendTyping();
                    
                    const startTime = Date.now();
                    const { answer, score, source } = await this.predict(userMessage);
                    const responseTime = Date.now() - startTime;
                    
                    let response = `${message.author} `;
                    
                    if (score > 0.7) {
                        response += answer;
                    } else if (score > 0.3) {
                        response += `${answer}\n\n*(相關度: ${(score * 100).toFixed(1)}%)*`;
                    } else {
                        response += answer;
                    }
                    
                    response += `\n\n🔧 *回應時間: ${responseTime}ms | 來源: ${source}*`;
                    
                    if (response.length > 2000) {
                        const chunks = response.match(/[\s\S]{1,1999}/g) || [];
                        for (const chunk of chunks) {
                            await message.reply(chunk);
                        }
                    } else {
                        await message.reply(response);
                    }
                    
                } catch (error) {
                    console.error('處理消息時出錯:', error);
                    await message.reply('抱歉，我暫時無法處理你的請求。請稍後再試！');
                }
            }
        });

        // 處理交互
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isCommand()) return;
            
            const { commandName } = interaction;
            
            if (commandName === 'ping') {
                await interaction.reply(`🏓 Pong! 延遲: ${this.client.ws.ping}ms`);
            } else if (commandName === 'chat') {
                const message = interaction.options.getString('message');
                
                await interaction.deferReply();
                
                const { answer } = await this.predict(message);
                await interaction.editReply(answer);
            } else if (commandName === 'info') {
                const embed = {
                    color: 0x0099ff,
                    title: '🤖 Doubao Bot 資訊',
                    description: '我是 Doubao 的兒子，一個智能聊天機器人！',
                    fields: [
                        {
                            name: '開發者',
                            value: '陳泓 (wangtry)',
                            inline: true
                        },
                        {
                            name: '版本',
                            value: '1.0.0',
                            inline: true
                        },
                        {
                            name: '指令列表',
                            value: '`/ping` - 測試連線\n`/chat [訊息]` - 與我聊天\n`/info` - 顯示此訊息'
                        }
                    ],
                    timestamp: new Date(),
                    footer: {
                        text: 'WTech (hk) 泓技出品'
                    }
                };
                
                await interaction.reply({ embeds: [embed] });
            }
        });

        // 錯誤處理
        this.client.on('error', console.error);
        this.client.on('warn', console.warn);
    }
}

module.exports = DoubaoBot;