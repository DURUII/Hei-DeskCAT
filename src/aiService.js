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

    // 检查是否包含各种关键词
    const travelKeywords = ['旅行', '旅游', '景点', '风景', '地标', '建筑', '城市', '国家', '地区'];
    const todoKeywords = ['任务', '待办', '会议', '截止', '计划', '工作', '项目', '清单'];
    const searchKeywords = ['文档', '文章', '代码', '学习', '资料', '教程', '笔记', '知识'];

    const shouldTravel = travelKeywords.some(keyword => lowerResponse.includes(keyword));
    const shouldTodo = todoKeywords.some(keyword => lowerResponse.includes(keyword));
    const shouldSearch = searchKeywords.some(keyword => lowerResponse.includes(keyword));

    // 提取消息内容（移除可能的标签）
    let message = response
        .replace(/#travel/gi, '')
        .replace(/#todo/gi, '')
        .replace(/#search/gi, '')
        .replace(/#other/gi, '')
        .replace(/shouldTravel:\s*(true|false)/gi, '')
        .replace(/confidence:\s*\d+\.?\d*/gi, '')
        .trim();

    // 如果消息为空，使用默认消息
    if (!message) {
        if (shouldTravel) {
            message = "这个风景好美，替你去看看？";
        } else if (shouldTodo) {
            message = "已加入待办！✅";
        } else if (shouldSearch) {
            message = "内容已保存！📚";
        } else {
            message = "这看起来很有趣！";
        }
    }

    // 构建actions对象
    const actions = {
        travel: {
            shouldTrigger: shouldTravel,
            destination: shouldTravel ? "北京天安门" : "",
            confidence: shouldTravel ? 0.6 : 0.0
        },
        todo: {
            shouldTrigger: shouldTodo,
            content: shouldTodo ? "待办事项" : "",
            confidence: shouldTodo ? 0.6 : 0.0
        },
        search: {
            shouldTrigger: shouldSearch,
            content: shouldSearch ? "检索内容" : "",
            confidence: shouldSearch ? 0.6 : 0.0
        }
    };

    return {
        message: message,
        shouldTravel: shouldTravel,
        confidence: shouldTravel ? 0.6 : 0.5,
        emotion: shouldTravel ? '好棒' : (shouldTodo ? '思考并怀疑' : (shouldSearch ? '猫头偷看' : '嘿嘿被夸了')),
        actions: actions
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
                    confidence: 0.7,
                    emotion: "好棒",
                    actions: {
                        travel: {
                            shouldTrigger: true,
                            destination: "北京天安门",
                            confidence: 0.7
                        },
                        todo: {
                            shouldTrigger: false,
                            content: "",
                            confidence: 0.0
                        },
                        search: {
                            shouldTrigger: false,
                            content: "",
                            confidence: 0.0
                        }
                    }
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
                    confidence: 0.6,
                    emotion: "嘿嘿被夸了",
                    actions: {
                        travel: {
                            shouldTrigger: false,
                            destination: "",
                            confidence: 0.0
                        },
                        todo: {
                            shouldTrigger: false,
                            content: "",
                            confidence: 0.0
                        },
                        search: {
                            shouldTrigger: false,
                            content: "",
                            confidence: 0.0
                        }
                    }
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
                    1. 旅行触发：如果截图包含风景、旅游景点、地标建筑等适合旅行的地方，建议旅行
                    2. 待办记录：如果截图包含任务清单、会议安排、截止日期、工作计划等需要记录的事项，建议记录待办
                    3. 内容检索：如果截图包含文档、文章、代码、学习资料等需要保存或检索的内容，建议内容检索
                    4. 日常互动：如果是工作文档、聊天界面、游戏等日常内容，给出有趣回应，看到辛苦忙碌表达关怀，看到笑话会笑，看到好吃的就流口水肚子饿了，看到被老板PUA他是坏人气哄哄等等。注意：日常互动不触发任何额外事件（旅行、待办、检索），仅显示AI生成的互动信息
                    5. 回应应该简短、有趣且富有想象力，不超过20个字

                    请严格按照以下JSON格式回复，不要添加任何其他内容，不要包含\`\`\`json等关键字：
                    {
                    "message": "你的回应内容",
                    "actions": {
                        "travel": {
                            "shouldTrigger": true/false,
                            "destination": "旅行目的地（城市+景点名）",
                            "confidence": 0.8
                        },
                        "todo": {
                            "shouldTrigger": true/false,
                            "content": "待办事项内容",
                            "confidence": 0.8
                        },
                        "search": {
                            "shouldTrigger": true/false,
                            "content": "检索内容描述",
                            "confidence": 0.8
                        }
                    },
                    "emotion": "表情标签"
                    }

                    其中：
                    - message: 回应内容（简体中文）
                    - actions: 各种动作的触发信息
                      - travel: 旅行相关（shouldTrigger是否触发，destination目的地，confidence置信度）
                      - todo: 待办相关（shouldTrigger是否触发，content待办内容，confidence置信度）
                      - search: 检索相关（shouldTrigger是否触发，content检索内容，confidence置信度）
                    - emotion: 表情标签，根据截图内容选择最合适的表情，可选值：好棒（开心夸奖）、嘿嘿被夸了（害羞开心）、给你花花（友好送花）、有瓜让我听听（好奇八卦）、猫头偷看（偷偷观察）、思考并怀疑（思考状态）、好复杂（困惑）、馋得流口水（想吃东西）、生气替你出头（愤怒保护）、哼不理你了（傲娇）、玩手机（专注玩手机）、困死了（困倦）`
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `我刚截了一张图，现在是${new Date().toLocaleString('zh-CN')}，你能看出这是什么吗？请分析并按照指定格式回复。`
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
                parsedResponse.actions &&
                typeof parsedResponse.emotion === 'string') {

                const result = {
                    message: parsedResponse.message,
                    shouldTravel: parsedResponse.actions.travel?.shouldTrigger || false,
                    confidence: parsedResponse.actions.travel?.confidence || 0.5,
                    emotion: parsedResponse.emotion,
                    actions: parsedResponse.actions
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
                confidence: 0.5,
                emotion: "好棒",
                actions: {
                    travel: {
                        shouldTrigger: true,
                        destination: "北京天安门",
                        confidence: 0.5
                    },
                    todo: {
                        shouldTrigger: false,
                        content: "",
                        confidence: 0.0
                    },
                    search: {
                        shouldTrigger: false,
                        content: "",
                        confidence: 0.0
                    }
                }
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
                confidence: 0.4,
                emotion: "嘿嘿被夸了",
                actions: {
                    travel: {
                        shouldTrigger: false,
                        destination: "",
                        confidence: 0.0
                    },
                    todo: {
                        shouldTrigger: false,
                        content: "",
                        confidence: 0.0
                    },
                    search: {
                        shouldTrigger: false,
                        content: "",
                        confidence: 0.0
                    }
                }
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
 * 根据地点和天气生成旅程状态描述
 * @param {Object} locationInfo - 地理位置信息
 * @param {Object} weatherInfo - 天气信息
 * @returns {Promise<string>} 生成的状态描述
 */
async function generateJourneyStatusWithLocation(locationInfo, weatherInfo) {
    // 即使没有配置API Key，也返回默认状态
    try {
        // 检查参数是否有效
        if (!locationInfo || !weatherInfo) {
            console.log("Invalid location or weather info, returning default status");
            return "正在旅行中...";
        }

        // 如果没有配置API Key，则返回默认状态
        if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY === "sk-xxx") {
            console.log("API Key not configured, returning default status with location");
            const cityName = locationInfo.city || "某地";
            const weatherDesc = weatherInfo.description || "好天气";
            const temperature = weatherInfo.temperature || "舒适";

            const defaultStatuses = [
                `正在${cityName}欣赏美丽风景✨`,
                `在${cityName}感受${weatherDesc}🌤️`,
                `正于${cityName}体验${temperature}度的${weatherDesc}😊`,
                `${cityName}的${weatherDesc}太适合旅行啦🌞`,
                `在${cityName}看风景，${temperature}度刚刚好😊`
            ];
            return defaultStatuses[Math.floor(Math.random() * defaultStatuses.length)];
        }

        // 确保参数有默认值
        const cityName = locationInfo.city || "某城市";
        const weatherDesc = weatherInfo.description || "晴朗天气";
        const temperature = weatherInfo.temperature || "舒适";

        const completion = await openai.chat.completions.create({
            model: "qwen-plus",
            messages: [
                {
                    role: "system",
                    content: "你是一个有趣的桌面伴侣助手。用户有一个正在旅行的小旅星，你需要描述它当前的状态和位置。保持简短，不超过20个字。"
                },
                {
                    role: "user",
                    content: `我的小旅星现在在${cityName}，天气是${weatherDesc}，温度${temperature}度。它在做什么？以下是几个示例：
                                正在${cityName}欣赏美丽风景✨,
                                在${cityName}感受${weatherDesc}🌤️,
                                正于${cityName}体验${temperature}度的${weatherDesc}😊,
                                ${cityName}的${weatherDesc}太适合旅行啦,
                                在${cityName}看风景，${temperature}度刚刚好😊`
                }
            ],
            max_tokens: 50
        });

        let status = completion.choices[0].message.content.trim();

        // 确保不超过20个字
        if (status.length > 20) {
            status = status.substring(0, 20);
        }

        // 确保状态不为空
        if (!status) {
            status = `正在${cityName}旅行中...`;
        }

        return status;
    } catch (error) {
        console.error('Error occurred during AI journey status generation with location:', error);
        // 出错时返回默认状态
        try {
            const cityName = (locationInfo && locationInfo.city) || "某地";
            const weatherDesc = (weatherInfo && weatherInfo.description) || "好天气";
            const temperature = (weatherInfo && weatherInfo.temperature) || "舒适";

            const defaultStatuses = [
                `正在${cityName}欣赏美丽风景✨`,
                `在${cityName}感受${weatherDesc}🌤️`,
                `正于${cityName}体验${temperature}度的${weatherDesc}😊`,
                `${cityName}的${weatherDesc}太适合旅行啦🌞`,
                `在${cityName}看风景，${temperature}度刚刚好😊`
            ];
            return defaultStatuses[Math.floor(Math.random() * defaultStatuses.length)];
        } catch (defaultError) {
            console.error('Error generating default status:', defaultError);
            return "正在旅行中...";
        }
    }
}

module.exports = {
    analyzeScreenshot,
    generateFunReminder,
    generateJourneyStatusWithLocation
};