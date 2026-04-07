/**
 * tokenPrice.ts
 *
 * Token USD 价格计算模块。
 *
 * 核心思路：
 *   - DAMM v2 池子用 sqrtPrice（Q64.64 定点数）表示当前价格，而非直接存储两种代币的数量比值。
 *   - token/SOL 池的 sqrtPrice → token 以 SOL 计价的价格。
 *   - SOL/USDC 池的 sqrtPrice → SOL 以 USDC 计价的价格（即 SOL 的 USD 价格）。
 *   - 两者相乘即得 token 的 USD 价格。
 *   - SOL 价格变化缓慢，使用 10 分钟缓存避免频繁链上请求。
 *
 * 导出：
 *   - TokenPriceCalculator  类，封装缓存与计算逻辑，推荐使用。
 *   - calculateTokenPriceInUsd         一次性计算（不带缓存）。
 *   - createSolPriceCache              独立缓存工厂（高级用法）。
 *   - calculateTokenPriceInUsdCached   配合缓存工厂使用（高级用法）。
 *
 * ─────────────────────────────────────────────────────────────
 * 快速使用示例（推荐）：
 *
 *   import { Connection, PublicKey } from "@solana/web3.js";
 *   import { AnchorProvider, Program } from "@coral-xyz/anchor";
 *   import CpAmmIdl from "@meteora-ag/cp-amm-sdk/idl/cp_amm.json";
 *   import { TokenPriceCalculator } from "@meteora-ag/cp-amm-sdk";
 *
 *   const connection = new Connection("https://api.mainnet-beta.solana.com");
 *   const provider   = new AnchorProvider(connection, wallet, {});
 *   const program    = new Program(CpAmmIdl, provider);
 *
 *   // SOL/USDC 池地址（tokenA = SOL, tokenB = USDC）
 *   const SOL_USDC_POOL = new PublicKey("池子地址...");
 *
 *   // 初始化计算器（全局单例，整个应用复用同一个实例）
 *   const calculator = new TokenPriceCalculator(
 *     program,
 *     SOL_USDC_POOL,
 *     9,   // SOL 精度
 *     6    // USDC 精度
 *   );
 *
 *   // 获取某个 token 的 USD 价格
 *   const TOKEN_SOL_POOL = new PublicKey("token/SOL 池地址...");
 *   const priceUsd = await calculator.getTokenPriceUsd(TOKEN_SOL_POOL, 6);
 *   console.log(`Token 价格：$${priceUsd.toFixed(6)}`);
 * ─────────────────────────────────────────────────────────────
 */

import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { getPriceFromSqrtPrice } from "./utils";
import type { AmmProgram } from "../types";

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** SOL 价格缓存有效期：10 分钟 */
const SOL_PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

// ─── 推荐用法：TokenPriceCalculator 类 ───────────────────────────────────────

/**
 * Token USD 价格计算器。
 *
 * 内部自动缓存 SOL/USDC 价格（10 分钟刷新一次），
 * 调用方只需传入 token/SOL 池地址与精度即可获得 USD 价格。
 *
 * @example
 *   const calculator = new TokenPriceCalculator(program, SOL_USDC_POOL, 9, 6);
 *   const price = await calculator.getTokenPriceUsd(tokenSolPoolAddress, 6);
 */
export class TokenPriceCalculator {
  private readonly program: AmmProgram;
  private readonly solUsdcPoolAddress: PublicKey;
  private readonly solDecimal: number;
  private readonly usdcDecimal: number;

  /** 缓存的 SOL/USD 价格 */
  private cachedSolPrice: Decimal | null = null;
  /** 上次拉取时间戳（ms） */
  private lastFetchedAt = 0;

  /**
   * @param program          - Anchor Program 实例（来自 CpAmm 或自行构建）
   * @param solUsdcPoolAddress - SOL/USDC 池地址（tokenA = SOL，tokenB = USDC）
   * @param solDecimal       - SOL 精度，通常为 9
   * @param usdcDecimal      - USDC 精度，通常为 6
   */
  constructor(
    program: AmmProgram,
    solUsdcPoolAddress: PublicKey,
    solDecimal: number,
    usdcDecimal: number
  ) {
    this.program = program;
    this.solUsdcPoolAddress = solUsdcPoolAddress;
    this.solDecimal = solDecimal;
    this.usdcDecimal = usdcDecimal;
  }

  /**
   * 获取 SOL 的 USD 价格（带 10 分钟缓存）。
   *
   * 缓存未过期时直接返回缓存值，过期后自动从链上 SOL/USDC 池重新拉取。
   */
  async getSolPriceUsd(): Promise<Decimal> {
    const now = Date.now();
    // 缓存为空或已超过 TTL 时重新拉取
    if (
      this.cachedSolPrice === null ||
      now - this.lastFetchedAt >= SOL_PRICE_CACHE_TTL_MS
    ) {
      const pool = await this.program.account.pool.fetch(
        this.solUsdcPoolAddress
      );
      this.cachedSolPrice = getPriceFromSqrtPrice(
        new BN(pool.sqrtPrice),
        this.solDecimal,
        this.usdcDecimal
      );
      this.lastFetchedAt = now;
    }
    return this.cachedSolPrice!;
  }

  /**
   * 根据 token/SOL 池地址计算 token 的 USD 价格。
   *
   * 计算流程：
   *   1. 从链上拉取 token/SOL 池的 sqrtPrice
   *   2. 换算出 token 以 SOL 计价的价格
   *   3. 乘以缓存的 SOL/USD 价格，得到 token 的 USD 价格
   *
   * @param tokenSolPoolAddress - token/SOL 池地址（tokenA = 目标token，tokenB = SOL）
   * @param tokenDecimal        - 目标 token 的精度
   * @returns token 的 USD 价格（Decimal 类型）
   */
  async getTokenPriceUsd(
    tokenSolPoolAddress: PublicKey,
    tokenDecimal: number
  ): Promise<Decimal> {
    // 并行拉取 token/SOL 池数据与 SOL 缓存价格
    const [tokenSolPool, solPriceUsd] = await Promise.all([
      this.program.account.pool.fetch(tokenSolPoolAddress),
      this.getSolPriceUsd(),
    ]);

    // token 以 SOL 计价的价格
    const tokenPriceInSol = getPriceFromSqrtPrice(
      new BN(tokenSolPool.sqrtPrice),
      tokenDecimal,
      this.solDecimal
    );

    // token 的 USD 价格 = token/SOL × SOL/USD
    return tokenPriceInSol.mul(solPriceUsd);
  }

  /**
   * 强制刷新 SOL 价格缓存（忽略 TTL，立即从链上重新拉取）。
   *
   * 一般不需要手动调用，仅在需要立即更新时使用。
   */
  async refreshSolPrice(): Promise<Decimal> {
    this.lastFetchedAt = 0; // 置零触发重新拉取
    return this.getSolPriceUsd();
  }
}

// ─── 高级用法：独立函数（不依赖类） ──────────────────────────────────────────

/**
 * 一次性计算 token 的 USD 价格（不带缓存）。
 *
 * 适合偶尔调用的场景；高频场景推荐使用 TokenPriceCalculator 类。
 *
 * @param tokenSolPoolSqrtPrice  - token/SOL 池的 sqrtPrice（tokenA = 目标token，tokenB = SOL）
 * @param tokenDecimal           - 目标 token 的精度
 * @param solDecimal             - SOL 的精度（通常为 9）
 * @param solUsdcPoolSqrtPrice   - SOL/USDC 池的 sqrtPrice（tokenA = SOL，tokenB = USDC）
 * @param usdcDecimal            - USDC 的精度（通常为 6）
 * @returns token 的 USD 价格（Decimal 类型）
 */
export const calculateTokenPriceInUsd = (
  tokenSolPoolSqrtPrice: BN,
  tokenDecimal: number,
  solDecimal: number,
  solUsdcPoolSqrtPrice: BN,
  usdcDecimal: number
): Decimal => {
  // 第一步：从 token/SOL 池获取 token 以 SOL 计价的价格
  const tokenPriceInSol = getPriceFromSqrtPrice(
    tokenSolPoolSqrtPrice,
    tokenDecimal,
    solDecimal
  );

  // 第二步：从 SOL/USDC 池获取 SOL 以 USDC 计价的价格
  const solPriceInUsd = getPriceFromSqrtPrice(
    solUsdcPoolSqrtPrice,
    solDecimal,
    usdcDecimal
  );

  // 第三步：相乘得到 token 的 USD 价格
  return tokenPriceInSol.mul(solPriceInUsd);
};

/**
 * 创建一个带缓存的 SOL 价格获取器，最多每 10 分钟刷新一次。
 *
 * fetcher 由调用方提供，可以是链上 SOL/USDC 池、Pyth 预言机等任意数据源。
 * 返回的函数在整个应用生命周期内共享同一份缓存，请在模块顶层创建一次后复用。
 *
 * @param fetcher - 返回当前 SOL/USD 价格的异步函数
 * @returns 带缓存的 SOL 价格获取函数
 *
 * @example
 *   const getSolPrice = createSolPriceCache(async () => {
 *     const pool = await program.account.pool.fetch(solUsdcPoolAddress);
 *     return getPriceFromSqrtPrice(new BN(pool.sqrtPrice), 9, 6);
 *   });
 *
 *   const price = await getSolPrice(); // 首次拉取，之后 10 分钟内返回缓存
 */
export const createSolPriceCache = (
  fetcher: () => Promise<Decimal>
): (() => Promise<Decimal>) => {
  let cachedPrice: Decimal | null = null;
  let lastFetchedAt = 0;

  return async (): Promise<Decimal> => {
    const now = Date.now();
    // 缓存为空或已超过 TTL 时重新拉取
    if (cachedPrice === null || now - lastFetchedAt >= SOL_PRICE_CACHE_TTL_MS) {
      cachedPrice = await fetcher();
      lastFetchedAt = now;
    }
    return cachedPrice;
  };
};

/**
 * 使用缓存的 SOL 价格计算 token 的 USD 价格。
 *
 * 配合 createSolPriceCache() 使用，适合需要自定义数据源的场景。
 *
 * @param tokenSolPoolSqrtPrice - token/SOL 池的 sqrtPrice（tokenA = 目标token，tokenB = SOL）
 * @param tokenDecimal          - 目标 token 的精度
 * @param solDecimal            - SOL 的精度（通常为 9）
 * @param getCachedSolPrice     - 由 createSolPriceCache() 创建的缓存获取函数
 * @returns token 的 USD 价格（Decimal 类型）
 *
 * @example
 *   const getSolPrice = createSolPriceCache(fetchSolPriceFromPyth);
 *   const price = await calculateTokenPriceInUsdCached(
 *     tokenSolPool.sqrtPrice, 6, 9, getSolPrice
 *   );
 */
export const calculateTokenPriceInUsdCached = async (
  tokenSolPoolSqrtPrice: BN,
  tokenDecimal: number,
  solDecimal: number,
  getCachedSolPrice: () => Promise<Decimal>
): Promise<Decimal> => {
  // 从 token/SOL 池计算 token 以 SOL 计价的价格
  const tokenPriceInSol = getPriceFromSqrtPrice(
    tokenSolPoolSqrtPrice,
    tokenDecimal,
    solDecimal
  );

  // 从缓存中获取 SOL 的 USD 价格
  const solPriceInUsd = await getCachedSolPrice();

  // 相乘得到 token 的 USD 价格
  return tokenPriceInSol.mul(solPriceInUsd);
};
