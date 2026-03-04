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
import { getMint, NATIVE_MINT } from "@solana/spl-token";
import { CpAmm, getTokenProgram, SwapMode } from "../dist/index.js";

// ─────────────────────────────────────────────
// 方法一：用 SOL 买入 Token
// ─────────────────────────────────────────────

/**
 * 用 SOL 买入 Token
 *
 * @param {object} params
 * @param {Connection} params.connection      - RPC 连接
 * @param {Keypair}    params.wallet          - 交易者钱包
 * @param {PublicKey}  params.poolAddress     - 池子地址
 * @param {BN}         params.solAmount       - SOL 数量（lamports，1 SOL = 1_000_000_000）
 * @param {number}     params.slippage        - 最大滑点，例如 0.5 表示 0.5%
 * @returns {Promise<{txSignature, expectedOut, minOut, priceImpact}>}
 */
export async function buyTokenWithSol({ connection, wallet, poolAddress, solAmount, slippage }) {
  const cpAmm = new CpAmm(connection);

  // 1. 获取池子状态
  const poolState = await cpAmm.fetchPoolState(poolAddress);

  // 2. 确认池子包含 SOL，确定 SOL 和 Token 的位置
  const solIsTokenA = poolState.tokenAMint.equals(NATIVE_MINT);
  const solIsTokenB = poolState.tokenBMint.equals(NATIVE_MINT);
  if (!solIsTokenA && !solIsTokenB) {
    throw new Error("该池子不包含 SOL（NATIVE_MINT），无法使用此方法");
  }

  // 用 SOL 买 Token：inputMint = NATIVE_MINT
  const inputTokenMint = NATIVE_MINT;
  const outputTokenMint = solIsTokenA ? poolState.tokenBMint : poolState.tokenAMint;

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
      ? new BN(currentSlot)  // 按 slot
      : new BN(blockTime);   // 按 timestamp

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
    amountIn: solAmount,
  });

  console.log(`[buyTokenWithSol] 报价信息:`);
  console.log(`  输入 SOL      : ${solAmount.toString()} lamports`);
  console.log(`  预期获得 Token: ${quote.outputAmount.toString()}`);
  console.log(`  最少获得 Token: ${quote.minimumAmountOut.toString()} (含滑点保护)`);
  console.log(`  价格影响      : ${quote.priceImpact.toFixed(4)}%`);

  // 6. 构建并发送 swap 交易（SDK 自动 wrap SOL → wSOL）
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
    minimumAmountOut: quote.minimumAmountOut,
  });

  const txSignature = await sendAndConfirmTransaction(connection, swapTx, [wallet]);

  return {
    txSignature,
    expectedOut: quote.outputAmount,
    minOut: quote.minimumAmountOut,
    priceImpact: quote.priceImpact.toFixed(4) + "%",
  };
}

// ─────────────────────────────────────────────
// 方法二：卖出 Token 换回 SOL
// ─────────────────────────────────────────────

/**
 * 卖出 Token 换回 SOL
 *
 * @param {object} params
 * @param {Connection} params.connection      - RPC 连接
 * @param {Keypair}    params.wallet          - 交易者钱包
 * @param {PublicKey}  params.poolAddress     - 池子地址
 * @param {BN}         params.tokenAmount     - Token 数量（含精度，精度为 6 时 1 Token = 1_000_000）
 * @param {number}     params.slippage        - 最大滑点，例如 0.5 表示 0.5%
 * @returns {Promise<{txSignature, expectedOut, minOut, priceImpact}>}
 */
export async function sellTokenForSol({ connection, wallet, poolAddress, tokenAmount, slippage }) {
  const cpAmm = new CpAmm(connection);

  // 1. 获取池子状态
  const poolState = await cpAmm.fetchPoolState(poolAddress);

  // 2. 确认池子包含 SOL，确定 SOL 和 Token 的位置
  const solIsTokenA = poolState.tokenAMint.equals(NATIVE_MINT);
  const solIsTokenB = poolState.tokenBMint.equals(NATIVE_MINT);
  if (!solIsTokenA && !solIsTokenB) {
    throw new Error("该池子不包含 SOL（NATIVE_MINT），无法使用此方法");
  }

  // 卖 Token 换 SOL：inputMint = Token，outputMint = NATIVE_MINT
  const inputTokenMint = solIsTokenA ? poolState.tokenBMint : poolState.tokenAMint;
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
  console.log(`  卖出 Token   : ${tokenAmount.toString()}`);
  console.log(`  预期获得 SOL : ${quote.outputAmount.toString()} lamports`);
  console.log(`  最少获得 SOL : ${quote.minimumAmountOut.toString()} lamports (含滑点保护)`);
  console.log(`  价格影响     : ${quote.priceImpact.toFixed(4)}%`);

  // 6. 构建并发送 swap 交易（SDK 自动 unwrap wSOL → SOL）
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
    minimumAmountOut: quote.minimumAmountOut,
  });

  const txSignature = await sendAndConfirmTransaction(connection, swapTx, [wallet]);

  return {
    txSignature,
    expectedOut: quote.outputAmount,
    minOut: quote.minimumAmountOut,
    priceImpact: quote.priceImpact.toFixed(4) + "%",
  };
}

// ─────────────────────────────────────────────
// 调用示例（主入口）
// ─────────────────────────────────────────────

(async () => {
  const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

  // 替换为你的实际钱包（示例用随机 Keypair）
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
    slippage: 0.5,                  // 0.5% 最大滑点
  });
  console.log("买入成功!");
  console.log("  交易签名:", buyResult.txSignature);
  console.log("  获得Token:", buyResult.expectedOut.toString());
  console.log("  价格影响:", buyResult.priceImpact);

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
  console.log("  交易签名:", sellResult.txSignature);
  console.log("  获得SOL:", sellResult.expectedOut.toString(), "lamports");
  console.log("  价格影响:", sellResult.priceImpact);
})();
