// 加载环境变量
require('dotenv').config();

const { app, BrowserWindow, globalShortcut, desktopCapturer, Notification, ipcMain, Menu } = require('electron');
const path = require('path');
const { ActivityMonitor, setCreatePetStatusWindowFunction } = require('./activityMonitor');
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
let contextMenuWindow = null;
let transparencyWindow = null; // 添加右键菜单窗口跟踪

// 拖动相关变量
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// 吸附状态管理
let isSnapped = false;
let snapInfo = {
  type: '',
  position: null,
  attachedWindow: null
};

// 全局旅行数据
let globalTravelData = null;

// 小旅星窗口管理
let petStatusWindow = null;
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

  // 监听宠物点击事件 - 触发趣味提醒
  ipcMain.on('pet-clicked', async (event) => {
    console.log('Pet clicked, triggering fun reminder');
    try {
      // 生成AI趣味提醒
      const funMessage = await generateFunReminder();
      createPetStatusWindow(funMessage);
    } catch (error) {
      console.error('Error creating fun reminder:', error);
      // 如果生成失败，显示默认消息
      createPetStatusWindow('今天也要开开心心的哦！✨');
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

    // 拖动开始时清除吸附状态，确保正常拖动
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

    // 拖动结束后进行吸附判定
    performSnapCheck();

    // 延迟确保位置更新完成
    setTimeout(() => {
      console.log('Drag ended, position should be updated');
      // 可以在这里添加拖动结束后的其他逻辑
    }, 50);
  });

  // 监听右键菜单关闭事件

  // 吸附检查函数 - 在拖动结束后执行
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

  // 监听右键菜单关闭事件
  ipcMain.on('context-menu-closed', (event) => {
    console.log('Context menu closed by user action');
    contextMenuWindow = null;
  });

  // 处理透明度调节
  ipcMain.on('set-pet-transparency', (event, transparency) => {
    console.log('Setting pet transparency to:', transparency);
    try {
      if (petWindow && !petWindow.isDestroyed()) {
        // 将百分比转换为0-1的范围
        const opacity = transparency / 100;
        petWindow.setOpacity(opacity);
        console.log('Pet window opacity set to:', opacity);
      } else {
        console.log('Pet window not available for transparency setting');
      }
    } catch (error) {
      console.error('Error setting pet transparency:', error);
    }
  });

  // 打开透明度控制窗口
  ipcMain.on('open-transparency-window', (event) => {
    console.log('Opening transparency control window');
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
        y: y
      });

      newTransparencyWindow.loadFile('transparencyWindow.html');

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
        console.log('Transparency window closed, global variable cleared');
      });

      transparencyWindow = newTransparencyWindow;
      console.log('Transparency window created successfully');
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
  });

  // 监听透明度窗口打开事件
  ipcMain.on('transparency-window-opened', (event) => {
    console.log('Transparency window opened');
    // 通知右键菜单透明度窗口状态
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      try {
        contextMenuWindow.webContents.send('transparency-window-status', true);
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
  setupWindowMoveListener();

  return petWindow;
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
    height: 180,
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
  const menuHeight = 180;

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

// 创建喝水提醒窗口 - 使用小旅星窗口
function createWaterReminderWindow() {
  const waterMessage = '💧 该喝水啦！记得保持水分补充哦～';
  createPetStatusWindow(waterMessage);
}

// 截取屏幕截图
async function captureScreenshot() {
  try {
    console.log('📸 Capturing screenshot...');
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 800, height: 600 }
    });

    if (sources && sources.length > 0) {
      // 获取第一张屏幕截图
      const source = sources[0];
      const thumbnail = source.thumbnail;

      // 将截图转换为base64编码
      const base64Data = thumbnail.toDataURL().replace(/^data:image\/(png|jpeg);base64,/, '');
      console.log('📸 Screenshot captured, size:', base64Data.length, 'characters');

      // 使用AI分析截图内容
      console.log('🤖 Analyzing screenshot with AI...');
      const aiResponse = await analyzeScreenshot(base64Data);
      console.log('✅ AI analysis completed:', aiResponse);
      return aiResponse;
    } else {
      console.log('❌ No screen sources found');
    }
  } catch (error) {
    console.error('❌ Screenshot capture failed:', error);
  }

  // 如果出错，返回默认响应
  console.log('🔄 Returning fallback response');
  return {
    message: "替你去看北京天安门？",
    shouldTravel: true,
    confidence: 0.5
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

      // 使用小旅星窗口显示AI回复
      createPetStatusWindow(aiResponse.message);

      // 如果AI判断需要触发旅行，则显示气泡提示
      if (aiResponse.shouldTravel) {
        // 显示AI生成的气泡提示
        setTimeout(() => {
          showScreenshotBubble(aiResponse.message);
        }, 1200);
      }

      // 切换宠物表情
      if (aiResponse.emotion && petWindow && !petWindow.isDestroyed()) {
        try {
          petWindow.webContents.send('change-emotion', aiResponse.emotion);
          console.log('Sent emotion change to pet:', aiResponse.emotion);
        } catch (error) {
          console.error('Failed to send emotion change:', error);
        }
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
      createPetStatusWindow(funMessage);
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

    // 保存到全局变量
    globalTravelData = travelData;

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
  // 生成AI趣味提醒
  const funMessage = await generateFunReminder();
  createPetStatusWindow(funMessage);
});

// IPC事件处理：显示当前旅程状态
ipcMain.on('check-journey-status', async () => {
  // 生成AI旅程状态
  const statusMessage = await generateJourneyStatus();
  createPetStatusWindow(statusMessage);
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

    // 设置ActivityMonitor的createPetStatusWindow函数
    setCreatePetStatusWindowFunction(createPetStatusWindow);
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

// 窗口移动监听器 - 由于只进行屏幕边缘吸附，此功能已简化
function setupWindowMoveListener() {
  // 由于只进行屏幕边缘吸附，不再需要窗口跟随功能
  // 保留函数结构以便将来扩展
  console.log('窗口跟随功能已禁用，只进行屏幕边缘吸附');
}

// 清除吸附状态的函数
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
