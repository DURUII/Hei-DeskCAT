// 加载环境变量
require('dotenv').config();

const { app, BrowserWindow, globalShortcut, desktopCapturer, Notification, ipcMain, Menu } = require('electron');
const path = require('path');
const ActivityMonitor = require('./activityMonitor');
const { analyzeScreenshot, generateFunReminder, generateJourneyStatus } = require('./aiService');

// 禁用GPU加速以解决Passthrough错误
app.disableHardwareAcceleration();

// 设置应用用户模型ID，解决Windows通知问题
app.setAppUserModelId("com.desktripper.app");

// 禁用默认菜单栏
Menu.setApplicationMenu(null);

// 设置Electron缓存目录，解决权限问题
app.setPath('userData', path.join(app.getPath('appData'), 'DeskTripper'));

let mainWindow;
let mapWindow;
let bubbleWindow;
let waterReminderWindow;
let petWindow;
let activityMonitor;

// 创建主窗口
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true // 隐藏菜单栏
  });

  // 加载主界面
  mainWindow.loadFile('index.html');
  
  // 监听窗口中的用户活动
  mainWindow.webContents.on('dom-ready', () => {
    // 注入活动监听脚本
    mainWindow.webContents.executeJavaScript(`
      document.addEventListener('mousemove', () => {
        require('electron').ipcRenderer.send('user-activity');
      });
      
      document.addEventListener('keydown', () => {
        require('electron').ipcRenderer.send('user-activity');
      });
    `);
  });
}

// 创建宠物窗口
function createPetWindow() {
  petWindow = new BrowserWindow({
    width: 100,
    height: 100,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    skipTaskbar: true, // 不在任务栏显示
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    movable: true // 允许窗口移动
  });

  petWindow.loadFile('pet.html');
  
  // 设置宠物窗口位置到屏幕右下角
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  petWindow.setPosition(
    width - 120, 
    height - 120
  );
  
  // 点击窗口穿透
  petWindow.setIgnoreMouseEvents(false);
  
  return petWindow;
}

// 创建地图窗口
function createMapWindow() {
  mapWindow = new BrowserWindow({
    width: 300,
    height: 200,
    frame: false,
    alwaysOnTop: true,
    transparent: false, // 禁用透明度以提高兼容性
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    movable: true // 允许窗口移动
  });

  mapWindow.loadFile('map.html');
  
  // 设置地图窗口位置到屏幕右上角
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  mapWindow.setPosition(
    width - 310, 
    50
  );
  
  return mapWindow;
}

// 创建通知气泡窗口
function createBubbleWindow(message) {
  bubbleWindow = new BrowserWindow({
    width: 300,
    height: 100,
    frame: false,
    alwaysOnTop: true,
    transparent: false, // 禁用透明度以提高兼容性
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  bubbleWindow.loadFile('bubble.html');
  
  // 通过IPC将AI生成的消息传递给气泡窗口
  bubbleWindow.webContents.once('dom-ready', () => {
    bubbleWindow.webContents.send('update-bubble-message', message);
  });
  
  return bubbleWindow;
}

// 创建喝水提醒窗口
function createWaterReminderWindow() {
  if (waterReminderWindow) {
    waterReminderWindow.focus();
    return;
  }
  
  waterReminderWindow = new BrowserWindow({
    width: 300,
    height: 200,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  waterReminderWindow.loadFile('waterReminder.html');
  
  // 设置窗口位置到屏幕中央
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  waterReminderWindow.setPosition(
    Math.floor((width - 300) / 2), 
    Math.floor((height - 200) / 2)
  );
  
  waterReminderWindow.on('closed', () => {
    waterReminderWindow = null;
  });
  
  return waterReminderWindow;
}

// 截取屏幕截图
async function captureScreenshot() {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 200, height: 150 } });
    if (sources && sources.length > 0) {
      // 获取第一张屏幕截图
      const source = sources[0];
      const thumbnail = source.thumbnail;
      
      // 将截图转换为base64编码
      const base64Data = thumbnail.toDataURL().replace(/^data:image\/(png|jpeg);base64,/, '');
      
      // 使用AI分析截图内容
      const aiResponse = await analyzeScreenshot(base64Data);
      return aiResponse;
    }
  } catch (error) {
    console.error('截图捕获失败:', error);
  }
  
  // 默认响应
  return {
    message: "替你去看极光？",
    shouldTravel: true
  };
}

// 注册全局快捷键监听截图
function registerScreenshotListener() {
  try {
    // 先注销可能已注册的快捷键
    globalShortcut.unregister('F2');
    
    // 更改截图快捷键为F2
    const ret = globalShortcut.register('F2', async () => {
      console.log('Screenshot taken!');
      
      // 捕获并分析截图
      const aiResponse = await captureScreenshot();
      
      // 使用Windows原生通知显示AI回复
      const notification = {
        title: 'DeskTripper',
        body: aiResponse.message,
        icon: path.join(__dirname, 'icon.png') // 添加图标路径
      };
      
      if (Notification.isSupported()) {
        new Notification(notification).show();
      }
      
      // 如果AI判断需要触发旅行，则显示气泡提示
      if (aiResponse.shouldTravel) {
        // 显示AI生成的气泡提示
        setTimeout(() => {
          showScreenshotBubble(aiResponse.message);
        }, 1200);
      }
    });

    if (!ret) {
      console.log('Screenshot listener registration failed');
    } else {
      console.log('Screenshot listener registered successfully');
    }
  } catch (error) {
    console.log('Screenshot listener registration error:', error);
  }
  
  try {
    // 先注销可能已注册的快捷键
    globalShortcut.unregister('F3');
    
    // 注册测试用快捷键
    const ret2 = globalShortcut.register('F3', async () => {
      console.log('Manual water reminder triggered!');
      createWaterReminderWindow();
    });
    
    if (!ret2) {
      console.log('Water reminder listener registration failed');
    } else {
      console.log('Water reminder listener registered successfully');
    }
  } catch (error) {
    console.log('Water reminder listener registration error:', error);
  }
  
  try {
    // 先注销可能已注册的快捷键
    globalShortcut.unregister('F4');
    
    // 注册另一个测试用快捷键
    const ret3 = globalShortcut.register('F4', async () => {
      console.log('Manual fun reminder triggered!');
      // 生成AI趣味提醒
      const funMessage = await generateFunReminder();
      
      const notification = {
        title: '趣味提醒',
        body: funMessage,
        icon: path.join(__dirname, 'icon.png') // 添加图标路径
      };
      
      if (Notification.isSupported()) {
        new Notification(notification).show();
      }
    });
    
    if (!ret3) {
      console.log('Fun reminder listener registration failed');
    } else {
      console.log('Fun reminder listener registered successfully');
    }
  } catch (error) {
    console.log('Fun reminder listener registration error:', error);
  }
}

// 显示截图响应气泡（放置在右上角）
function showScreenshotBubble(message) {
  const bubbleWindow = createBubbleWindow(message);
  
  // 设置气泡窗口位置到屏幕右上角（避免遮挡通知区域）
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  bubbleWindow.setPosition(
    width - 310, 
    150 // 距离顶部150像素，避免遮挡Windows通知
  );
  
  // 10秒后自动关闭
  setTimeout(() => {
    if (bubbleWindow && !bubbleWindow.isDestroyed()) {
      bubbleWindow.close();
    }
  }, 10000);
}

// IPC事件处理：开始旅程
ipcMain.on('start-journey', async (event, data) => {
  console.log('Starting journey to:', data.destination);
  createMapWindow();
  
  // 可以在这里添加更多旅程启动逻辑
});

// IPC事件处理：用户活动
ipcMain.on('user-activity', () => {
  if (activityMonitor) {
    activityMonitor.updateActivity();
  }
});

// IPC事件处理：确认喝水
ipcMain.on('water-confirmed', () => {
  if (waterReminderWindow) {
    waterReminderWindow.close();
  }
  console.log('User confirmed drinking water');
});

// IPC事件处理：延迟喝水提醒
ipcMain.on('water-delayed', () => {
  if (waterReminderWindow) {
    waterReminderWindow.close();
  }
  console.log('User delayed drinking water reminder');
});

// IPC事件处理：手动触发喝水提醒
ipcMain.on('manual-water-reminder', () => {
  createWaterReminderWindow();
});

// IPC事件处理：手动触发趣味提醒
ipcMain.on('manual-fun-reminder', async () => {
  // 生成AI趣味提醒
  const funMessage = await generateFunReminder();
  
  const notification = {
    title: '趣味提醒',
    body: funMessage,
    icon: path.join(__dirname, 'icon.png') // 添加图标路径
  };
  
  if (Notification.isSupported()) {
    new Notification(notification).show();
  }
});

// IPC事件处理：显示当前旅程状态
ipcMain.on('check-journey-status', async () => {
  // 生成AI旅程状态
  const statusMessage = await generateJourneyStatus();
  
  const notification = {
    title: '旅程状态',
    body: statusMessage,
    icon: path.join(__dirname, 'icon.png') // 添加图标路径
  };
  
  if (Notification.isSupported()) {
    new Notification(notification).show();
  }
});

// 应用准备就绪时执行
app.whenReady().then(() => {
  // 等待一会儿再注册快捷键，避免冲突
  setTimeout(() => {
    createMainWindow();
    createPetWindow(); // 创建宠物窗口
    registerScreenshotListener();
    activityMonitor = new ActivityMonitor();
  }, 1000);
}).catch(err => {
  console.error('Failed to initialize app:', err);
});

// 应用激活时创建窗口（macOS）
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// 关闭所有窗口时退出应用（Windows & Linux）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 注销快捷键监听
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  
  // 清理活动监控
  if (activityMonitor) {
    activityMonitor.destroy();
  }
});