const https = require('https');
const querystring = require('querystring');

/**
 * 高德地图API服务类
 */
class AMapService {
  constructor() {
    this.apiKey = process.env.AMAP_KEY || '';
  }

  /**
   * 驾车路径规划
   * @param {Object} params - 路径规划参数
   * @param {string} params.origin - 出发点经纬度 (格式: "经度,纬度")
   * @param {string} params.destination - 目的地经纬度 (格式: "经度,纬度")
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 路径规划结果
   */
  async drivingRoute(params, options = {}) {
    if (!this.apiKey) {
      throw new Error('高德地图API Key未配置');
    }

    const defaultOptions = {
      extensions: 'all',
      strategy: 10, // 返回多条路径，躲避拥堵，路程较短，尽量缩短时间
      output: 'json'
    };

    const queryParams = new URLSearchParams({
      key: this.apiKey,
      origin: params.origin,
      destination: params.destination,
      ...defaultOptions,
      ...options
    });

    const url = `https://restapi.amap.com/v3/direction/driving?${queryParams.toString()}`;
    
    return this._makeRequest(url);
  }

  /**
   * 公交路径规划
   * @param {Object} params - 路径规划参数
   * @param {string} params.origin - 出发点经纬度 (格式: "经度,纬度")
   * @param {string} params.destination - 目的地经纬度 (格式: "经度,纬度")
   * @param {string} params.city - 城市名称
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 路径规划结果
   */
  async transitRoute(params, options = {}) {
    if (!this.apiKey) {
      throw new Error('高德地图API Key未配置');
    }

    const defaultOptions = {
      output: 'json'
    };

    const queryParams = new URLSearchParams({
      key: this.apiKey,
      origin: params.origin,
      destination: params.destination,
      city: params.city,
      ...defaultOptions,
      ...options
    });

    const url = `https://restapi.amap.com/v3/direction/transit/integrated?${queryParams.toString()}`;
    
    console.log('公交路径规划请求URL:', url);
    return this._makeRequest(url);
  }

  /**
   * 关键字搜索
   * @param {Object} params - 搜索参数
   * @param {string} params.keywords - 搜索关键词
   * @param {string} params.city - 搜索城市
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 搜索结果
   */
  async textSearch(params, options = {}) {
    if (!this.apiKey) {
      throw new Error('高德地图API Key未配置');
    }

    const defaultOptions = {
      extensions: 'all',
      output: 'json'
    };

    const queryParams = new URLSearchParams({
      key: this.apiKey,
      keywords: params.keywords,
      city: params.city || '',
      ...defaultOptions,
      ...options
    });

    const url = `https://restapi.amap.com/v3/place/text?${queryParams.toString()}`;
    
    return this._makeRequest(url);
  }

  /**
   * 天气查询
   * @param {Object} params - 天气查询参数
   * @param {string} params.city - 城市adcode
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 天气信息
   */
  async weatherInfo(params, options = {}) {
    if (!this.apiKey) {
      throw new Error('高德地图API Key未配置');
    }

    const defaultOptions = {
      output: 'json'
    };

    const queryParams = new URLSearchParams({
      key: this.apiKey,
      city: params.city,
      ...defaultOptions,
      ...options
    });

    const url = `https://restapi.amap.com/v3/weather/weatherInfo?${queryParams.toString()}`;
    
    return this._makeRequest(url);
  }

  /**
   * 静态地图
   * @param {Object} params - 静态地图参数
   * @param {string} params.location - 地图中心点
   * @param {number} params.zoom - 地图级别
   * @param {Object} options - 可选参数
   * @returns {string} 静态地图URL
   */
  staticMap(params, options = {}) {
    if (!this.apiKey) {
      throw new Error('高德地图API Key未配置');
    }

    const defaultOptions = {
      size: '400*400',
      scale: 1
    };

    const queryParams = new URLSearchParams({
      key: this.apiKey,
      location: params.location,
      zoom: params.zoom,
      ...defaultOptions,
      ...options
    });

    return `https://restapi.amap.com/v3/staticmap?${queryParams.toString()}`;
  }

  /**
   * 地理编码（地址转坐标）
   * @param {Object} params - 地理编码参数
   * @param {string} params.address - 地址
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 地理编码结果
   */
  async geocode(params, options = {}) {
    if (!this.apiKey) {
      throw new Error('高德地图API Key未配置');
    }

    const defaultOptions = {
      output: 'json'
    };

    const queryParams = new URLSearchParams({
      key: this.apiKey,
      address: params.address,
      ...defaultOptions,
      ...options
    });

    const url = `https://restapi.amap.com/v3/geocode/geo?${queryParams.toString()}`;
    
    console.log('地理编码请求URL:', url);
    return this._makeRequest(url);
  }

  /**
   * 逆地理编码（坐标转地址）
   * @param {Object} params - 逆地理编码参数
   * @param {string} params.location - 经纬度坐标
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 逆地理编码结果
   */
  async regeocode(params, options = {}) {
    if (!this.apiKey) {
      throw new Error('高德地图API Key未配置');
    }

    const defaultOptions = {
      output: 'json'
    };

    const queryParams = new URLSearchParams({
      key: this.apiKey,
      location: params.location,
      ...defaultOptions,
      ...options
    });

    const url = `https://restapi.amap.com/v3/geocode/regeo?${queryParams.toString()}`;
    
    return this._makeRequest(url);
  }

  /**
   * 发起HTTP请求
   * @param {string} url - 请求URL
   * @returns {Promise<Object>} 响应数据
   * @private
   */
  _makeRequest(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            console.log('高德地图API响应数据:', data);
            const result = JSON.parse(data);
            if (result.status === '1') {
              resolve(result);
            } else {
              reject(new Error(result.info || '请求失败'));
            }
          } catch (error) {
            console.error('解析响应数据失败:', error, '原始数据:', data);
            reject(new Error('解析响应数据失败'));
          }
        });
      }).on('error', (error) => {
        console.error('HTTP请求失败:', error);
        reject(error);
      });
    });
  }
}

module.exports = AMapService;