const OpenAI = require('openai');

// 初始化OpenAI客户端
const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY || "sk-xxx", // 请配置您的API Key
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

/**
 * 分析截图内容并生成响应
 * @param {string} base64Image - 截图的base64编码
 * @returns {Promise<Object>} 生成的响应文本和是否触发旅行的标志
 */
async function analyzeScreenshot(base64Image) {
    // 即使没有配置API Key，也返回默认响应
    try {
        // 如果没有配置API Key，则返回默认响应
        if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY === "sk-xxx") {
            console.log("未配置API Key，返回默认响应");
            // 随机决定是否触发旅行（模拟AI判断）
            const shouldTravel = Math.random() > 0.5;
            const defaultResponses = [
                "替你去看北京天安门？",
                "这个风景好美，替你去北京看看？",
                "要去北京旅行吗？"
            ];
            
            if (shouldTravel) {
                return {
                    message: defaultResponses[Math.floor(Math.random() * defaultResponses.length)],
                    shouldTravel: true
                };
            } else {
                const nonTravelResponses = [
                    "这看起来很有趣！",
                    "哇，这个不错哦！",
                    "好有意思的内容！"
                ];
                return {
                    message: nonTravelResponses[Math.floor(Math.random() * nonTravelResponses.length)],
                    shouldTravel: false
                };
            }
        }
        
        const completion = await openai.chat.completions.create({
            model: "qwen-vl-plus",
            messages: [
                { 
                    role: "system", 
                    content: "你是一个有趣的桌面伴侣助手。用户会发送截图给你，你需要根据截图内容给出有趣的回应。如果截图内容是风景、旅游景点等适合旅行的地方，可以询问用户是否要替他们去看看，格式如'替你去看[地点]？'。如果是其他内容，给出合适的有趣回应。请用简体中文回复，回应应该简短、有趣且富有想象力，不超过20个字。请在回复末尾添加一个标签：#travel表示建议旅行，#other表示其他内容。" 
                },
                { 
                    role: "user", 
                    content: [
                        {
                            type: "text",
                            text: "我刚截了一张图，你能看出这是什么吗？"
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/png;base64,${base64Image}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 100
        });
        
        const aiResponse = completion.choices[0].message.content.trim();
        // 检查是否包含#travel标签
        const shouldTravel = aiResponse.includes("#travel");
        // 移除标签
        const cleanMessage = aiResponse.replace("#travel", "").replace("#other", "").trim();
        
        return {
            message: cleanMessage,
            shouldTravel: shouldTravel
        };
    } catch (error) {
        console.error('AI分析截图时出错:', error);
        // 出错时返回默认响应
        const shouldTravel = Math.random() > 0.5;
        const defaultResponses = [
            "替你去看北京天安门？",
            "这个风景好美，替你去北京看看？",
            "要去北京旅行吗？"
        ];
        
        if (shouldTravel) {
            return {
                message: defaultResponses[Math.floor(Math.random() * defaultResponses.length)],
                shouldTravel: true
            };
        } else {
            const nonTravelResponses = [
                "这看起来很有趣！",
                "哇，这个不错哦！",
                "好有意思的内容！"
            ];
            return {
                message: nonTravelResponses[Math.floor(Math.random() * nonTravelResponses.length)],
                shouldTravel: false
            };
        }
    }
}

/**
 * 生成趣味提醒内容
 * @returns {Promise<string>} 生成的提醒文本
 */
async function generateFunReminder() {
    // 即使没有配置API Key，也返回默认提醒
    try {
        // 如果没有配置API Key，则返回默认提醒
        if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY === "sk-xxx") {
            console.log("未配置API Key，返回默认提醒");
            const defaultReminders = [
                "哇塞这个好好玩！✨",
                "已加入代办！✅",
                "脑中突然闪过一个好想法💡",
                "工作之余，记得微笑😊"
            ];
            return defaultReminders[Math.floor(Math.random() * defaultReminders.length)];
        }
        
        const completion = await openai.chat.completions.create({
            model: "qwen-plus",
            messages: [
                { 
                    role: "system", 
                    content: "你是一个有趣的桌面伴侣助手。你需要生成一些有趣的提醒消息，比如鼓励、幽默或温馨的提醒。保持简短，不超过20个字。" 
                },
                { 
                    role: "user", 
                    content: "给我生成一个有趣的提醒消息" 
                }
            ],
            max_tokens: 50
        });
        
        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error('AI生成提醒时出错:', error);
        // 出错时返回默认提醒
        const defaultReminders = [
            "哇塞这个好好玩！✨",
            "已加入代办！✅",
            "脑中突然闪过一个好想法💡",
            "工作之余，记得微笑😊"
        ];
        return defaultReminders[Math.floor(Math.random() * defaultReminders.length)];
    }
}

/**
 * 生成旅程状态描述
 * @returns {Promise<string>} 生成的状态描述
 */
async function generateJourneyStatus() {
    // 即使没有配置API Key，也返回默认状态
    try {
        // 如果没有配置API Key，则返回默认状态
        if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY === "sk-xxx") {
            console.log("未配置API Key，返回默认状态");
            const defaultStatuses = [
                "正在北京天安门广场看升旗仪式🇨🇳",
                "在故宫里探索历史文化🏯",
                "于长城上感受雄伟壮丽🏰",
                "在颐和园中欣赏湖光山色🏞️",
                "在胡同里体验老北京风情🏘️"
            ];
            return defaultStatuses[Math.floor(Math.random() * defaultStatuses.length)];
        }
        
        const completion = await openai.chat.completions.create({
            model: "qwen-plus",
            messages: [
                { 
                    role: "system", 
                    content: "你是一个有趣的桌面伴侣助手。用户有一个正在旅行的小旅星，你需要描述它当前的状态和位置。保持简短，不超过20个字。" 
                },
                { 
                    role: "user", 
                    content: "我的小旅星现在在哪里？在做什么？" 
                }
            ],
            max_tokens: 50
        });
        
        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error('AI生成旅程状态时出错:', error);
        // 出错时返回默认状态
        const defaultStatuses = [
            "正在北京天安门广场看升旗仪式🇨🇳",
            "在故宫里探索历史文化🏯",
            "于长城上感受雄伟壮丽🏰",
            "在颐和园中欣赏湖光山色🏞️",
            "在胡同里体验老北京风情🏘️"
        ];
        return defaultStatuses[Math.floor(Math.random() * defaultStatuses.length)];
    }
}

module.exports = {
    analyzeScreenshot,
    generateFunReminder,
    generateJourneyStatus
};