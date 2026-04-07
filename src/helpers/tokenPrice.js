/**
 * token USD 价格计算工具。
 *
 * 使用示例：
 *   const { Connection, PublicKey } = require("@solana/web3.js");
 *   const { getSolPriceUsd, getTokenPriceUsd } = require("@meteora-ag/cp-amm-sdk");
 *
 *   const connection = new Connection("https://api.mainnet-beta.solana.com");
 *   const tokenSolPoolAddress = new PublicKey("token/SOL 池地址");
 *
 *   // 1. 获取 SOL 价格（10 分钟缓存，从 Jupiter Price API 拉取）
 *   const solPrice = await getSolPriceUsd();
 *   console.log(`SOL 价格：$${solPrice.toFixed(2)}`);
 *
 *   // 2. 获取 token 的 USD 价格（token 精度为 6）
 *   //    tokenA/tokenB 顺序无所谓，函数内部自动判断哪个是 SOL
 *   const tokenPrice = await getTokenPriceUsd(connection, tokenSolPoolAddress, 6, solPrice);
 *   console.log(`Token 价格：$${tokenPrice.toFixed(6)}`);
 */

const { BN } = require("@coral-xyz/anchor");
const { NATIVE_MINT } = require("@solana/spl-token");
const { CpAmm } = require("../CpAmm");
const { getPriceFromSqrtPrice } = require("./utils");
const Decimal = require("decimal.js").default;

// SOL 精度
const SOL_DECIMAL = 9;
// Jupiter Price API 中 SOL 的 mint 地址
const SOL_MINT = "So11111111111111111111111111111111111111112";
// Jupiter Price API 地址
const JUPITER_PRICE_API = `https://api.jup.ag/price/v2?ids=${SOL_MINT}`;
// SOL 价格缓存有效期：10 分钟
const SOL_PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

// 模块级缓存变量，JS 模块只加载一次，进程运行期间始终有效，不会因函数调用而重置
let cachedSolPrice = null;
let lastFetchedAt = 0;

/**
 * 从 Jupiter Price API 获取 SOL 的 USD 价格，10 分钟内只请求一次。
 *
 * @returns {Promise<Decimal>} SOL 的 USD 价格
 */
async function getSolPriceUsd() {
  const now = Date.now();
  // 缓存未过期时直接返回
  if (cachedSolPrice !== null && now - lastFetchedAt < SOL_PRICE_CACHE_TTL_MS) {
    return cachedSolPrice;
  }

  // 从 Jupiter Price API 拉取 SOL 价格
  const res = await fetch(JUPITER_PRICE_API);
  const json = await res.json();
  const price = json?.data?.[SOL_MINT]?.price;
  if (!price) throw new Error("无法从 Jupiter Price API 获取 SOL 价格");

  cachedSolPrice = new Decimal(price);
  lastFetchedAt = now;
  return cachedSolPrice;
}

/**
 * 获取 token 的 USD 价格。
 * 自动判断池子中 SOL 是 tokenA 还是 tokenB。
 *
 * @param {Connection} connection          - Solana Connection 实例
 * @param {PublicKey}  tokenSolPoolAddress - token/SOL 池地址（顺序任意）
 * @param {number}     tokenDecimal        - 目标 token 的精度
 * @param {Decimal}    solPriceUsd         - SOL 的 USD 价格（由 getSolPriceUsd() 获取）
 * @returns {Promise<Decimal>} token 的 USD 价格
 */
async function getTokenPriceUsd(connection, tokenSolPoolAddress, tokenDecimal, solPriceUsd) {
  const cpAmm = new CpAmm(connection);
  const pool = await cpAmm._program.account.pool.fetch(tokenSolPoolAddress);
  const solIsTokenA = pool.tokenAMint.equals(NATIVE_MINT);

  let tokenPriceInSol;
  // tokenA=SOL, tokenB=token → getPriceFromSqrtPrice 返回 token/SOL，取倒数得 SOL/token
  // tokenA=token, tokenB=SOL → getPriceFromSqrtPrice 返回 SOL/token ✓
  if (solIsTokenA) {
    tokenPriceInSol = new Decimal(1).div(
      getPriceFromSqrtPrice(new BN(pool.sqrtPrice), SOL_DECIMAL, tokenDecimal)
    );
  } else {
    tokenPriceInSol = getPriceFromSqrtPrice(new BN(pool.sqrtPrice), tokenDecimal, SOL_DECIMAL);
  }

  return tokenPriceInSol.mul(solPriceUsd);
}

module.exports = { getSolPriceUsd, getTokenPriceUsd };
