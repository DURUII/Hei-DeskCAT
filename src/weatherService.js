// 天气服务模块
require('dotenv').config();
const { AMAP_KEY } = require('./config');
const https = require('https');

class WeatherService {
    constructor() {
        this.amapKey = AMAP_KEY;
        this.weatherCache = new Map(); // 缓存天气数据
        this.cacheExpiration = 5 * 60 * 1000; // 5分钟缓存过期
        this.currentLocation = null; // 当前位置
        this.lastKnownCity = null; // 上一个已知城市
        this.lastRequestTime = 0; // 上次请求时间
        this.requestInterval = 3000; // 请求间隔3秒，避免QPS超限
    }

    // 根据经纬度获取天气信息
    async getWeatherByCoordinates(lng, lat) {
        try {
            // 先进行逆地理编码获取城市信息
            const cityInfo = await this.reverseGeocode(lng, lat);
            if (!cityInfo) {
                throw new Error('Failed to get city information');
            }

            // 获取天气信息
            const weather = await this.getWeatherByCity(cityInfo.adcode);

            return {
                ...weather,
                cityInfo: cityInfo,
                isNewCity: false // 不再检测新城市
            };
        } catch (error) {
            console.error('Error getting weather by coordinates:', error);
            return this.getDefaultWeather();
        }
    }

    // 请求限流控制
    async waitForNextRequest() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.requestInterval) {
            const waitTime = this.requestInterval - timeSinceLastRequest;
            console.log(`Waiting ${waitTime}ms before next API request to avoid rate limit`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastRequestTime = Date.now();
    }

    // 逆地理编码 - 坐标转地址
    async reverseGeocode(lng, lat) {
        try {
            // 将坐标省略到三位小数，防止由于坐标变化导致重复请求
            const roundedLng = Math.round(lng * 1000) / 1000;
            const roundedLat = Math.round(lat * 1000) / 1000;

            // 检查缓存
            const cacheKey = `geocode_${roundedLng}_${roundedLat}`;
            const cached = this.weatherCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheExpiration) {
                return cached.data;
            }

            // 限流控制
            await this.waitForNextRequest();

            const url = `https://restapi.amap.com/v3/geocode/regeo?key=${this.amapKey}&location=${lng},${lat}&radius=3000&extensions=all&batch=false&roadlevel=0`;

            const data = await this.httpRequest(url);

            if (data.status === '1' && data.regeocode) {
                const addressComponent = data.regeocode.addressComponent;
                const result = {
                    province: addressComponent.province || '',
                    city: addressComponent.city || addressComponent.province || '',
                    district: addressComponent.district || '',
                    adcode: addressComponent.adcode || '',
                    formattedAddress: data.regeocode.formatted_address || '',
                    coordinates: [lng, lat]
                };

                // 缓存地理编码结果
                this.weatherCache.set(cacheKey, {
                    data: result,
                    timestamp: Date.now()
                });

                return result;
            } else {
                throw new Error(`Reverse geocoding failed: ${data.info || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Reverse geocoding error:', error);

            // 如果是QPS超限错误，返回默认城市信息
            if (error.message && error.message.includes('EXCEEDED_THE_LIMIT')) {
                console.log('API rate limit exceeded, using default city info');
                return {
                    province: '未知省份',
                    city: '未知城市',
                    district: '未知区域',
                    adcode: '100000', // 默认使用全国的城市代码
                    formattedAddress: '位置信息暂时不可用',
                    coordinates: [lng, lat]
                };
            }

            return null;
        }
    }

    // 根据城市代码获取天气
    async getWeatherByCity(adcode) {
        try {
            // 检查缓存
            const cacheKey = `weather_${adcode}`;
            const cached = this.weatherCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheExpiration) {
                return cached.data;
            }

            // 限流控制
            await this.waitForNextRequest();

            // 请求天气数据
            const url = `https://restapi.amap.com/v3/weather/weatherInfo?key=${this.amapKey}&city=${adcode}&extensions=base`;
            console.log(`Requesting weather data for city: ${adcode}`);

            const data = await this.httpRequest(url);

            if (data.status === '1' && data.lives && data.lives.length > 0) {
                const weather = data.lives[0];
                const weatherData = this.parseWeatherData(weather);

                // 缓存天气数据
                this.weatherCache.set(cacheKey, {
                    data: weatherData,
                    timestamp: Date.now()
                });

                console.log(`Weather data received: ${weatherData.city} - ${weatherData.summary}`);
                return weatherData;
            } else {
                throw new Error(`Weather API failed: ${data.info || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Error getting weather by city:', error);

            // 如果是QPS超限错误，返回默认天气
            if (error.message && error.message.includes('EXCEEDED_THE_LIMIT')) {
                console.log('Weather API rate limit exceeded, using default weather');
            }

            return this.getDefaultWeather();
        }
    }

    // 解析天气数据
    parseWeatherData(weather) {
        const weatherMap = {
            '晴': { emoji: '☀️', description: '晴天' },
            '少云': { emoji: '🌤️', description: '少云' },
            '晴间多云': { emoji: '⛅', description: '晴间多云' },
            '多云': { emoji: '☁️', description: '多云' },
            '阴': { emoji: '☁️', description: '阴天' },
            '有风': { emoji: '🌬️', description: '有风' },
            '平静': { emoji: '😌', description: '平静' },
            '微风': { emoji: '🍃', description: '微风' },
            '和风': { emoji: '🍃', description: '和风' },
            '清风': { emoji: '🌬️', description: '清风' },
            '强风/劲风': { emoji: '💨', description: '强风' },
            '疾风': { emoji: '💨', description: '疾风' },
            '大风': { emoji: '💨', description: '大风' },
            '烈风': { emoji: '🌪️', description: '烈风' },
            '风暴': { emoji: '🌪️', description: '风暴' },
            '狂爆风': { emoji: '🌪️', description: '狂爆风' },
            '飓风': { emoji: '🌪️', description: '飓风' },
            '热带风暴': { emoji: '🌪️', description: '热带风暴' },
            '霾': { emoji: '😷', description: '霾' },
            '中度霾': { emoji: '😷', description: '中度霾' },
            '重度霾': { emoji: '😷', description: '重度霾' },
            '严重霾': { emoji: '😷', description: '严重霾' },
            '阵雨': { emoji: '🌦️', description: '阵雨' },
            '雷阵雨': { emoji: '⛈️', description: '雷阵雨' },
            '雷阵雨并伴有冰雹': { emoji: '⛈️', description: '雷阵雨伴冰雹' },
            '小雨': { emoji: '🌧️', description: '小雨' },
            '中雨': { emoji: '🌧️', description: '中雨' },
            '大雨': { emoji: '🌧️', description: '大雨' },
            '暴雨': { emoji: '🌧️', description: '暴雨' },
            '大暴雨': { emoji: '🌧️', description: '大暴雨' },
            '特大暴雨': { emoji: '🌧️', description: '特大暴雨' },
            '强阵雨': { emoji: '🌧️', description: '强阵雨' },
            '强雷阵雨': { emoji: '⛈️', description: '强雷阵雨' },
            '极端降雨': { emoji: '🌧️', description: '极端降雨' },
            '毛毛雨/细雨': { emoji: '🌦️', description: '毛毛雨' },
            '雨': { emoji: '🌧️', description: '雨' },
            '小雨-中雨': { emoji: '🌧️', description: '小到中雨' },
            '中雨-大雨': { emoji: '🌧️', description: '中到大雨' },
            '大雨-暴雨': { emoji: '🌧️', description: '大到暴雨' },
            '暴雨-大暴雨': { emoji: '🌧️', description: '暴雨到大暴雨' },
            '大暴雨-特大暴雨': { emoji: '🌧️', description: '大暴雨到特大暴雨' },
            '雨雪天气': { emoji: '🌨️', description: '雨雪天气' },
            '雨夹雪': { emoji: '🌨️', description: '雨夹雪' },
            '阵雨夹雪': { emoji: '🌨️', description: '阵雨夹雪' },
            '冻雨': { emoji: '🧊', description: '冻雨' },
            '雪': { emoji: '❄️', description: '雪' },
            '阵雪': { emoji: '🌨️', description: '阵雪' },
            '小雪': { emoji: '❄️', description: '小雪' },
            '中雪': { emoji: '❄️', description: '中雪' },
            '大雪': { emoji: '❄️', description: '大雪' },
            '暴雪': { emoji: '❄️', description: '暴雪' },
            '小雪-中雪': { emoji: '❄️', description: '小到中雪' },
            '中雪-大雪': { emoji: '❄️', description: '中到大雪' },
            '大雪-暴雪': { emoji: '❄️', description: '大到暴雪' },
            '浮尘': { emoji: '😷', description: '浮尘' },
            '扬沙': { emoji: '😷', description: '扬沙' },
            '沙尘暴': { emoji: '😷', description: '沙尘暴' },
            '强沙尘暴': { emoji: '😷', description: '强沙尘暴' },
            '龙卷风': { emoji: '🌪️', description: '龙卷风' },
            '雾': { emoji: '🌫️', description: '雾' },
            '浓雾': { emoji: '🌫️', description: '浓雾' },
            '强浓雾': { emoji: '🌫️', description: '强浓雾' },
            '轻雾': { emoji: '🌫️', description: '轻雾' },
            '大雾': { emoji: '🌫️', description: '大雾' },
            '特强浓雾': { emoji: '🌫️', description: '特强浓雾' }
        };

        const weatherInfo = weatherMap[weather.weather] || { emoji: '🌤️', description: weather.weather || '未知' };

        return {
            city: weather.city || '未知城市',
            weather: weather.weather || '未知',
            temperature: weather.temperature || '未知',
            winddirection: weather.winddirection || '',
            windpower: weather.windpower || '',
            humidity: weather.humidity || '',
            reporttime: weather.reporttime || '',
            emoji: weatherInfo.emoji,
            description: weatherInfo.description,
            temperatureText: weather.temperature ? `${weather.temperature}°C` : '未知温度',
            summary: `${weatherInfo.description} ${weather.temperature ? weather.temperature + '°C' : ''}`
        };
    }

    // 检查是否到达新的地级市 - 已废弃，不再使用
    // checkNewCity(cityInfo) {
    //     if (!this.lastKnownCity) {
    //         return true;
    //     }
    //     return this.lastKnownCity !== cityInfo.city;
    // }

    // 获取默认天气信息
    getDefaultWeather() {
        return {
            city: '未知城市',
            weather: '晴',
            temperature: '25',
            emoji: '☀️',
            description: '晴天',
            temperatureText: '25°C',
            summary: '晴天 25°C',
            winddirection: '',
            windpower: '',
            humidity: '',
            reporttime: new Date().toISOString()
        };
    }

    // 清除天气缓存
    clearCache() {
        this.weatherCache.clear();
        console.log('Weather cache cleared');
    }

    // 设置当前位置
    setCurrentLocation(lng, lat) {
        this.currentLocation = { lng, lat };
    }

    // 获取当前位置的天气
    async getCurrentWeather() {
        if (!this.currentLocation) {
            console.log('No current location set');
            return this.getDefaultWeather();
        }

        return await this.getWeatherByCoordinates(this.currentLocation.lng, this.currentLocation.lat);
    }

    // HTTP请求方法 - 替代fetch
    httpRequest(url) {
        return new Promise((resolve, reject) => {
            const request = https.get(url, (response) => {
                let data = '';

                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (error) {
                        reject(new Error(`JSON parse error: ${error.message}`));
                    }
                });
            });

            request.on('error', (error) => {
                reject(new Error(`HTTP request error: ${error.message}`));
            });

            request.setTimeout(10000, () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }
}

module.exports = new WeatherService();
