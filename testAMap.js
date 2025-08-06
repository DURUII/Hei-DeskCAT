// 测试高德地图API功能
require('dotenv').config();
const AMapService = require('./amapService');

async function testAMapAPI() {
  const amapService = new AMapService();
  
  console.log('开始测试高德地图API功能');
  console.log('API Key:', process.env.AMAP_KEY ? process.env.AMAP_KEY.substring(0, 10) + '...' : '未配置');
  
  try {
    // 1. 测试地理编码 - 武汉光谷
    console.log('\n1. 测试地理编码 - 武汉光谷');
    const wuhanOrigin = await amapService.geocode({ address: '武汉光谷' });
    console.log('武汉光谷地理编码结果:', JSON.stringify(wuhanOrigin, null, 2));
    
    let originLocation = null;
    if (wuhanOrigin.geocodes && wuhanOrigin.geocodes.length > 0) {
      originLocation = wuhanOrigin.geocodes[0].location;
      console.log('武汉光谷坐标:', originLocation);
    } else {
      console.log('武汉光谷地理编码失败');
      return;
    }
    
    // 2. 测试地理编码 - 北京天安门
    console.log('\n2. 测试地理编码 - 北京天安门');
    const beijingDestination = await amapService.geocode({ address: '北京天安门' });
    console.log('北京天安门地理编码结果:', JSON.stringify(beijingDestination, null, 2));
    
    let destinationLocation = null;
    if (beijingDestination.geocodes && beijingDestination.geocodes.length > 0) {
      destinationLocation = beijingDestination.geocodes[0].location;
      console.log('北京天安门坐标:', destinationLocation);
    } else {
      console.log('北京天安门地理编码失败');
      return;
    }
    
    // 3. 测试驾车路径规划
    console.log('\n3. 测试驾车路径规划');
    const drivingRoute = await amapService.drivingRoute({
      origin: originLocation,
      destination: destinationLocation
    });
    console.log('驾车路径规划结果:', JSON.stringify(drivingRoute, null, 2));
    
  } catch (error) {
    console.error('测试过程中出现错误:', error);
  }
}

// 执行测试
testAMapAPI();