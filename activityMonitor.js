const { app, Notification, BrowserWindow } = require('electron');
const Store = require('electron-store');
const { generateFunReminder } = require('./aiService');

class ActivityMonitor {
  constructor() {
    this.store = new Store();
    this.lastActivityTime = Date.now();
    this.lastWaterReminder = Date.now();
    this.lastFunReminder = Date.now();
    this.activityCheckInterval = null;
    this.inactivityThreshold = 5 * 60 * 1000; // 5分钟(测试用)  // 原来是60分钟
    this.waterReminderThreshold = 2 * 60 * 1000; // 2分钟(测试用)  // 原来是52分钟
    this.funReminderThreshold = 4 * 60 * 1000; // 4分钟(测试用)  // 原来是其他时间
    this.checkInterval = 30 * 1000; // 每30秒检查一次  // 原来是每分钟检查

    this.init();
  }

  init() {
    // 监听用户活动
    this.startActivityListener();

    // 启动定时检查
    this.startActivityCheck();
  }

  startActivityListener() {
    // 监听全局鼠标和键盘事件
    const { globalShortcut } = require('electron');

    // 使用节流方式监听活动
    const events = ['mousedown', 'mousemove', 'keydown', 'wheel'];

    events.forEach(eventType => {
      // 在主窗口中监听事件
      // 注意：实际应用中需要在渲染进程中监听这些事件并通过IPC通信
    });
  }

  startActivityCheck() {
    this.activityCheckInterval = setInterval(() => {
      this.checkInactivity();
      this.checkWaterReminder();
      this.checkFunReminder();
    }, this.checkInterval);
  }

  // 更新活动时间
  updateActivity() {
    this.lastActivityTime = Date.now();
  }

  // 检查不活动状态
  checkInactivity() {
    const now = Date.now();
    const inactiveDuration = now - this.lastActivityTime;

    // 如果超过设定时间未活动
    if (inactiveDuration > this.inactivityThreshold) {
      this.showInactivityNotification();
      // 重置活动时间，避免连续提醒
      this.lastActivityTime = now;
    }
  }

  // 检查喝水提醒
  checkWaterReminder() {
    const now = Date.now();
    const waterDuration = now - this.lastWaterReminder;

    // 如果超过设定时间未喝水
    if (waterDuration > this.waterReminderThreshold) {
      this.showWaterReminder();
      // 重置喝水时间
      this.lastWaterReminder = now;
    }
  }

  // 检查趣味提醒
  checkFunReminder() {
    const now = Date.now();
    const funDuration = now - this.lastFunReminder;

    // 如果超过设定时间
    if (funDuration > this.funReminderThreshold) {
      this.showFunReminder();
      // 重置趣味提醒时间
      this.lastFunReminder = now;
    }
  }

  // 显示不活动提醒
  showInactivityNotification() {
    const notification = {
      title: '休息提醒',
      body: '起来走两步，不然椅子会长你身上',
      icon: 'icon.png' // 需要提供图标文件
    };

    if (Notification.isSupported()) {
      new Notification(notification).show();
    }
  }

  // 显示喝水提醒
  showWaterReminder() {
    const messages = [
      { title: '喝水提醒', body: '再不喝水就要变成仙人掌了🌵' },
      { title: '健康小贴士', body: '你已经很久没有喝水啦，来杯水吧☕' },
      { title: '能量补给', body: '水是生命之源，快来补充能量💧' }
    ];

    const message = messages[Math.floor(Math.random() * messages.length)];

    const notification = {
      title: message.title,
      body: message.body,
      icon: 'icon.png' // 需要提供图标文件
    };

    if (Notification.isSupported()) {
      new Notification(notification).show();
    }

    // 同时显示窗口提醒
    this.showWaterReminderWindow();
  }

  // 显示趣味提醒（使用原生Windows通知）
  async showFunReminder() {
    try {
      // 使用AI生成趣味提醒内容
      const aiMessage = await generateFunReminder();

      const notification = {
        title: '趣味提醒',
        body: aiMessage,
        icon: 'icon.png'
      };

      // 使用原生Windows通知
      if (Notification.isSupported()) {
        new Notification(notification).show();
      }
    } catch (error) {
      console.error('Failed to generate AI fun reminder:', error);
      // 出错时使用默认提醒
      const messages = [
        { title: '趣事分享', body: '哇塞这个好好玩！✨' },
        { title: '代办事项', body: '已加入代办！✅' },
        { title: '灵感时刻', body: '脑中突然闪过一个好想法💡' },
        { title: '轻松一刻', body: '工作之余，记得微笑😊' }
      ];

      const message = messages[Math.floor(Math.random() * messages.length)];

      const notification = {
        title: message.title,
        body: message.body,
        icon: 'icon.png'
      };

      // 使用原生Windows通知
      if (Notification.isSupported()) {
        new Notification(notification).show();
      }
    }
  }

  // 显示旅程状态
  showJourneyStatus() {
    const notification = {
      title: '旅程状态',
      body: '你的小旅星正在冰岛看极光呢！预计还有15小时到达 🌌',
      icon: 'icon.png'
    };

    if (Notification.isSupported()) {
      new Notification(notification).show();
    }
  }

  // 显示喝水提醒窗口
  showWaterReminderWindow() {
    // 这里应该通过IPC与主进程通信来创建窗口
    // 为简化代码，在主进程中直接处理窗口创建
  }

  // 清理资源
  destroy() {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
    }
  }
}

module.exports = ActivityMonitor;