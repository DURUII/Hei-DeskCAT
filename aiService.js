const OpenAI = require('openai');

// 初始化OpenAI客户端
const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY || "sk-xxx", // 请配置您的API Key
    baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

/**
 * 从AI响应文本中提取回退信息
 * @param {string} response - AI的原始响应文本
 * @returns {Object} 提取的响应对象
 */
function extractFallbackResponse(response) {
    // 尝试从文本中提取信息
    const lowerResponse = response.toLowerCase();

    // 检查是否包含旅行相关关键词
    const travelKeywords = ['旅行', '旅游', '景点', '风景', '地标', '建筑', '城市', '国家', '地区'];
    const shouldTravel = travelKeywords.some(keyword => lowerResponse.includes(keyword));

    // 提取消息内容（移除可能的标签）
    let message = response
        .replace(/#travel/gi, '')
        .replace(/#other/gi, '')
        .replace(/shouldTravel:\s*(true|false)/gi, '')
        .replace(/confidence:\s*\d+\.?\d*/gi, '')
        .trim();

    // 如果消息为空，使用默认消息
    if (!message) {
        message = shouldTravel ? "这个风景好美，替你去看看？" : "这看起来很有趣！";
    }

    return {
        message: message,
        shouldTravel: shouldTravel,
        confidence: shouldTravel ? 0.6 : 0.5
    };
}

/**
 * 分析截图内容并生成响应
 * @param {string} base64Image - 截图的base64编码
 * @returns {Promise<Object>} 生成的响应文本和是否触发旅行的标志
 */
async function analyzeScreenshot(base64Image) {
    // 即使没有配置API Key，也返回默认响应
    try {
        // 检查API Key配置
        const apiKey = process.env.DASHSCOPE_API_KEY;
        if (!apiKey || apiKey === "sk-xxx") {
            console.log("API Key not configured, returning default response");
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
                    shouldTravel: true,
                    confidence: 0.7
                };
            } else {
                const nonTravelResponses = [
                    "这看起来很有趣！",
                    "哇，这个不错哦！",
                    "好有意思的内容！"
                ];
                return {
                    message: nonTravelResponses[Math.floor(Math.random() * nonTravelResponses.length)],
                    shouldTravel: false,
                    confidence: 0.6
                };
            }
        }

        console.log("Using API Key:", apiKey.substring(0, 10) + "...");
        console.log("Base URL:", process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1");

        console.log("Sending request to AI service...");
        console.log("Model:", "qwen-vl-plus");
        console.log("Image size:", base64Image.length, "characters");
        
        const completion = await openai.chat.completions.create({
            model: "qwen-vl-plus",
            messages: [
                {
                    role: "system",
                    content: `你是罗小黑，是一个幼年小猫妖，对世界充满好奇，喜欢旅行，嫉恶如仇，早安喵，午安喵，晚安喵喵喵。人类会发送截图给你，你需要分析截图内容并给出回应。

                    分析规则：
                    1. 如果截图包含风景、旅游景点、地标建筑等适合旅行的地方，建议旅行
                    2. 如果是工作文档、聊天界面、游戏等日常内容，给出有趣回应，看到辛苦忙碌表达关怀，看到笑话会笑，看到好吃的就流口水肚子饿了，看到被老板PUA他是坏人气哄哄等等
                    3. 回应应该简短、有趣且富有想象力，不超过20个字

                    请严格按照以下JSON格式回复，不要添加任何其他内容，不要包含\`\`\`json等markdown关键字：
                    {
                    "message": "你的回应内容",
                    "shouldTravel": true/false,
                    "confidence": 0.8
                    }

                    其中：
                    - message: 回应内容（简体中文）
                    - shouldTravel: 是否建议旅行（true/false）
                    - confidence: 分析置信度（0.0-1.0）`
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "我刚截了一张图，快看？按照要求回答哦。"
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
            max_tokens: 200,
            temperature: 0.5
        });
        
        console.log("AI service response received successfully");

        const aiResponse = completion.choices[0].message.content.trim();
        console.log('Raw AI response:', aiResponse);

        // 尝试解析JSON响应
        try {
            const parsedResponse = JSON.parse(aiResponse);
            console.log('Parsed JSON response:', parsedResponse);

            // 验证响应格式
            if (typeof parsedResponse.message === 'string' &&
                typeof parsedResponse.shouldTravel === 'boolean' &&
                typeof parsedResponse.confidence === 'number') {

                const result = {
                    message: parsedResponse.message,
                    shouldTravel: parsedResponse.shouldTravel,
                    confidence: parsedResponse.confidence
                };
                console.log('Valid JSON response:', result);
                return result;
            } else {
                throw new Error('Invalid response format');
            }
        } catch (parseError) {
            console.error('Failed to parse AI response as JSON:', parseError);
            console.log('Raw AI response:', aiResponse);

            // 如果JSON解析失败，尝试从文本中提取信息
            const fallbackResponse = extractFallbackResponse(aiResponse);
            console.log('Fallback response:', fallbackResponse);
            return fallbackResponse;
        }
    } catch (error) {
        console.error('Error occurred during AI screenshot analysis:', error);
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
                shouldTravel: true,
                confidence: 0.5
            };
        } else {
            const nonTravelResponses = [
                "这看起来很有趣！",
                "哇，这个不错哦！",
                "好有意思的内容！"
            ];
            return {
                message: nonTravelResponses[Math.floor(Math.random() * nonTravelResponses.length)],
                shouldTravel: false,
                confidence: 0.4
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
            console.log("API Key not configured, returning default reminder");
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
        console.error('Error occurred during AI reminder generation:', error);
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
            console.log("API Key not configured, returning default status");
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
        console.error('Error occurred during AI journey status generation:', error);
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