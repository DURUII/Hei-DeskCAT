
# HeiDeskCat：让小黑做你的上班搭子

> 内源平台讨论链接：[演示视频](<removed>)

如果你也相信 AI 不应该只有智商还应该有情商，或者单纯喜欢罗小黑一样可可爱爱的国漫 IP，请为我们点个 ⭐！

## 背景与用户洞察

1. **AI + 情绪陪伴的蓝海机会**  
   - 市面上 AI + 搜索/问答/工具 是红海，但 **AI + 情绪陪伴** 尚未被充分挖掘，参考[小红书独立开发大赛 2025](https://www.ifanr.com/1621805)。
   - [GPT-4o替代爹味GPT-5！奥特曼光速滑跪，OpenAI连夜回滚「赛博舔狗」](https://mp.weixin.qq.com/s/RXLQtu5MoPg4G82af4dVrg) - 用户反馈GPT-5情商不如4o，说明对"有情商"的AI陪伴类应用有强烈期待。  
   - 现有 AI 产品大多基于网页对话框（或语音接口），需要用户主动进入情境，缺乏 **桌面级、持续存在的视觉 AI 形态**。

2. **桌面宠物的空白**  
   - 虽有部分桌面宠物因"萌"出圈（如[捣蛋鹅](https://samperson.itch.io/desktop-goose)、[VPet](https://github.com/LorisYounger/VPet)、[Bongo Cat](https://mp.weixin.qq.com/s/1bVgHQXmTw5J9O9B3L6Bkg)），但缺乏"灵魂"，无法主动观察与情绪反馈；而大模型可赋予桌面宠物主动感知与情绪交互能力。

3. **国产 IP 产业的崛起**  
   - 从春节档《哪吒》到暑期档[《浪浪山小妖怪》](https://m.douban.com/movie/subject/36438475/)、[《罗小黑战记2》](https://movie.douban.com/subject/36448279/)，国产动漫 IP 热度持续攀升，二创不断，粉丝社群活跃。

## 用户故事

| 场景描述                                                                                                                        | 演示效果                     |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **小馨（情绪陪伴+自动记待办）** <br/> 刚入职的新人，工作繁忙，渴望倾诉与情绪慰藉，同时希望AI能自动识别截图中的待办事项并记录。    | ![demo](./demo/截图.gif)     |
| **小刚（健康提醒）** <br/> 工作狂，一坐一整天忘记喝水，期望桌面 AI 主动提醒健康习惯。                                             | ![demo](./demo/喝水提醒.gif) |
| **小牛（云旅行）** <br/> 热爱旅行，看到新闻上"这么近那么美周末到河北"，但工位限制了行动自由，希望感受"有人替他去旅行"的实时反馈。 | ![demo](./demo/旅行.gif)     |

```mermaid
graph TD
  Start["启动应用"] --> FirstRun{"首次启动？"}
  FirstRun -- "是" --> Onboarding["新人引导：<br/>- 权限/浮窗/通知说明<br/>- 快捷键设置与检测(F2/F3/F4/自定义)<br/>- 提醒选项(喝水/久坐/其他)<br/>- 本地隐私承诺(仅本地存储)\n"]
  FirstRun -- "否" --> Idle["进入驻留：<br/>- 托盘/后台运行<br/>- 显示桌宠窗口(pet.html)"]
  Onboarding --> Idle

  %% 截图分析主线
  Idle --> ScreenshotHotkey["按下截图快捷键(F2或自定义)"]
  ScreenshotHotkey --> CropOverlay["屏幕区域截图<br/>(electron-screenshots)"]
  CropOverlay --> AIAnalyze["AI多模态分析(aiService.js)：<br/>- 判断是否适合旅行<br/>- 识别待办事项<br/>- 生成短文案"]
  AIAnalyze --> DecideAction{"AI判断结果？"}
  DecideAction -- "旅行" --> Bubble["气泡(bubble.html)：<br/>展示文案 + 空格确认"]
  DecideAction -- "待办" --> TodoAdd["自动添加待办<br/>(todoWindow.html)"]
  DecideAction -- "其他" --> PetReact["宠物表情切换 + 状态窗口显示"]
  Bubble --> StartJourneyEvent["用户确认 → 开始旅程"]
  StartJourneyEvent --> TravelMap["地图窗口(map.html)：<br/>起点(用户定位/IP) → 目的地(解析自文案)"]
  TravelMap --> DiaryLoop["旅程进行中：<br/>- 路线动画/进度条<br/>- 定时寄回旅行日记(真实时间/天气/方向)<br/>- 外链查看当地风景"]
  DiaryLoop --> TravelEnd["到达/结束"]

  %% 主动提醒
  Idle --> RemindLoop["活动监控(activityMonitor.js)：<br/>久坐/喝水周期检测"]
  RemindLoop --> RemindUI["提醒：<br/>- 原生通知<br/>- 喝水弹窗(waterReminder.html)<br/>- 趣味文案(AI生成)"]
  RemindUI --> UserAct{"用户操作？"}
  UserAct -- "已喝/稍后" --> BackIdle["关闭提醒并重置计时"]
  UserAct -- "无响应" --> ContinueRemind["继续提醒循环"]
  BackIdle --> Idle
  ContinueRemind --> RemindLoop

  %% 宠物交互
  Idle --> PetClick["点击桌宠"]
  PetClick --> FunReminder["触发趣味提醒<br/>(AI生成文案)"]
  FunReminder --> Idle

  %% 右键菜单
  Idle --> RightClick["桌宠右键 → 上下文菜单(contextMenu.html)"]
  RightClick --> Actions["操作：<br/>- 打开主页面(index.html)<br/>- 打开地图窗口<br/>- 打开待办窗口<br/>- 快捷键设置<br/>- 透明度调节<br/>- 退出应用"]
  Actions --> Idle

  %% 透明度调节
  Idle --> TransparencyCtrl["透明度控制<br/>(transparencyWindow.html)"]
  TransparencyCtrl --> Idle

  %% 待办管理
  TodoAdd --> TodoWindow["待办窗口(todoWindow.html)：<br/>- 查看待办列表<br/>- 标记完成<br/>- 删除待办"]
  TodoWindow --> Idle
```

## AI 赋能

| 阶段               | AI 角色      | 截屏                                     | 产出                                                                                                                                                       |
| ------------------ | ------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 需求分析 | 产品（Kimi） | ![gif](./docs/llm/20250806-kimi-du.gif) | [产品需求文档 (PRD)](./docs/PRD.md) |
| 竞品调研   | 市场（GPT Research）    | ![gif](./docs/llm/20250806-research-du.gif)     | [竞品调研报告](./docs/Research.docx)                                                                                                                                                       |
| MVP 实现 | 前端（通义灵码）     | ![gif](./docs/llm/20250806-lingma-du.gif)   | [V1 文档/代码](./docs/V1.md)                                                                                                                                                       |
| 功能/UI 完善     | 前端（Cursor）     | ![gif](./docs/llm/20250812-cursor-du.gif)   | [V2 文档/代码](./docs/V2.md)                                                                                                                                                       |

- cursor AI 对话记录：[杜睿](./docs/llm/20250812-cursor-du.md) 、[刘柏成1](./docs/llm/20250813-cursor-liu.md) 、[刘柏成2](./docs/llm/20250815-cursor-liu.md)
- AI 对话留痕（持续更新）：`./docs/llm`，`md`文件若大可能无法预览请下载查看。

## 运行指南

```bash
#进入项目目录
cd src

# 安装 Node.js 与 npm
npm install
npm start
```

参考 `.env.example`，配置：
- [阿里云百炼 API](https://bailian.console.aliyun.com/?tab=model#/api-key)（情绪陪伴功能）
- [高德地图 API](https://console.amap.com/dev/key/app)（云旅行功能）

## 未来计划

* 声音克隆（[SparkTTS](https://github.com/SparkAudio/Spark-TTS)）实现更拟人化的语音交互（BBS展示视频中声音为AI克隆声音，使用视频后期，计划中）
* 前端采用 three.js 打造更细致的视觉表现，增强 AI 情绪识别与多轮主动对话能力
* 桌面行为模式学习与个性化推荐
