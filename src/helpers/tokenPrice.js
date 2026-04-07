/**
 * token USD 价格计算工具。
 *
 * 使用示例：
 *   // 1. 获取 SOL 价格（10 分钟缓存，首次调用时自动拉取）
 *   const solPrice = await getSolPriceUsd(program, solUsdcPoolAddress);
 *
 *   // 2. 获取 token 的 USD 价格
 *   const tokenPrice = await getTokenPriceUsd(program, tokenSolPoolAddress, 6, solPrice);
 *   console.log(`Token 价格：$${tokenPrice.toFixed(6)}`);
 */

const { BN } = require("@coral-xyz/anchor");
const { getPriceFromSqrtPrice } = require("./utils");

// SOL 精度
const SOL_DECIMAL = 9;
// USDC 精度
const USDC_DECIMAL = 6;
// SOL 价格缓存有效期：10 分钟
const SOL_PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

// 模块级缓存变量，JS 模块只加载一次，进程运行期间始终有效，不会因函数调用而重置
let cachedSolPrice = null;
let lastFetchedAt = 0;

/**
 * 获取 SOL 的 USD 价格，10 分钟内只请求一次链上数据。
 *
 * @param {AmmProgram} program            - Anchor Program 实例
 * @param {PublicKey}  solUsdcPoolAddress - SOL/USDC 池地址（tokenA = SOL，tokenB = USDC）
 * @returns {Promise<Decimal>} SOL 的 USD 价格
 */
async function getSolPriceUsd(program, solUsdcPoolAddress) {
  const now = Date.now();
  // 缓存未过期时直接返回
  if (cachedSolPrice !== null && now - lastFetchedAt < SOL_PRICE_CACHE_TTL_MS) {
    return cachedSolPrice;
  }
  // 拉取链上数据并更新缓存
  const pool = await program.account.pool.fetch(solUsdcPoolAddress);
  cachedSolPrice = getPriceFromSqrtPrice(new BN(pool.sqrtPrice), SOL_DECIMAL, USDC_DECIMAL);
  lastFetchedAt = now;
  return cachedSolPrice;
}

/**
 * 获取 token 的 USD 价格。
 *
 * @param {AmmProgram} program             - Anchor Program 实例
 * @param {PublicKey}  tokenSolPoolAddress - token/SOL 池地址（tokenA = 目标token，tokenB = SOL）
 * @param {number}     tokenDecimal        - 目标 token 的精度
 * @param {Decimal}    solPriceUsd         - SOL 的 USD 价格（由 getSolPriceUsd() 获取）
 * @returns {Promise<Decimal>} token 的 USD 价格
 */
async function getTokenPriceUsd(program, tokenSolPoolAddress, tokenDecimal, solPriceUsd) {
  const pool = await program.account.pool.fetch(tokenSolPoolAddress);
  // token 以 SOL 计价的价格，再乘以 SOL/USD 得到 token 的 USD 价格
  const tokenPriceInSol = getPriceFromSqrtPrice(new BN(pool.sqrtPrice), tokenDecimal, SOL_DECIMAL);
  return tokenPriceInSol.mul(solPriceUsd);
}

module.exports = { getSolPriceUsd, getTokenPriceUsd };
