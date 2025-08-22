// Centralized configuration for environment variables and defaults
// This avoids scattering process.env and literal fallbacks across the codebase

require('dotenv').config();

const DEFAULTS = {
    DASHSCOPE_API_KEY: "",
    DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    AMAP_KEY: ""
};

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || DEFAULTS.DASHSCOPE_API_KEY;
const DASHSCOPE_BASE_URL = process.env.DASHSCOPE_BASE_URL || DEFAULTS.DASHSCOPE_BASE_URL;
const AMAP_KEY = process.env.AMAP_KEY || DEFAULTS.AMAP_KEY;

const IS_AI_CONFIGURED = Boolean(process.env.DASHSCOPE_API_KEY) && DASHSCOPE_API_KEY !== DEFAULTS.DASHSCOPE_API_KEY;
const IS_AMAP_CONFIGURED = Boolean(process.env.AMAP_KEY) && AMAP_KEY !== DEFAULTS.AMAP_KEY;

module.exports = {
    DEFAULTS,
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    AMAP_KEY,
    IS_AI_CONFIGURED,
    IS_AMAP_CONFIGURED
};


