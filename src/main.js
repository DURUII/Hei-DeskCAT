// 加载环境变量
require('dotenv').config();

const { app, BrowserWindow, globalShortcut, Notification, ipcMain, Menu } = require('electron');
const Screenshots = require('electron-screenshots');
const path = require('path');
const { ActivityMonitor, setCreatePetStatusWindowFunction, setCreateWaterReminderWindowFunction } = require('./activityMonitor');
const { analyzeScreenshot, generateFunReminder, updatePetSettings } = require('./aiService');
const AMapService = require('./amapService');
const weatherService = require('./weatherService');

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
let todoWindow = null; // 待办窗口
let shortcutSettingsWindow = null; // 快捷键设置窗口
let petSettingsWindow = null; // 桌宠设置窗口
let contextMenuWindow = null;
let transparencyWindow = null; // 添加右键菜单窗口跟踪
let screenshots = null; // 第三方区域截屏实例

// 拖动相关变量
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// Promise缓存，防止重复请求
let weatherRequestCache = new Map(); // 天气请求缓存
let travelStatusRequestCache = new Map(); // 旅行状态请求缓存

// 吸附状态管理 - 暂时注释掉
// let isSnapped = false;
// let snapInfo = {
//   type: '',
//   position: null,
//   attachedWindow: null
// };

// 桌宠状态管理
let petStateTimer = null;
let currentPetEmotion = null;
const PET_STATE_DURATION = 5000; // 状态持续时间（毫秒）

// 添加透明度状态变量
let currentPetTransparency = 100;

// 全局旅行数据
let globalTravelData = null;

// 待办提醒相关变量
let todoReminderTimer = null;
let lastTodoReminderTime = 0;
const TODO_REMINDER_INTERVAL = 30 * 60 * 1000; // 30分钟提醒一次

// 旅行状态管理
let currentTravelStatus = {
  isInProgress: false,
  currentLocation: null,
  currentWeather: null,
  lastCity: null,
  totalDistance: 0,
  traveledDistance: 0,
  progress: 0,
  lastWeatherUpdateTime: 0,
  currentStatus: null,
  hasInitialStatusGenerated: false  // 添加初始状态生成标记
};

// 小旅星窗口管理
let petStatusWindow = null;
let activityMonitor;
let amapService;

// 使用Promise缓存获取天气信息，防止重复请求
async function getWeatherWithCache(lng, lat) {
  // 将坐标省略到三位小数，防止由于坐标变化导致重复请求
  const roundedLng = Math.round(lng * 1000) / 1000;
  const roundedLat = Math.round(lat * 1000) / 1000;
  const cacheKey = `${roundedLng}_${roundedLat}`;

  // 检查是否有进行中的请求
  if (weatherRequestCache.has(cacheKey)) {
    console.log('Weather request already in progress, waiting for result...');
    return await weatherRequestCache.get(cacheKey);
  }

  // 创建新的请求Promise
  const weatherPromise = weatherService.getWeatherByCoordinates(lng, lat);
  weatherRequestCache.set(cacheKey, weatherPromise);

  try {
    const result = await weatherPromise;
    return result;
  } finally {
    // 请求完成后清理缓存
    weatherRequestCache.delete(cacheKey);
  }
}

// 使用Promise缓存生成旅行状态，防止重复请求
async function generateTravelStatusWithCache(weatherInfo) {
  const cacheKey = `${weatherInfo.city}_${weatherInfo.weather}_${weatherInfo.temperature}`;

  // 检查是否有进行中的请求
  if (travelStatusRequestCache.has(cacheKey)) {
    console.log('Travel status generation already in progress, waiting for result...');
    return await travelStatusRequestCache.get(cacheKey);
  }

  // 创建新的请求Promise
  const { generateJourneyStatusWithLocation } = require('./aiService');
  const statusPromise = generateJourneyStatusWithLocation(weatherInfo.cityInfo, weatherInfo);
  travelStatusRequestCache.set(cacheKey, statusPromise);

  try {
    const result = await statusPromise;
    return result;
  } finally {
    // 请求完成后清理缓存
    travelStatusRequestCache.delete(cacheKey);
  }
}

// 创建主窗口
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
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
    focusable: true, // 允许窗口获得焦点
    type: 'toolbar' // 设置为工具栏类型，确保始终在最顶层
  });

  petWindow.loadFile('pet.html');

  // 设置宠物窗口初始位置到右下角
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  petWindow.setPosition(
    width - 120,
    height - 120
  );

  // 允许鼠标事件，但不穿透
  petWindow.setIgnoreMouseEvents(false);

  // 设置窗口可以拖拽
  petWindow.setMovable(true);

  // 确保窗口始终在最顶层
  petWindow.setAlwaysOnTop(true, 'screen-saver');

  // 监听窗口失去焦点事件，确保重新置顶
  petWindow.on('blur', () => {
    if (!petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  // 监听窗口隐藏事件，确保重新显示时置顶
  petWindow.on('show', () => {
    if (!petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  // 定期检查并确保窗口始终在最顶层
  const ensureTopMost = setInterval(() => {
    if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
      petWindow.setAlwaysOnTop(true, 'screen-saver');
    } else {
      clearInterval(ensureTopMost);
    }
  }, 5000); // 每5秒检查一次

  // 监听宠物点击事件
  petWindow.webContents.on('dom-ready', () => {
    petWindow.webContents.executeJavaScript(`
      try {
        const pet = document.getElementById('pet');
        if (pet) {
          pet.addEventListener('click', () => {
            console.log('Pet clicked, triggering fun reminder');
            require('electron').ipcRenderer.send('pet-clicked');
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

  // 监听宠物点击事件 - 触发趣味提醒
  ipcMain.on('pet-clicked', async (event) => {
    console.log('Pet clicked, triggering fun reminder');
    await showFunReminder();
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

  // 监听获取宠物窗口位置事件
  ipcMain.on('get-pet-window-position', (event) => {
    if (petWindow && !petWindow.isDestroyed()) {
      try {
        const [x, y] = petWindow.getPosition();
        event.reply('pet-window-position', x, y);
        console.log('获取宠物窗口位置:', x, y);
      } catch (error) {
        console.error('获取宠物窗口位置失败:', error);
      }
    }
  });

  // 监听拖动开始事件
  ipcMain.on('drag-start', (event, { offsetX, offsetY }) => {
    console.log('Drag started with offset:', offsetX, offsetY);
    isDragging = true;
    dragOffset = { x: offsetX, y: offsetY };

    // 拖动开始时清除吸附状态，确保正常拖动 - 暂时注释掉
    /*
    if (isSnapped) {
      console.log('拖动开始，清除吸附状态');
      isSnapped = false;
      snapInfo = {
        type: '',
        position: null,
        attachedWindow: null
      };
      
      // 清除吸附窗口记录
      if (petWindow && petWindow.attachedToWindow) {
        delete petWindow.attachedToWindow;
      }
    }
    */

    // 临时禁用点击穿透，允许拖动
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(false);
      // 确保窗口可以接收鼠标事件
      petWindow.setMovable(true);
      petWindow.setFocusable(true);
    }
  });

  // 监听绝对位置移动 - 简化版本，只设置位置不记录日志
  ipcMain.on('move-pet-absolute', (event, { mouseX, mouseY }) => {
    if (petWindow && isDragging) {
      // 拖动过程中直接设置位置，不进行任何检查或记录
      const newX = Math.round(mouseX - dragOffset.x);
      const newY = Math.round(mouseY - dragOffset.y);
      petWindow.setPosition(newX, newY);
    }
  });

  // 监听设置宠物窗口位置事件（保留用于其他功能）
  ipcMain.on('set-pet-window-position', (event, x, y) => {
    if (petWindow && !petWindow.isDestroyed()) {
      try {
        petWindow.setPosition(x, y);
        console.log('设置宠物窗口位置:', x, y);
      } catch (error) {
        console.error('设置宠物窗口位置失败:', error);
      }
    }
  });

  // 监听拖拽结束事件，进行边缘吸附
  ipcMain.on('drag-end', (event) => {
    console.log('Drag ended');
    isDragging = false;

    // 恢复正常的鼠标事件处理，允许右键菜单和点击
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(false);
      // 确保窗口可以接收所有鼠标事件
      petWindow.setMovable(true);
      petWindow.setFocusable(true);
    }

    // 拖动结束后进行吸附判定 - 暂时注释掉
    // performSnapCheck();

    // 延迟确保位置更新完成
    setTimeout(() => {
      console.log('Drag ended, position should be updated');
      // 可以在这里添加拖动结束后的其他逻辑
    }, 50);
  });

  // 监听手动重置状态事件（用于调试）
  ipcMain.on('manual-reset-pet-state', (event) => {
    console.log('手动重置桌宠状态');
    resetPetState();
  });

  // 监听状态查询事件
  ipcMain.on('query-pet-state', (event) => {
    const stateInfo = {
      currentEmotion: currentPetEmotion,
      hasTimer: petStateTimer !== null,
      timeRemaining: petStateTimer ? PET_STATE_DURATION : 0
    };
    console.log('当前桌宠状态:', stateInfo);
    event.reply('pet-state-info', stateInfo);
  });

  // 监听旅行位置更新事件
  ipcMain.on('travel-position-update', async (event, data) => {
    try {
      // console.log('Travel position update received:', data);

      // 更新当前位置
      if (data.lng && data.lat) {
        currentTravelStatus.currentLocation = { lng: data.lng, lat: data.lat };
        currentTravelStatus.progress = data.progress || 0;

        // 设置天气服务的当前位置
        weatherService.setCurrentLocation(data.lng, data.lat);

        // 控制天气更新频率，避免QPS超限
        const now = Date.now();
        const weatherUpdateInterval = 300000; // 5分钟更新一次

        // 确保始终有一个旅行状态显示，但避免重复初始化
        if (!currentTravelStatus.currentStatus && !currentTravelStatus.hasInitialStatusGenerated) {
          // 如果还没有旅行状态，尝试生成一个
          try {
            console.log('Generating initial travel status for location:', data.lng, data.lat);
            const weatherInfo = await getWeatherWithCache(data.lng, data.lat);
            const status = await generateTravelStatusWithCache(weatherInfo);
            currentTravelStatus.currentStatus = status;
            currentTravelStatus.hasInitialStatusGenerated = true; // 标记已生成初始状态
            console.log('Initial AI Generated travel status:', status);

            // 向地图窗口发送旅行状态
            if (mapWindow && !mapWindow.isDestroyed()) {
              mapWindow.webContents.send('travel-status-update', status);
            }
          } catch (error) {
            console.error('Error generating initial travel status:', error);
          }
        }

        if (now - currentTravelStatus.lastWeatherUpdateTime > weatherUpdateInterval) {
          try {
            // 获取当前位置的天气信息
            const weatherInfo = await getWeatherWithCache(data.lng, data.lat);
            currentTravelStatus.currentWeather = weatherInfo;
            currentTravelStatus.lastWeatherUpdateTime = now;
            console.log(`Travel weather updated: ${weatherInfo.city} - ${weatherInfo.summary}`);

            // 使用AI生成基于位置和天气的旅行状态
            try {
              const status = await generateTravelStatusWithCache(weatherInfo);
              currentTravelStatus.currentStatus = status;
              console.log('AI Generated travel status:', status);

              // 向地图窗口发送旅行状态
              if (mapWindow && !mapWindow.isDestroyed()) {
                mapWindow.webContents.send('travel-status-update', status);
              }
            } catch (aiError) {
              console.error('Error generating AI travel status:', aiError);
            }
          } catch (error) {
            console.error('Error updating travel weather:', error);
          }
        }

        // 标记旅行正在进行
        currentTravelStatus.isInProgress = true;
      }
    } catch (error) {
      console.error('Error updating travel position:', error);
    }
  });

  // 监听旅行状态查询事件
  ipcMain.on('query-travel-status', (event) => {
    console.log('Travel status requested:', currentTravelStatus);
    event.reply('travel-status-info', currentTravelStatus);
  });

  // 监听显示旅行状态事件
  ipcMain.on('show-travel-status', async (event) => {
    try {
      console.log('Show travel status requested');

      // 检查是否有进行中的旅行
      if (!currentTravelStatus.isInProgress) {
        createPetStatusWindow('还没有开始旅行呢！按F2截图开始新的旅程吧✈️');
        return;
      }

      // 使用AI生成的基于位置和天气的旅行状态
      if (currentTravelStatus.currentStatus) {
        createPetStatusWindow(currentTravelStatus.currentStatus);
      } else {
        createPetStatusWindow('正在旅行中...');
      }
    } catch (error) {
      console.error('Error showing travel status:', error);
      createPetStatusWindow('无法获取旅行状态信息');
    }
  });

  // 监听获取当前天气事件
  ipcMain.on('get-current-weather', async (event) => {
    try {
      const weatherInfo = await weatherService.getCurrentWeather();
      console.log('Current weather requested:', weatherInfo);
      event.reply('current-weather-info', weatherInfo);
    } catch (error) {
      console.error('Error getting current weather:', error);
      event.reply('current-weather-info', weatherService.getDefaultWeather());
    }
  });

  // 监听地图天气请求事件
  ipcMain.on('get-weather-for-coordinates', async (event, data) => {
    try {
      if (!data.lng || !data.lat) {
        console.error('Invalid coordinates for weather request');
        return;
      }

      const weatherInfo = await getWeatherWithCache(data.lng, data.lat);

      // 发送天气信息回地图窗口
      if (mapWindow && !mapWindow.isDestroyed()) {
        mapWindow.webContents.send('weather-info-response', weatherInfo);
      }
    } catch (error) {
      console.error('Error getting weather for map:', error);
      // 发送默认天气信息
      if (mapWindow && !mapWindow.isDestroyed()) {
        mapWindow.webContents.send('weather-info-response', weatherService.getDefaultWeather());
      }
    }
  });

  // 监听右键菜单关闭事件

  // 吸附检查函数 - 在拖动结束后执行 - 暂时注释掉
  /*
  function performSnapCheck() {
    if (!petWindow || petWindow.isDestroyed()) {
      return;
    }
   
    try {
      const [x, y] = petWindow.getPosition();
      const [width, height] = petWindow.getSize();
   
      // 获取屏幕尺寸
      const { screen } = require('electron');
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
   
      // 边缘吸附阈值（像素）
      const snapThreshold = 50;
   
      let newX = x;
      let newY = y;
      let snapped = false;
      let snapType = '';
      let shouldFlip = false;
   
      // 只进行屏幕边缘吸附，不吸附到其他窗口
      // 移除窗口吸附相关代码
   
      // 检测屏幕边缘吸附
      let screenSnapped = false;
   
      // 检测左边缘吸附
      if (x <= snapThreshold) {
        newX = 0;
        screenSnapped = true;
        snapType = '左边缘';
      }
      // 检测右边缘吸附
      else if (x + width >= screenWidth - snapThreshold) {
        newX = screenWidth - width;
        screenSnapped = true;
        snapType = '右边缘';
      }
   
      // 检测上边缘吸附
      if (y <= snapThreshold) {
        newY = 0;
        screenSnapped = true;
        snapType = '上边缘';
        shouldFlip = true; // 顶部吸附时翻转
      }
      // 检测下边缘吸附
      else if (y + height >= screenHeight - snapThreshold) {
        newY = screenHeight - height;
        screenSnapped = true;
        snapType = '下边缘';
      }
   
      // 特殊处理：屏幕角落吸附
      const cornerThreshold = 30;
   
      // 左上角
      if (x <= cornerThreshold && y <= cornerThreshold) {
        newX = 0;
        newY = 0;
        screenSnapped = true;
        snapType = '左上角';
        shouldFlip = true;
      }
      // 右上角
      else if (x + width >= screenWidth - cornerThreshold && y <= cornerThreshold) {
        newX = screenWidth - width;
        newY = 0;
        screenSnapped = true;
        snapType = '右上角';
        shouldFlip = true;
      }
      // 左下角
      else if (x <= cornerThreshold && y + height >= screenHeight - cornerThreshold) {
        newX = 0;
        newY = screenHeight - height;
        screenSnapped = true;
        snapType = '左下角';
      }
      // 右下角
      else if (x + width >= screenWidth - cornerThreshold && y + height >= screenHeight - cornerThreshold) {
        newX = screenWidth - width;
        newY = screenHeight - height;
        screenSnapped = true;
        snapType = '右下角';
      }
   
      
   
      // 只进行屏幕边缘吸附
      if (screenSnapped) {
        snapped = true;
        
        // 更新全局吸附状态
        isSnapped = true;
        snapInfo = {
          type: snapType,
          position: [newX, newY],
          attachedWindow: null
        };
   
        // 清除吸附窗口记录
        if (petWindow.attachedToWindow) {
          delete petWindow.attachedToWindow;
        }
      } else {
        // 没有吸附，清除吸附状态
        isSnapped = false;
        snapInfo = {
          type: '',
          position: null,
          attachedWindow: null
        };
        
        // 清除吸附窗口记录
        if (petWindow.attachedToWindow) {
          delete petWindow.attachedToWindow;
        }
      }
   
      // 如果检测到边缘吸附，移动窗口
      if (snapped) {
        petWindow.setPosition(newX, newY);
   
        console.log('边缘吸附完成:', {
          from: [x, y],
          to: [newX, newY],
          type: snapType,
          shouldFlip: shouldFlip,
          isSnapped: isSnapped
        });
   
        // 只通知渲染进程位置和翻转信息，不包含吸附类型消息
        petWindow.webContents.send('snap-completed', newX, newY, '', shouldFlip);
      } else {
        console.log('未检测到吸附，清除吸附状态');
      }
   
    } catch (error) {
      console.error('边缘吸附检查失败:', error);
    }
  }
  */

  // 监听右键菜单关闭事件
  ipcMain.on('context-menu-closed', (event) => {
    console.log('Context menu closed by user action');
    contextMenuWindow = null;
  });

  // 处理透明度调节
  ipcMain.on('set-pet-transparency', (event, transparency) => {
    try {
      // 保存当前透明度值
      currentPetTransparency = transparency;

      if (petWindow && !petWindow.isDestroyed()) {
        // 使用CSS样式而不是Electron的setOpacity方法来控制透明度
        // 将百分比转换为0-1的范围
        const opacity = transparency / 100;
        petWindow.webContents.executeJavaScript(`
          // 通过修改根元素的样式来控制透明度，避免影响其他样式
          document.documentElement.style.opacity = ${opacity};
        `);
      } else {
      }
    } catch (error) {
      console.error('Error setting pet transparency:', error);
    }
  });

  // 打开透明度控制窗口
  ipcMain.on('open-transparency-window', (event) => {
    try {
      // 关闭已存在的透明度窗口
      if (transparencyWindow && !transparencyWindow.isDestroyed()) {
        transparencyWindow.close();
        transparencyWindow = null;
      }

      // 获取右键菜单窗口位置
      let x = 0, y = 0;
      if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
        const bounds = contextMenuWindow.getBounds();
        x = bounds.x + bounds.width + 10; // 在右键菜单右侧显示
        y = bounds.y;
      }

      const newTransparencyWindow = new BrowserWindow({
        width: 160,
        height: 120,
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
        focusable: true,
        x: x,
        y: y,
        // 确保透明度窗口在右键菜单之上显示，但不关闭右键菜单
        parent: contextMenuWindow,
        modal: false
      });

      newTransparencyWindow.loadFile('transparencyWindow.html');

      // 窗口加载完成后发送当前透明度值
      newTransparencyWindow.webContents.once('dom-ready', () => {
        newTransparencyWindow.webContents.send('current-pet-transparency', currentPetTransparency);
      });

      newTransparencyWindow.webContents.on('crashed', () => {
        console.error('Transparency window crashed');
        transparencyWindow = null;
      });

      newTransparencyWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Transparency window failed to load:', errorDescription);
        transparencyWindow = null;
      });

      newTransparencyWindow.on('closed', () => {
        transparencyWindow = null;
        console.log('Transparency window closed. Final transparency value:', currentPetTransparency);
      });

      transparencyWindow = newTransparencyWindow;
    } catch (error) {
      console.error('Error creating transparency window:', error);
    }
  });

  // 关闭透明度控制窗口
  ipcMain.on('close-transparency-window', (event) => {
    console.log('Closing transparency control window');
    try {
      if (transparencyWindow && !transparencyWindow.isDestroyed()) {
        transparencyWindow.close();
        transparencyWindow = null;
      }
    } catch (error) {
      console.error('Error closing transparency window:', error);
    }
  });

  // 监听透明度窗口关闭事件
  ipcMain.on('transparency-window-closed', (event) => {
    console.log('Transparency window closed by user action');
    transparencyWindow = null;

    // 透明度窗口关闭后，检查是否需要关闭右键菜单
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      // 延迟关闭右键菜单，给用户一些时间
      setTimeout(() => {
        if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
          console.log('Closing context menu after transparency window closed');
          contextMenuWindow.close();
        }
      }, 1000); // 1秒后关闭右键菜单
    }
  });

  // 监听透明度窗口打开事件
  ipcMain.on('transparency-window-opened', (event) => {
    console.log('Transparency window opened');
    // 通知右键菜单透明度窗口状态，并保持右键菜单打开
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      try {
        contextMenuWindow.webContents.send('transparency-window-status', true);
        // 确保右键菜单保持在前台
        contextMenuWindow.setAlwaysOnTop(true, 'screen-saver');
      } catch (error) {
        console.error('Error sending transparency window status to context menu:', error);
      }
    }
  });

  // 监听透明度窗口状态更新
  ipcMain.on('transparency-window-status', (event, isOpen) => {
    console.log('Transparency window status update:', isOpen);
    // 转发状态到右键菜单
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      try {
        contextMenuWindow.webContents.send('transparency-window-status', isOpen);
      } catch (error) {
        console.error('Error forwarding transparency window status:', error);
      }
    }
  });

  // 监听打开地图窗口请求
  ipcMain.on('open-map-window', (event) => {
    console.log('Opening map window from context menu');
    try {
      if (mapWindow && !mapWindow.isDestroyed()) {
        mapWindow.show();
        mapWindow.focus();
      } else {
        // 检查是否有旅行数据
        if (globalTravelData && globalTravelData.origin && globalTravelData.destination) {
          // 有旅行数据，创建地图窗口
          createMapWindow(globalTravelData);
        } else {
          // 没有旅行数据，显示状态提醒
          console.log('No travel data available, showing status reminder');
          const reminderMessage = '还没有设置目的地，请按F2截图触发旅行！';
          createPetStatusWindow(reminderMessage);
        }
      }
    } catch (error) {
      console.error('Error opening map window:', error);
    }
  });

  // 监听打开待办窗口请求
  ipcMain.on('open-todo-window', (event) => {
    console.log('Opening todo window from context menu');
    try {
      createTodoWindow();
    } catch (error) {
      console.error('Error opening todo window:', error);
    }
  });

  // 监听打开桌宠设置窗口请求
  ipcMain.on('open-pet-settings', (event) => {
    console.log('Opening pet settings window from context menu');
    try {
      createPetSettingsWindow();
    } catch (error) {
      console.error('Error opening pet settings window:', error);
    }
  });

  // 监听桌宠设置更新请求
  ipcMain.on('pet-settings-updated', (event, settings) => {
    console.log('Pet settings updated:', settings);
    // 更新AI服务中的桌宠设置
    updatePetSettings(settings);
  });

  // 监听打开快捷键设置窗口请求
  ipcMain.on('open-shortcut-settings', (event) => {
    console.log('Opening shortcut settings window from context menu');
    try {
      createShortcutSettingsWindow();
    } catch (error) {
      console.error('Error opening shortcut settings window:', error);
    }
  });

  // 监听快捷键更新请求
  ipcMain.on('update-shortcuts', (event, shortcuts) => {
    console.log('Updating shortcuts:', shortcuts);
    try {
      updateGlobalShortcuts(shortcuts);
    } catch (error) {
      console.error('Error updating shortcuts:', error);
    }
  });

  // 监听禁用快捷键请求
  ipcMain.on('disable-shortcuts', () => {
    console.log('Disabling global shortcuts');
    try {
      globalShortcut.unregisterAll();
    } catch (error) {
      console.error('Error disabling shortcuts:', error);
    }
  });

  // 监听启用快捷键请求
  ipcMain.on('enable-shortcuts', (event, shortcuts) => {
    console.log('Enabling global shortcuts:', shortcuts);
    try {
      updateGlobalShortcuts(shortcuts);
    } catch (error) {
      console.error('Error enabling shortcuts:', error);
    }
  });

  // 监听关闭右键菜单事件
  ipcMain.on('close-context-menu', (event) => {
    console.log('Closing context menu from external request');
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      contextMenuWindow.close();
    }
  });

  // 监听关闭小旅星窗口事件
  ipcMain.on('close-pet-status-window', (event) => {
    console.log('Closing pet status window from external request');
    if (petStatusWindow && !petStatusWindow.isDestroyed()) {
      petStatusWindow.close();
    }
  });

  // 设置窗口移动监听器
  // setupWindowMoveListener(); // 暂时注释掉

  return petWindow;
}

// 初始化第三方区域截图并接入 AI 处理
function setupScreenshots() {
  try {
    screenshots = new Screenshots({ singleWindow: false });

    screenshots.on('ok', async (e, buffer /* PNG Buffer */, bounds) => {
      try {
        const base64 = Buffer.from(buffer).toString('base64');
        const aiResponse = await analyzeScreenshot(base64);
        console.log('AI analysis result (region):', aiResponse);
        handleAIResponse(aiResponse);
      } catch (err) {
        console.error('AI analyze error for region:', err);
      }
    });

    screenshots.on('cancel', () => {
      console.log('Region capture canceled');
      // 恢复默认表情
      resetPetState();
    });

    screenshots.on('error', (e, err) => {
      console.error('screenshots error:', err);
    });
  } catch (e) {
    console.error('Failed to setup electron-screenshots:', e);
  }
}

// 统一处理AI响应到UI
function handleAIResponse(aiResponse) {
  try {
    if (!aiResponse) return;
    // 使用小旅星窗口显示AI回复
    createPetStatusWindow(aiResponse.message);

    // 如果AI判断需要触发旅行，则显示气泡提示
    if (aiResponse.actions?.travel?.shouldTrigger) {
      setTimeout(() => {
        showScreenshotBubble(aiResponse.message);
      }, 1200);
    }

    // 如果AI判断需要添加待办，则自动添加到待办列表
    if (aiResponse.actions?.todo?.shouldTrigger && aiResponse.actions.todo.content) {
      setTimeout(() => {
        addTodoFromAI(aiResponse.actions.todo.content);
      }, 1500);
    }

    // 切换宠物表情并设置状态复原
    if (aiResponse.emotion && petWindow && !petWindow.isDestroyed()) {
      try {
        petWindow.webContents.send('change-emotion', aiResponse.emotion);
        setPetState(aiResponse.emotion);
      } catch (error) {
        console.error('Failed to send emotion change:', error);
      }
    }
  } catch (e) {
    console.error('handleAIResponse error:', e);
  }
}

// 从AI响应添加待办事项
function addTodoFromAI(content) {
  try {
    // 将待办内容存储到localStorage中
    const todoData = {
      content: content,
      timestamp: Date.now()
    };

    // 通过主进程的webContents执行localStorage操作
    if (todoWindow && !todoWindow.isDestroyed()) {
      todoWindow.webContents.executeJavaScript(`
        localStorage.setItem('ai_todo_pending', '${JSON.stringify(todoData)}');
        // 触发检查
        if (typeof checkForAITodo === 'function') {
          checkForAITodo();
        }
      `);
      console.log('Todo data stored via localStorage:', content);
    } else {
      // 如果待办窗口未打开，先创建窗口
      console.log('Todo window does not exist, creating new window');
      const newTodoWindow = createTodoWindow();

      if (newTodoWindow) {
        // 等待窗口完全加载后再存储数据
        newTodoWindow.webContents.once('did-finish-load', () => {
          console.log('Todo window loaded, storing data');
          setTimeout(() => {
            if (newTodoWindow && !newTodoWindow.isDestroyed()) {
              newTodoWindow.webContents.executeJavaScript(`
                localStorage.setItem('ai_todo_pending', '${JSON.stringify(todoData)}');
                // 触发检查
                if (typeof checkForAITodo === 'function') {
                  checkForAITodo();
                }
              `);
              console.log('Todo data stored after window creation:', content);
            } else {
              console.error('Todo window was destroyed before data could be stored');
              const message = `📝 AI已识别到待办事项：${content}\n请手动打开待办窗口添加！`;
              createPetStatusWindow(message);
            }
          }, 500); // 减少等待时间
        });
      } else {
        console.error('Failed to create todo window');
        const message = `📝 AI已识别到待办事项：${content}\n请手动打开待办窗口添加！`;
        createPetStatusWindow(message);
      }
    }
  } catch (error) {
    console.error('Error adding todo from AI:', error);
    // 出错时显示提示信息
    const message = `📝 AI已识别到待办事项：${content}\n请手动打开待办窗口添加！`;
    createPetStatusWindow(message);
  }
}

// 切换宠物窗口显示/隐藏
function togglePetWindow() {
  try {
    if (petWindow && !petWindow.isDestroyed()) {
      if (petWindow.isVisible()) {
        petWindow.hide();
        console.log('Pet window hidden');
      } else {
        petWindow.show();
        petWindow.focus();
        petWindow.setAlwaysOnTop(true, 'screen-saver');
        console.log('Pet window shown');
      }
    } else {
      // 如果宠物窗口不存在，创建新的
      createPetWindow();
      // 确保新创建的窗口也置顶
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      console.log('Pet window created');
    }
  } catch (error) {
    console.error('Error toggling pet window:', error);
  }
}

// 加载并注册快捷键
function loadAndRegisterShortcuts() {
  try {
    // 默认快捷键配置
    const defaultShortcuts = {
      'ai-screenshot': { key: 'F2', description: 'AI区域截图' },
      'water-reminder': { key: 'F3', description: '喝水提醒' },
      'fun-reminder': { key: 'F4', description: '趣味提醒' },
      'toggle-pet': { key: 'Ctrl+H', description: '桌宠隐藏/显示' },
      'open-map': { key: 'Ctrl+M', description: '打开地图' },
      'open-todo': { key: 'Ctrl+T', description: '打开待办' },
      'open-main': { key: 'Ctrl+O', description: '打开主页面' },
      'show-travel-status': { key: 'Ctrl+G', description: '显示旅行状态' }
    };

    // 尝试从localStorage加载自定义设置
    let shortcuts = defaultShortcuts;

    // 注意：主进程无法直接访问localStorage，所以这里使用默认设置
    // 实际的快捷键更新会在快捷键设置窗口中通过IPC进行

    // 注册快捷键
    Object.entries(shortcuts).forEach(([action, config]) => {
      try {
        const key = config.key.toLowerCase();
        let accelerator = key;

        // 处理组合键
        if (key.includes('+')) {
          accelerator = key;
        } else if (key.startsWith('f') && key.length > 1) {
          // F键处理
          accelerator = key.toUpperCase();
        } else {
          accelerator = key.toUpperCase();
        }

        console.log(`Registering shortcut: ${action} -> ${accelerator}`);

        const success = globalShortcut.register(accelerator, async () => {
          await handleShortcutAction(action);
        });

        if (success) {
          console.log(`Successfully registered shortcut: ${action} -> ${accelerator}`);
        } else {
          console.error(`Failed to register shortcut: ${action} -> ${accelerator}`);
        }
      } catch (error) {
        console.error(`Error registering shortcut for ${action}:`, error);
      }
    });

    console.log('Global shortcuts loaded and registered successfully');
  } catch (error) {
    console.error('Error loading and registering shortcuts:', error);
  }
}

// 更新全局快捷键
function updateGlobalShortcuts(shortcuts) {
  try {
    // 先注销所有现有的快捷键
    globalShortcut.unregisterAll();

    // 重新注册新的快捷键
    Object.entries(shortcuts).forEach(([action, config]) => {
      try {
        const key = config.key.toLowerCase();
        let accelerator = key;

        // 处理组合键
        if (key.includes('+')) {
          accelerator = key;
        } else if (key.startsWith('f') && key.length > 1) {
          // F键处理
          accelerator = key.toUpperCase();
        } else {
          accelerator = key.toUpperCase();
        }

        console.log(`Registering shortcut: ${action} -> ${accelerator}`);

        const success = globalShortcut.register(accelerator, async () => {
          await handleShortcutAction(action);
        });

        if (success) {
          console.log(`Successfully registered shortcut: ${action} -> ${accelerator}`);
        } else {
          console.error(`Failed to register shortcut: ${action} -> ${accelerator}`);
        }
      } catch (error) {
        console.error(`Error registering shortcut for ${action}:`, error);
      }
    });

    console.log('Global shortcuts updated successfully');
  } catch (error) {
    console.error('Error updating global shortcuts:', error);
  }
}

// 处理快捷键动作
async function handleShortcutAction(action) {
  try {
    console.log(`Shortcut action triggered: ${action}`);

    switch (action) {
      case 'ai-screenshot':
        // 启动区域截图
        if (screenshots) {
          try {
            petWindow && petWindow.webContents.send('change-emotion', '好复杂');
          } catch (e) { }
          createPetStatusWindow('思考中…');
          screenshots.startCapture();
        } else {
          console.error('Screenshots not initialized');
          createPetStatusWindow('截图功能未初始化');
        }
        break;
      case 'water-reminder':
        createWaterReminderWindow();
        break;
      case 'fun-reminder':
        await showFunReminder();
        break;
      case 'toggle-pet':
        togglePetWindow();
        break;
      case 'open-map':
        // 使用与右键菜单相同的逻辑
        if (mapWindow && !mapWindow.isDestroyed()) {
          mapWindow.show();
          mapWindow.focus();
        } else {
          // 检查是否有旅行数据
          if (globalTravelData && globalTravelData.origin && globalTravelData.destination) {
            // 有旅行数据，创建地图窗口
            createMapWindow(globalTravelData);
          } else {
            // 没有旅行数据，显示状态提醒
            console.log('No travel data available, showing status reminder');
            const reminderMessage = '还没有设置目的地，请按F2截图触发旅行！';
            createPetStatusWindow(reminderMessage);
          }
        }
        break;
      case 'open-todo':
        createTodoWindow();
        break;
      case 'open-main':
        // 使用与右键菜单相同的逻辑
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
        break;
      case 'show-travel-status':
        // 使用与右键菜单相同的逻辑
        try {
          console.log('Show travel status requested via shortcut');

          // 检查是否有进行中的旅行
          if (!currentTravelStatus.isInProgress) {
            createPetStatusWindow('还没有开始旅行呢！按F2截图开始新的旅程吧✈️');
            return;
          }

          // 使用AI生成的基于位置和天气的旅行状态
          if (currentTravelStatus.currentStatus) {
            createPetStatusWindow(currentTravelStatus.currentStatus);
          } else {
            createPetStatusWindow('正在旅行中...');
          }
        } catch (error) {
          console.error('Error showing travel status:', error);
          createPetStatusWindow('无法获取旅行状态信息');
        }
        break;
      default:
        console.log(`Unknown shortcut action: ${action}`);
    }
  } catch (error) {
    console.error(`Error handling shortcut action ${action}:`, error);
  }
}

// 显示趣味提醒
async function showFunReminder() {
  try {
    // 生成AI趣味提醒
    const funMessage = await generateFunReminder();
    createPetStatusWindow(funMessage);
  } catch (error) {
    console.error('Error showing fun reminder:', error);
    // 如果生成失败，显示默认消息
    createPetStatusWindow('今天也要开开心心的哦！✨');
  }
}

// 创建宠物状态弹窗窗口
function createPetStatusWindow(message) {
  console.log('Creating pet status window with message:', message);

  // 关闭已存在的小旅星窗口
  if (petStatusWindow && !petStatusWindow.isDestroyed()) {
    console.log('Closing existing pet status window');
    try {
      petStatusWindow.close();
      petStatusWindow = null;
    } catch (error) {
      console.error('Error closing existing pet status window:', error);
      petStatusWindow = null;
    }
  }

  const newPetStatusWindow = new BrowserWindow({
    width: 220,
    height: 120,
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
    focusable: true,
    hasShadow: false
  });

  newPetStatusWindow.loadFile('petStatus.html');

  // 智能计算弹窗位置，避免被桌面边框遮挡
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // 获取宠物窗口位置和大小
  let petPosition, petSize;

  if (petWindow && !petWindow.isDestroyed()) {
    try {
      // 强制刷新位置信息
      petPosition = petWindow.getPosition();
      petSize = petWindow.getSize();

      // 验证位置信息的有效性
      if (petPosition && Array.isArray(petPosition) && petPosition.length === 2 &&
        petSize && Array.isArray(petSize) && petSize.length === 2) {
        console.log('Pet window position:', petPosition, 'size:', petSize);
      } else {
        throw new Error('Invalid position or size data');
      }
    } catch (error) {
      console.error('Error getting pet window position:', error);
      petPosition = [screenWidth - 120, screenHeight - 120];
      petSize = [100, 100];
    }
  } else {
    petPosition = [screenWidth - 120, screenHeight - 120];
    petSize = [100, 100];
    console.log('Using default pet position:', petPosition);
  }

  // 气泡窗口的尺寸
  const bubbleWidth = 220;
  const bubbleHeight = 120;
  const bubbleTailHeight = 16; // 尾巴的高度

  // 计算最佳位置
  let bubbleX, bubbleY, bubbleDirection;

  // 计算桌宠中心位置
  const petCenterX = petPosition[0] + (petSize[0] / 2);
  const petCenterY = petPosition[1] + (petSize[1] / 2);

  // 优先尝试上方位置
  if (petPosition[1] >= bubbleHeight + bubbleTailHeight + 10) {
    // 上方有足够空间
    bubbleX = petCenterX - (bubbleWidth / 2);
    bubbleY = petPosition[1] - bubbleHeight - bubbleTailHeight;
    bubbleDirection = 'top';
  } else if (petPosition[1] + petSize[1] + bubbleHeight + bubbleTailHeight <= screenHeight) {
    // 下方有足够空间
    bubbleX = petCenterX - (bubbleWidth / 2);
    bubbleY = petPosition[1] + petSize[1] + bubbleTailHeight;
    bubbleDirection = 'bottom';
  } else if (petPosition[0] >= bubbleWidth + bubbleTailHeight + 10) {
    // 左侧有足够空间
    bubbleX = petPosition[0] - bubbleWidth - bubbleTailHeight;
    bubbleY = petCenterY - (bubbleHeight / 2);
    bubbleDirection = 'left';
  } else if (petPosition[0] + petSize[0] + bubbleWidth + bubbleTailHeight <= screenWidth) {
    // 右侧有足够空间
    bubbleX = petPosition[0] + petSize[0] + bubbleTailHeight;
    bubbleY = petCenterY - (bubbleHeight / 2);
    bubbleDirection = 'right';
  } else {
    // 如果所有方向都没有足够空间，强制显示在上方
    bubbleX = Math.max(10, Math.min(screenWidth - bubbleWidth - 10, petCenterX - (bubbleWidth / 2)));
    bubbleY = Math.max(10, petPosition[1] - bubbleHeight - bubbleTailHeight);
    bubbleDirection = 'top';
  }

  // 确保气泡不会超出屏幕边界
  bubbleX = Math.max(10, Math.min(screenWidth - bubbleWidth - 10, bubbleX));
  bubbleY = Math.max(10, Math.min(screenHeight - bubbleHeight - 10, bubbleY));

  // 验证计算出的位置是否合理
  const distanceFromPet = Math.sqrt(
    Math.pow(bubbleX + bubbleWidth / 2 - petCenterX, 2) +
    Math.pow(bubbleY + bubbleHeight / 2 - petCenterY, 2)
  );

  // 如果气泡距离桌宠太远（超过200像素），使用默认位置
  if (distanceFromPet > 200) {
    console.warn(`Bubble too far from pet (${distanceFromPet}px), using default position`);
    bubbleX = Math.max(10, Math.min(screenWidth - bubbleWidth - 10, petCenterX - bubbleWidth / 2));
    bubbleY = Math.max(10, Math.min(screenHeight - bubbleHeight - 10, petCenterY - bubbleHeight / 2));
    bubbleDirection = 'top';
  }

  console.log(`Positioning bubble at (${bubbleX}, ${bubbleY}) with direction: ${bubbleDirection}`);
  console.log(`Pet center: (${petCenterX}, ${petCenterY}), Pet position: (${petPosition[0]}, ${petPosition[1]}), Pet size: (${petSize[0]}, ${petSize[1]})`);
  console.log(`Screen size: (${screenWidth}, ${screenHeight}), Bubble size: (${bubbleWidth}, ${bubbleHeight})`);
  console.log(`Distance from pet: ${distanceFromPet}px`);

  newPetStatusWindow.setPosition(Math.round(bubbleX), Math.round(bubbleY));

  // 通过IPC传递消息和气泡方向
  newPetStatusWindow.webContents.once('dom-ready', () => {
    try {
      console.log('Sending message and direction to status window:', message, bubbleDirection);
      newPetStatusWindow.webContents.send('update-status-message', message);
      newPetStatusWindow.webContents.send('set-bubble-direction', bubbleDirection);
    } catch (error) {
      console.error('Error sending message to status window:', error);
    }
  });

  // 监听窗口错误
  newPetStatusWindow.webContents.on('crashed', () => {
    console.error('Status window crashed');
    petStatusWindow = null;
  });

  newPetStatusWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Status window failed to load:', errorCode, errorDescription);
    petStatusWindow = null;
  });

  // 监听窗口关闭事件
  newPetStatusWindow.on('closed', () => {
    console.log('Pet status window closed');
    petStatusWindow = null;
  });

  // 监听窗口失去焦点事件（点击外部关闭）
  newPetStatusWindow.on('blur', () => {
    console.log('Pet status window lost focus, closing');
    if (newPetStatusWindow && !newPetStatusWindow.isDestroyed()) {
      newPetStatusWindow.close();
    }
  });

  // 保存到全局变量
  petStatusWindow = newPetStatusWindow;

  return newPetStatusWindow;
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
    height: 220,
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
    focusable: true,
    // 确保右键菜单在桌宠之上显示
    parent: petWindow,
    modal: false
  });

  newContextMenuWindow.loadFile('contextMenu.html');

  // 智能定位：避免被桌面边框遮挡，并根据桌宠位置优化显示方向
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // 菜单尺寸
  const menuWidth = 180;
  const menuHeight = 220;

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

  // 自动关闭功能 - 只有在没有透明度窗口打开时才自动关闭
  setTimeout(() => {
    try {
      if (newContextMenuWindow && !newContextMenuWindow.isDestroyed()) {
        // 检查是否有透明度窗口打开
        if (!transparencyWindow || transparencyWindow.isDestroyed()) {
          console.log('Auto-closing context menu window (no transparency window open)');
          newContextMenuWindow.close();
        } else {
          console.log('Keeping context menu open (transparency window is active)');
        }
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

  // 检查是否已存在地图窗口
  if (mapWindow && !mapWindow.isDestroyed()) {
    console.log('Map window already exists, showing and focusing');
    mapWindow.show();
    mapWindow.focus();
    return mapWindow;
  }

  // 清理旅行数据中的乱码字符
  const cleanTravelData = {
    origin: cleanText(travelData.origin) || '武汉光谷',
    destination: cleanText(travelData.destination) || '北京天安门',
    userLocation: travelData.userLocation || null
  };

  // 保存到全局变量
  globalTravelData = cleanTravelData;

  console.log('Cleaned travel data:', cleanTravelData);

  mapWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    alwaysOnTop: false, // 与主页面保持一致
    transparent: false,
    resizable: true, // 允许调整大小
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    movable: true, // 允许窗口移动
    minimizable: true, // 允许最小化
    maximizable: true, // 允许最大化
    show: false // 初始不显示，等待加载完成后显示
  });

  mapWindow.loadFile('map.html');

  // 设置地图窗口位置到屏幕中央
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mapWindow.setPosition(
    Math.round((width - 800) / 2),
    Math.round((height - 600) / 2)
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

    // 显示窗口
    mapWindow.show();
  });

  // 监听地图窗口关闭事件，改为隐藏而不是销毁
  mapWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mapWindow.hide();
      console.log('Map window hidden instead of closed');
    } else {
      // 应用退出时清理全局变量
      globalTravelData = null;
      console.log('App quitting, clearing global travel data');
    }
  });

  // 监听地图窗口请求旅行信息
  ipcMain.on('request-travel-info', () => {
    console.log('Map window requesting travel info');
    if (mapWindow && !mapWindow.isDestroyed()) {
      mapWindow.webContents.send('travel-info', cleanTravelData);
    }
  });

  // 监听地图窗口隐藏请求
  ipcMain.on('hide-map-window', () => {
    console.log('Hiding map window');
    if (mapWindow && !mapWindow.isDestroyed()) {
      mapWindow.hide();
    }
  });

  // 待办窗口现在是完全独立的，不需要IPC通信
  // 所有逻辑都在todoWindow.html中处理

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

// 创建喝水提醒窗口（持久弹窗，带交互按钮）
function createWaterReminderWindow() {
  try {
    if (waterReminderWindow && !waterReminderWindow.isDestroyed()) {
      waterReminderWindow.show();
      waterReminderWindow.focus();
      return waterReminderWindow;
    }

    waterReminderWindow = new BrowserWindow({
      width: 640,
      height: 520,
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
      movable: true,
      focusable: true
    });

    waterReminderWindow.loadFile('waterReminder.html');

    // 将窗口置于屏幕中央
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    waterReminderWindow.setPosition(
      Math.round((width - 640) / 2),
      Math.round((height - 520) / 2)
    );

    // 不因失焦自动关闭，直到用户点击按钮
    waterReminderWindow.on('closed', () => {
      waterReminderWindow = null;
    });

    return waterReminderWindow;
  } catch (error) {
    console.error('Error creating water reminder window:', error);
    // 兜底：使用小旅星窗口展示消息
    const waterMessage = '💧 该喝水啦！记得保持水分补充哦～';
    createPetStatusWindow(waterMessage);
  }
}

// 创建待办窗口
function createTodoWindow() {
  try {
    if (todoWindow && !todoWindow.isDestroyed()) {
      todoWindow.show();
      todoWindow.focus();
      return todoWindow;
    }

    todoWindow = new BrowserWindow({
      width: 800,
      height: 700,
      frame: false,
      alwaysOnTop: false,
      resizable: true,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      movable: true,
      focusable: true,
      show: false
    });

    todoWindow.loadFile('todoWindow.html');

    // 将窗口置于屏幕中央
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    todoWindow.setPosition(
      Math.round((width - 800) / 2),
      Math.round((height - 700) / 2)
    );

    todoWindow.once('ready-to-show', () => {
      todoWindow.show();
    });

    todoWindow.on('closed', () => {
      todoWindow = null;
    });

    return todoWindow;
  } catch (error) {
    console.error('Error creating todo window:', error);
  }
}

// 创建桌宠设置窗口
function createPetSettingsWindow() {
  try {
    if (petSettingsWindow && !petSettingsWindow.isDestroyed()) {
      petSettingsWindow.show();
      petSettingsWindow.focus();
      return petSettingsWindow;
    }

    petSettingsWindow = new BrowserWindow({
      width: 500,
      height: 700,
      frame: false,
      alwaysOnTop: false,
      resizable: true,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      movable: true,
      focusable: true,
      show: false
    });

    petSettingsWindow.loadFile('petSettings.html');

    // 将窗口置于屏幕中央
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    petSettingsWindow.setPosition(
      Math.round((width - 500) / 2),
      Math.round((height - 700) / 2)
    );

    petSettingsWindow.once('ready-to-show', () => {
      petSettingsWindow.show();
    });

    petSettingsWindow.on('closed', () => {
      petSettingsWindow = null;
    });

    return petSettingsWindow;
  } catch (error) {
    console.error('Error creating pet settings window:', error);
  }
}

// 检查并显示桌宠设置窗口（首次启动时）
function checkAndShowPetSettingsOnStartup() {
  try {
    // 检查是否已经设置过桌宠（通过检查localStorage）
    // 由于主进程无法直接访问localStorage，我们通过渲染进程来检查
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        (function() {
          try {
            const savedSettings = localStorage.getItem('petSettings');
            return savedSettings ? true : false;
          } catch (error) {
            console.error('Error checking pet settings:', error);
            return false;
          }
        })()
      `).then((hasSettings) => {
        if (!hasSettings) {
          console.log('首次启动，显示桌宠设置窗口');
          // 延迟一点时间，确保主窗口已经完全加载
          setTimeout(() => {
            createPetSettingsWindow();
          }, 2000);
        } else {
          console.log('桌宠已设置，跳过设置窗口');
        }
      }).catch((error) => {
        console.error('Error checking pet settings on startup:', error);
        // 如果检查失败，默认显示设置窗口
        setTimeout(() => {
          createPetSettingsWindow();
        }, 2000);
      });
    } else {
      // 如果主窗口还没准备好，延迟检查
      setTimeout(() => {
        checkAndShowPetSettingsOnStartup();
      }, 1000);
    }
  } catch (error) {
    console.error('Error in checkAndShowPetSettingsOnStartup:', error);
  }
}

// 创建快捷键设置窗口
function createShortcutSettingsWindow() {
  try {
    if (shortcutSettingsWindow && !shortcutSettingsWindow.isDestroyed()) {
      shortcutSettingsWindow.show();
      shortcutSettingsWindow.focus();
      return shortcutSettingsWindow;
    }

    shortcutSettingsWindow = new BrowserWindow({
      width: 600,
      height: 700,
      frame: false,
      alwaysOnTop: false,
      resizable: true,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      movable: true,
      focusable: true,
      show: false
    });

    shortcutSettingsWindow.loadFile('shortcutSettings.html');

    // 将窗口置于屏幕中央
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    shortcutSettingsWindow.setPosition(
      Math.round((width - 600) / 2),
      Math.round((height - 700) / 2)
    );

    shortcutSettingsWindow.once('ready-to-show', () => {
      shortcutSettingsWindow.show();
    });

    shortcutSettingsWindow.on('closed', () => {
      shortcutSettingsWindow = null;
    });

    return shortcutSettingsWindow;
  } catch (error) {
    console.error('Error creating shortcut settings window:', error);
  }
}

// 启动待办提醒系统
function startTodoReminder() {
  if (todoReminderTimer) {
    clearInterval(todoReminderTimer);
  }

  todoReminderTimer = setInterval(() => {
    checkAndShowTodoReminder();
  }, TODO_REMINDER_INTERVAL);

  console.log('Todo reminder system started');
}

// 停止待办提醒系统
function stopTodoReminder() {
  if (todoReminderTimer) {
    clearInterval(todoReminderTimer);
    todoReminderTimer = null;
  }
  console.log('Todo reminder system stopped');
}

// 检查并显示待办提醒
function checkAndShowTodoReminder() {
  try {
    const now = Date.now();
    if (now - lastTodoReminderTime > TODO_REMINDER_INTERVAL) {
      lastTodoReminderTime = now;

      // 显示待办提醒
      const reminderMessage = '📝 记得查看你的待办事项哦！';
      createPetStatusWindow(reminderMessage);

      console.log('Todo reminder shown');
    }
  } catch (error) {
    console.error('Error showing todo reminder:', error);
  }
}

// 截图功能已改为使用第三方区域截图库
// 不再需要全屏截图功能

// 注册全局快捷键监听截图
function registerScreenshotListener() {
  // 加载自定义快捷键设置
  loadAndRegisterShortcuts();

  try {
    // 先注销可能已注册的快捷键
    globalShortcut.unregister('F6');

    // 注册手动重置状态快捷键
    const ret4 = globalShortcut.register('F6', () => {
      console.log('Manual reset pet state triggered!');
      resetPetState();
    });

    if (!ret4) {
      console.log('Reset pet state listener registration failed');
    } else {
      console.log('Reset pet state listener registered successfully');
    }
  } catch (error) {
    console.log('Reset pet state listener registration error:', error);
  }
}

// 移除自研区域选择器的 IPC 交互（改用 electron-screenshots）

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

    // 保存到全局变量
    globalTravelData = travelData;

    // 初始化旅行状态
    currentTravelStatus = {
      isInProgress: true,
      currentLocation: userLocation.coordinates ? { lng: userLocation.coordinates[0], lat: userLocation.coordinates[1] } : null,
      currentWeather: null,
      lastCity: userLocation.city,
      totalDistance: 0,
      traveledDistance: 0,
      progress: 0,
      lastWeatherUpdateTime: 0,
      currentStatus: null,
      hasInitialStatusGenerated: false  // 重置初始状态生成标记
    };

    // 获取起点天气信息
    if (currentTravelStatus.currentLocation) {
      try {
        weatherService.setCurrentLocation(currentTravelStatus.currentLocation.lng, currentTravelStatus.currentLocation.lat);
        const initialWeather = await getWeatherWithCache(
          currentTravelStatus.currentLocation.lng,
          currentTravelStatus.currentLocation.lat
        );
        currentTravelStatus.currentWeather = initialWeather;
        console.log('Initial weather info:', initialWeather);
      } catch (error) {
        console.error('Error getting initial weather:', error);
      }
    }

    console.log('Creating map window, travel data:', travelData);
    createMapWindow(travelData);
  } catch (error) {
    console.error('Failed to get user location, using default location:', error);

    // 如果获取用户位置失败，使用默认位置
    const travelData = {
      origin: '武汉光谷',
      destination: destination
    };

    // 保存到全局变量
    globalTravelData = travelData;

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
  await showFunReminder();
});

// IPC事件处理：显示当前旅程状态
ipcMain.on('check-journey-status', async () => {
  // 检查是否有进行中的旅行
  if (!currentTravelStatus.isInProgress) {
    createPetStatusWindow('还没有开始旅行呢！按F2截图开始新的旅程吧✈️');
    return;
  }

  // 检查是否有AI生成的基于位置和天气的旅行状态
  if (currentTravelStatus.currentStatus) {
    createPetStatusWindow(currentTravelStatus.currentStatus);
  } else {
    // 如果没有AI生成的状态，则使用默认状态
    createPetStatusWindow('正在旅行中...');
  }
});

// 监听关闭地图窗口事件，重置旅行状态
ipcMain.on('close-map-window', () => {
  console.log('Closing map window and resetting travel status');
  if (mapWindow && !mapWindow.isDestroyed()) {
    mapWindow.close();
  }

  // 重置旅行状态
  currentTravelStatus = {
    isInProgress: false,
    currentLocation: null,
    currentWeather: null,
    lastCity: null,
    totalDistance: 0,
    traveledDistance: 0,
    progress: 0,
    lastWeatherUpdateTime: 0,
    currentStatus: null,
    hasInitialStatusGenerated: false  // 重置初始状态生成标记
  };

  globalTravelData = null;
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
    setupScreenshots(); // 初始化第三方区域截屏
    registerScreenshotListener();

    // 注入弹窗创建函数给ActivityMonitor
    setCreatePetStatusWindowFunction(createPetStatusWindow);
    setCreateWaterReminderWindowFunction(createWaterReminderWindow);
    activityMonitor = new ActivityMonitor();

    // 启动待办提醒系统
    startTodoReminder();

    // 检查是否需要显示桌宠设置窗口（首次启动时）
    checkAndShowPetSettingsOnStartup();
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

  // 停止待办提醒系统
  stopTodoReminder();

  // 移除IPC监听器
  ipcMain.removeAllListeners('request-travel-info');
});

// 窗口移动监听器 - 暂时注释掉
/*
function setupWindowMoveListener() {
  // 由于只进行屏幕边缘吸附，不再需要窗口跟随功能
  // 保留函数结构以便将来扩展
  console.log('窗口跟随功能已禁用，只进行屏幕边缘吸附');
}
*/

// 清除吸附状态的函数 - 暂时注释掉
/*
function clearSnapState() {
  console.log('清除吸附状态');
  isSnapped = false;
  snapInfo = {
    type: '',
    position: null,
    attachedWindow: null
  };
  
  if (petWindow && petWindow.attachedToWindow) {
    delete petWindow.attachedToWindow;
  }
}
*/

// 设置桌宠状态并启动复原计时器
function setPetState(emotion) {
  // 清除之前的计时器
  if (petStateTimer) {
    clearTimeout(petStateTimer);
  }

  currentPetEmotion = emotion;
  console.log('设置桌宠状态:', emotion);

  // 设置复原计时器
  petStateTimer = setTimeout(() => {
    resetPetState();
  }, PET_STATE_DURATION);
}

// 重置桌宠状态为初始状态
function resetPetState() {
  if (petWindow && !petWindow.isDestroyed()) {
    try {
      // 发送重置状态信号给渲染进程
      petWindow.webContents.send('reset-emotion');
      console.log('重置桌宠状态为初始状态');

      // 清除状态记录
      currentPetEmotion = null;
      if (petStateTimer) {
        clearTimeout(petStateTimer);
        petStateTimer = null;
      }
    } catch (error) {
      console.error('重置桌宠状态失败:', error);
    }
  }
}
