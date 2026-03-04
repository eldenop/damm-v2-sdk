/**
 * SOL <-> Token 交易工具
 *
 * 提供两个独立方法：
 *   - buyTokenWithSol：用 SOL 买入 Token
 *   - sellTokenForSol：卖出 Token 换回 SOL
 *
 * 前提条件：池子必须是 SOL/Token 交易对（其中一方为 NATIVE_MINT）
 */

import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getMint, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CpAmm, getTokenProgram, SwapMode } from "../src";

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

interface SwapSolTokenParams {
  /** RPC 连接 */
  connection: Connection;
  /** 交易者钱包（Keypair） */
  wallet: Keypair;
  /** 池子地址 */
  poolAddress: PublicKey;
  /** SOL 数量（单位：lamports，1 SOL = 1_000_000_000） */
  solAmount: BN;
  /** 最大滑点百分比，例如 0.5 表示 0.5% */
  slippage: number;
}

interface SwapTokenSolParams {
  /** RPC 连接 */
  connection: Connection;
  /** 交易者钱包（Keypair） */
  wallet: Keypair;
  /** 池子地址 */
  poolAddress: PublicKey;
  /** Token 数量（含精度，例如精度为 6 时 1 Token = 1_000_000） */
  tokenAmount: BN;
  /** 最大滑点百分比，例如 0.5 表示 0.5% */
  slippage: number;
}

interface SwapResult {
  /** 交易签名 */
  txSignature: string;
  /** 预期输出数量 */
  expectedOut: BN;
  /** 最小输出数量（含滑点保护） */
  minOut: BN;
  /** 价格影响百分比 */
  priceImpact: string;
}

// ─────────────────────────────────────────────
// 方法一：用 SOL 买入 Token
// ─────────────────────────────────────────────

/**
 * 用 SOL 买入 Token
 *
 * @example
 * const result = await buyTokenWithSol({
 *   connection,
 *   wallet,
 *   poolAddress: new PublicKey("你的池子地址"),
 *   solAmount: new BN(0.1 * 1e9), // 0.1 SOL
 *   slippage: 0.5,                // 0.5% 滑点
 * });
 * console.log("交易成功:", result.txSignature);
 */
export async function buyTokenWithSol(
  params: SwapSolTokenParams
): Promise<SwapResult> {
  const { connection, wallet, poolAddress, solAmount, slippage } = params;

  const cpAmm = new CpAmm(connection);

  // 1. 获取池子状态
  const poolState = await cpAmm.fetchPoolState(poolAddress);

  // 2. 确认池子包含 SOL（NATIVE_MINT），并确定 SOL 和 Token 的位置
  const solIsTokenA = poolState.tokenAMint.equals(NATIVE_MINT);
  const solIsTokenB = poolState.tokenBMint.equals(NATIVE_MINT);
  if (!solIsTokenA && !solIsTokenB) {
    throw new Error("该池子不包含 SOL（NATIVE_MINT），无法使用此方法");
  }

  // 用 SOL 买 Token：inputMint = NATIVE_MINT
  const inputTokenMint = NATIVE_MINT;
  const outputTokenMint = solIsTokenA
    ? poolState.tokenBMint
    : poolState.tokenAMint;

  // 3. 从链上获取 Token 精度
  const solDecimals = 9;
  const tokenMintInfo = await getMint(connection, outputTokenMint);
  const tokenDecimals = tokenMintInfo.decimals;

  const [tokenADecimal, tokenBDecimal] = solIsTokenA
    ? [solDecimals, tokenDecimals]
    : [tokenDecimals, solDecimals];

  // 4. 获取当前时间点（适配 slot/timestamp 两种激活类型）
  const currentSlot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(currentSlot);
  if (!blockTime) throw new Error("无法获取链上时间");

  const currentPoint =
    poolState.activationType === 0
      ? new BN(currentSlot)   // 按 slot
      : new BN(blockTime);    // 按 timestamp

  // 5. 计算报价（滑点、价格影响、最少输出量）
  const quote = cpAmm.getQuote2({
    inputTokenMint,
    slippage,
    currentPoint,
    poolState,
    tokenADecimal,
    tokenBDecimal,
    hasReferral: false,
    swapMode: SwapMode.ExactIn,
    amountIn: solAmount,
  });

  console.log(`[buyTokenWithSol] 报价信息:`);
  console.log(`  输入 SOL     : ${solAmount.toString()} lamports`);
  console.log(`  预期获得 Token: ${quote.outputAmount.toString()}`);
  console.log(`  最少获得 Token: ${quote.minimumAmountOut!.toString()} (含滑点保护)`);
  console.log(`  价格影响      : ${quote.priceImpact.toFixed(4)}%`);

  // 6. 构建并发送 swap 交易
  const swapTx = await cpAmm.swap2({
    payer: wallet.publicKey,
    pool: poolAddress,
    inputTokenMint,
    outputTokenMint,
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAProgram: getTokenProgram(poolState.tokenAFlag),
    tokenBProgram: getTokenProgram(poolState.tokenBFlag),
    referralTokenAccount: null,
    poolState,
    swapMode: SwapMode.ExactIn,
    amountIn: solAmount,
    minimumAmountOut: quote.minimumAmountOut!,
  });

  const txSignature = await sendAndConfirmTransaction(connection, swapTx, [
    wallet,
  ]);

  return {
    txSignature,
    expectedOut: quote.outputAmount,
    minOut: quote.minimumAmountOut!,
    priceImpact: quote.priceImpact.toFixed(4) + "%",
  };
}

// ─────────────────────────────────────────────
// 方法二：卖出 Token 换回 SOL
// ─────────────────────────────────────────────

/**
 * 卖出 Token 换回 SOL
 *
 * @example
 * const result = await sellTokenForSol({
 *   connection,
 *   wallet,
 *   poolAddress: new PublicKey("你的池子地址"),
 *   tokenAmount: new BN(100 * 1e6), // 100 Token（精度 6）
 *   slippage: 0.5,                  // 0.5% 滑点
 * });
 * console.log("交易成功:", result.txSignature);
 */
export async function sellTokenForSol(
  params: SwapTokenSolParams
): Promise<SwapResult> {
  const { connection, wallet, poolAddress, tokenAmount, slippage } = params;

  const cpAmm = new CpAmm(connection);

  // 1. 获取池子状态
  const poolState = await cpAmm.fetchPoolState(poolAddress);

  // 2. 确认池子包含 SOL（NATIVE_MINT），并确定 SOL 和 Token 的位置
  const solIsTokenA = poolState.tokenAMint.equals(NATIVE_MINT);
  const solIsTokenB = poolState.tokenBMint.equals(NATIVE_MINT);
  if (!solIsTokenA && !solIsTokenB) {
    throw new Error("该池子不包含 SOL（NATIVE_MINT），无法使用此方法");
  }

  // 卖 Token 换 SOL：inputMint = Token，outputMint = NATIVE_MINT
  const inputTokenMint = solIsTokenA
    ? poolState.tokenBMint
    : poolState.tokenAMint;
  const outputTokenMint = NATIVE_MINT;

  // 3. 从链上获取 Token 精度
  const solDecimals = 9;
  const tokenMintInfo = await getMint(connection, inputTokenMint);
  const tokenDecimals = tokenMintInfo.decimals;

  const [tokenADecimal, tokenBDecimal] = solIsTokenA
    ? [solDecimals, tokenDecimals]
    : [tokenDecimals, solDecimals];

  // 4. 获取当前时间点
  const currentSlot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(currentSlot);
  if (!blockTime) throw new Error("无法获取链上时间");

  const currentPoint =
    poolState.activationType === 0
      ? new BN(currentSlot)
      : new BN(blockTime);

  // 5. 计算报价
  const quote = cpAmm.getQuote2({
    inputTokenMint,
    slippage,
    currentPoint,
    poolState,
    tokenADecimal,
    tokenBDecimal,
    hasReferral: false,
    swapMode: SwapMode.ExactIn,
    amountIn: tokenAmount,
  });

  console.log(`[sellTokenForSol] 报价信息:`);
  console.log(`  卖出 Token    : ${tokenAmount.toString()}`);
  console.log(`  预期获得 SOL  : ${quote.outputAmount.toString()} lamports`);
  console.log(`  最少获得 SOL  : ${quote.minimumAmountOut!.toString()} lamports (含滑点保护)`);
  console.log(`  价格影响      : ${quote.priceImpact.toFixed(4)}%`);

  // 6. 构建并发送 swap 交易（SDK 会自动 unwrap wSOL → SOL）
  const swapTx = await cpAmm.swap2({
    payer: wallet.publicKey,
    pool: poolAddress,
    inputTokenMint,
    outputTokenMint,
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAProgram: getTokenProgram(poolState.tokenAFlag),
    tokenBProgram: getTokenProgram(poolState.tokenBFlag),
    referralTokenAccount: null,
    poolState,
    swapMode: SwapMode.ExactIn,
    amountIn: tokenAmount,
    minimumAmountOut: quote.minimumAmountOut!,
  });

  const txSignature = await sendAndConfirmTransaction(connection, swapTx, [
    wallet,
  ]);

  return {
    txSignature,
    expectedOut: quote.outputAmount,
    minOut: quote.minimumAmountOut!,
    priceImpact: quote.priceImpact.toFixed(4) + "%",
  };
}

// ─────────────────────────────────────────────
// 调用示例（主入口）
// ─────────────────────────────────────────────

(async () => {
  // --- 基础配置 ---
  const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

  // 从本地 id.json 加载钱包（示例用随机 Keypair 替代）
  const wallet = Keypair.generate();

  // SOL/Token 池子地址（替换为实际地址）
  const poolAddress = new PublicKey("替换为实际的池子地址");

  // ── 示例 1：用 0.1 SOL 买入 Token ──────────────
  console.log("\n=== 买入 Token（用 SOL） ===");
  const buyResult = await buyTokenWithSol({
    connection,
    wallet,
    poolAddress,
    solAmount: new BN(0.1 * 1e9), // 0.1 SOL（单位 lamports）
    slippage: 0.5,                 // 0.5% 最大滑点
  });
  console.log("买入成功!");
  console.log("  交易签名   :", buyResult.txSignature);
  console.log("  实际获得   :", buyResult.expectedOut.toString());
  console.log("  价格影响   :", buyResult.priceImpact);

  // ── 示例 2：卖出 100 Token 换回 SOL ────────────
  console.log("\n=== 卖出 Token（换回 SOL） ===");
  const sellResult = await sellTokenForSol({
    connection,
    wallet,
    poolAddress,
    tokenAmount: new BN(100 * 1e6), // 100 Token（精度 6，按实际精度修改）
    slippage: 0.5,
  });
  console.log("卖出成功!");
  console.log("  交易签名   :", sellResult.txSignature);
  console.log("  获得 SOL   :", sellResult.expectedOut.toString(), "lamports");
  console.log("  价格影响   :", sellResult.priceImpact);
})();
