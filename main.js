// 加载环境变量
require('dotenv').config();

// 设置字符编码以解决乱码问题
process.env.LANG = 'zh_CN.UTF-8';

const { app, BrowserWindow, globalShortcut, desktopCapturer, Notification, ipcMain, Menu } = require('electron');
const path = require('path');
const ActivityMonitor = require('./activityMonitor');
const { analyzeScreenshot, generateFunReminder, generateJourneyStatus } = require('./aiService');
const AMapService = require('./amapService');

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
let contextMenuWindow = null; // 添加右键菜单窗口跟踪
let activityMonitor;
let amapService;

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

  // 监听窗口关闭事件，隐藏而不是销毁
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

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
    movable: true, // 允许窗口移动
    focusable: true // 允许窗口获得焦点
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

  // 监听宠物点击事件
  petWindow.webContents.on('dom-ready', () => {
    petWindow.webContents.executeJavaScript(`
      try {
        const pet = document.getElementById('pet');
        if (pet) {
          pet.addEventListener('click', () => {
            const messages = [
              '正在冰岛看极光✨',
              '在挪威森林里探险🌲',
              '于撒哈拉沙漠看星星🌟',
              '在日本樱花树下喝茶🌸',
              '在瑞士阿尔卑斯山滑雪⛷️'
            ];
            const message = messages[Math.floor(Math.random() * messages.length)];
            console.log('Pet clicked, sending message:', message);
            require('electron').ipcRenderer.send('pet-clicked', message);
          });
          console.log('Pet click event listener added successfully');
        } else {
          console.error('Pet element not found');
        }
      } catch (error) {
        console.error('Error setting up pet click listener:', error);
      }
    `).catch(error => {
      console.error('Error executing JavaScript in pet window:', error);
    });
  });

  // 监听宠物点击事件
  ipcMain.on('pet-clicked', (event, message) => {
    console.log('Pet clicked, showing status window with message:', message);
    try {
      createPetStatusWindow(message);
    } catch (error) {
      console.error('Error creating pet status window:', error);
    }
  });

  // 监听打开主窗口事件
  ipcMain.on('open-main-window', (event) => {
    console.log('Opening main window from pet context menu');
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createMainWindow();
      }
    } catch (error) {
      console.error('Error opening main window:', error);
    }
  });

  // 监听退出应用事件
  ipcMain.on('exit-app', (event) => {
    console.log('Exiting app from context menu');
    try {
      app.isQuitting = true;
      app.quit();
    } catch (error) {
      console.error('Error exiting app:', error);
    }
  });

  // 监听显示右键菜单事件
  ipcMain.on('show-context-menu', (event, x, y) => {
    console.log('Showing context menu at:', x, y);
    try {
      // 获取桌宠窗口位置来优化菜单显示方向
      const petPosition = petWindow ? petWindow.getPosition() : [0, 0];
      createContextMenuWindow(x, y, petPosition);

      // 设置全局点击监听器来关闭右键菜单
      setTimeout(() => {
        setupGlobalClickHandler();
      }, 100);
    } catch (error) {
      console.error('Error creating context menu window:', error);
    }
  });

  // 监听右键菜单关闭事件
  ipcMain.on('context-menu-closed', (event) => {
    console.log('Context menu closed by user action');
    contextMenuWindow = null;
  });

  // 监听关闭右键菜单事件
  ipcMain.on('close-context-menu', (event) => {
    console.log('Closing context menu from external request');
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      contextMenuWindow.close();
    }
  });

  return petWindow;
}

// 创建宠物状态弹窗窗口
function createPetStatusWindow(message) {
  const statusWindow = new BrowserWindow({
    width: 220,
    height: 120,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    movable: false,
    focusable: false
  });

  statusWindow.loadFile('petStatus.html');

  // 设置弹窗位置在宠物窗口上方
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // 获取宠物窗口位置
  const petPosition = petWindow ? petWindow.getPosition() : [width - 120, height - 120];

  statusWindow.setPosition(
    petPosition[0] - 60, // 居中显示
    petPosition[1] - 140 // 在宠物上方
  );

  // 通过IPC传递消息
  statusWindow.webContents.once('dom-ready', () => {
    try {
      console.log('Sending message to status window:', message);
      statusWindow.webContents.send('update-status-message', message);
    } catch (error) {
      console.error('Error sending message to status window:', error);
    }
  });

  // 监听窗口错误
  statusWindow.webContents.on('crashed', () => {
    console.error('Status window crashed');
  });

  statusWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Status window failed to load:', errorCode, errorDescription);
  });

  // 3秒后自动关闭
  setTimeout(() => {
    try {
      if (statusWindow && !statusWindow.isDestroyed()) {
        console.log('Auto-closing status window');
        statusWindow.close();
      }
    } catch (error) {
      console.error('Error closing status window:', error);
    }
  }, 3000);

  return statusWindow;
}

// 创建右键菜单窗口
function createContextMenuWindow(x, y, petPosition = [0, 0]) {
  // 关闭已存在的右键菜单
  if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
    console.log('Closing existing context menu window');
    try {
      contextMenuWindow.close();
      contextMenuWindow = null;
    } catch (error) {
      console.error('Error closing existing context menu:', error);
      contextMenuWindow = null;
    }
  }

  const newContextMenuWindow = new BrowserWindow({
    width: 180,
    height: 100,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    movable: false,
    focusable: true
  });

  newContextMenuWindow.loadFile('contextMenu.html');

  // 智能定位：避免被桌面边框遮挡，并根据桌宠位置优化显示方向
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // 菜单尺寸
  const menuWidth = 180;
  const menuHeight = 100;

  // 计算最佳位置
  let finalX = x;
  let finalY = y;

  // 水平方向调整
  if (x + menuWidth > screenWidth) {
    finalX = screenWidth - menuWidth - 10;
  }
  if (finalX < 10) {
    finalX = 10;
  }

  // 垂直方向调整 - 优先显示在桌宠上方，如果空间不够则显示在下方
  const [petX, petY] = petPosition;
  const spaceAbove = y;
  const spaceBelow = screenHeight - y - menuHeight;

  if (spaceAbove >= menuHeight + 20) {
    // 上方空间足够，显示在桌宠上方
    finalY = y - menuHeight - 10;
  } else if (spaceBelow >= menuHeight + 20) {
    // 下方空间足够，显示在桌宠下方
    finalY = y + 20;
  } else {
    // 上下空间都不够，调整到屏幕边界内
    if (y + menuHeight > screenHeight) {
      finalY = screenHeight - menuHeight - 10;
    }
    if (finalY < 10) {
      finalY = 10;
    }
  }

  console.log(`Context menu positioning: original(${x}, ${y}), pet(${petX}, ${petY}) -> final(${finalX}, ${finalY})`);
  newContextMenuWindow.setPosition(finalX, finalY);

  // 错误处理
  newContextMenuWindow.webContents.on('crashed', () => {
    console.error('Context menu window crashed');
  });
  newContextMenuWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Context menu window failed to load:', errorCode, errorDescription);
  });

  // 监听窗口关闭事件，清理全局变量
  newContextMenuWindow.on('closed', () => {
    contextMenuWindow = null;
    console.log('Context menu window closed, global variable cleared');
  });

  // 监听窗口即将关闭事件
  newContextMenuWindow.on('close', () => {
    console.log('Context menu window closing...');
  });

  // 自动关闭功能
  setTimeout(() => {
    try {
      if (newContextMenuWindow && !newContextMenuWindow.isDestroyed()) {
        console.log('Auto-closing context menu window');
        newContextMenuWindow.close();
      }
    } catch (error) {
      console.error('Error auto-closing context menu window:', error);
    }
  }, 5000); // 5秒后自动关闭

  // 更新全局变量
  contextMenuWindow = newContextMenuWindow;
  return newContextMenuWindow;
}

// 设置全局点击处理器来关闭右键菜单
function setupGlobalClickHandler() {
  if (!contextMenuWindow || contextMenuWindow.isDestroyed()) {
    return;
  }

  console.log('Setting up global click handler for context menu');

  // 简化版本：直接使用定时器检查右键菜单状态
  const checkInterval = setInterval(() => {
    if (!contextMenuWindow || contextMenuWindow.isDestroyed()) {
      clearInterval(checkInterval);
      console.log('Context menu closed, clearing click handler');
    }
  }, 100);

  // 5秒后自动清理
  setTimeout(() => {
    clearInterval(checkInterval);
  }, 5000);
}

// 创建地图窗口
function createMapWindow(travelData = { origin: '武汉光谷', destination: '北京天安门' }) {
  console.log('Creating map window, travel data:', travelData);

  // 清理旅行数据中的乱码字符
  const cleanTravelData = {
    origin: cleanText(travelData.origin) || '武汉光谷',
    destination: cleanText(travelData.destination) || '北京天安门',
    userLocation: travelData.userLocation || null
  };

  console.log('Cleaned travel data:', cleanTravelData);

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

  // 通过IPC将高德地图API Key和旅行信息传递给地图窗口
  mapWindow.webContents.once('dom-ready', () => {
    // 传递API Key
    console.log('Passing API Key to map window');
    mapWindow.webContents.executeJavaScript(`
      window.AMAP_KEY = '${process.env.AMAP_KEY || ''}';
      console.log('API Key set in map window:', window.AMAP_KEY ? window.AMAP_KEY.substring(0, 10) + '...' : 'Not set');
    `);

    // 发送旅行信息
    console.log('Sending travel info to map window');
    setTimeout(() => {
      mapWindow.webContents.send('travel-info', cleanTravelData);
    }, 1000);
  });

  // 监听地图窗口请求旅行信息
  ipcMain.on('request-travel-info', () => {
    console.log('Map window requesting travel info');
    if (mapWindow && !mapWindow.isDestroyed()) {
      mapWindow.webContents.send('travel-info', cleanTravelData);
    }
  });

  return mapWindow;
}

// 清理文本中的乱码字符
function cleanText(text) {
  if (!text) return text;

  // 移除常见的乱码字符
  return text.replace(/[^\x20-\x7E\u4e00-\u9fa5]/g, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5\s\-_]/g, '')
    .trim();
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
  // try {
  //   const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 200, height: 150 } });
  //   if (sources && sources.length > 0) {
  //     // 获取第一张屏幕截图
  //     const source = sources[0];
  //     const thumbnail = source.thumbnail;

  //     // 将截图转换为base64编码
  //     const base64Data = thumbnail.toDataURL().replace(/^data:image\/(png|jpeg);base64,/, '');

  //     // 使用AI分析截图内容
  //     const aiResponse = await analyzeScreenshot(base64Data);
  //     return aiResponse;
  //   }
  // } catch (error) {
  //   console.error('Screenshot capture failed:', error);
  // }

  // 默认响应
  return {
    message: "替你去看北京天安门？",
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
      console.log('AI analysis result:', aiResponse);

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
        title: 'Fun Reminder',
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

  // 提取目的地信息（从AI回复中提取地点名）
  let destination = '北京天安门';
  if (data.destination) {
    // 尝试从"替你去看[地点]？"格式中提取地点
    const match = data.destination.match(/替你去看(.+)[？\?]/);
    if (match && match[1]) {
      destination = match[1];
    } else {
      destination = data.destination;
    }
  }

  try {
    // 获取用户当前位置作为起点
    console.log('Getting user current location...');
    const userLocation = await amapService.getUserLocationDetails();
    console.log('User location info:', userLocation);

    // 创建地图窗口并传递旅行数据
    const travelData = {
      origin: `${userLocation.city}`,
      destination: destination,
      userLocation: userLocation
    };

    console.log('Creating map window, travel data:', travelData);
    createMapWindow(travelData);
  } catch (error) {
    console.error('Failed to get user location, using default location:', error);

    // 如果获取用户位置失败，使用默认位置
    const travelData = {
      origin: '武汉光谷',
      destination: destination
    };

    console.log('Using default location to create map window, travel data:', travelData);
    createMapWindow(travelData);
  }

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
    title: 'Fun Reminder',
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
    title: 'Journey Status',
    body: statusMessage,
    icon: path.join(__dirname, 'icon.png') // 添加图标路径
  };

  if (Notification.isSupported()) {
    new Notification(notification).show();
  }
});

// 应用准备就绪时执行
app.whenReady().then(() => {
  // 初始化高德地图服务
  amapService = new AMapService();
  console.log('AMap service initialization completed');

  // 检查API Key配置
  if (process.env.AMAP_KEY) {
    console.log('AMap API Key configured');
  } else {
    console.log('Warning: AMap API Key not configured');
  }

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

  // 移除IPC监听器
  ipcMain.removeAllListeners('request-travel-info');
});