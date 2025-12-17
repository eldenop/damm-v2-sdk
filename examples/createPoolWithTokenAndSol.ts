/**
 * 简单封装方法：使用 Token 和 SOL 创建流动性池
 *
 * 使用方法:
 * 1. 设置环境变量或修改 CONFIG
 * 2. 运行: npx ts-node examples/createPoolWithTokenAndSol.ts
 */

import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  CpAmm,
  derivePoolAddress,
  derivePositionAddress,
  getSqrtPriceFromPrice,
} from "../src";
import {
  getMint,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// ============================================
// 配置参数
// ============================================
interface CreatePoolConfig {
  /** RPC URL */
  rpcUrl: string;
  /** 钱包私钥路径 */
  keypairPath: string;
  /** Token A 的 mint 地址 (你的代币) */
  tokenMint: string;
  /** 池子配置地址 (从 Meteora 获取) */
  configAddress: string;
  /** Token 数量 (不含精度) */
  tokenAmount: number;
  /** SOL 数量 */
  solAmount: number;
  /** 初始价格 (1 Token = ? SOL) */
  initialPrice: number;
  /** Token 的精度 (通常是 6 或 9) */
  tokenDecimals: number;
  /** 是否锁定流动性 */
  isLockLiquidity: boolean;
}

// ============================================
// 主要封装方法
// ============================================

/**
 * 创建 Token + SOL 流动性池
 *
 * @param config - 池子配置参数
 * @returns 创建结果，包含池地址、头寸地址和交易签名
 */
export async function createTokenSolPool(config: CreatePoolConfig): Promise<{
  pool: string;
  position: string;
  positionNft: string;
  signature: string;
}> {
  // 1. 初始化连接和钱包
  const connection = new Connection(config.rpcUrl);
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(require(config.keypairPath))
  );

  // 2. 初始化 SDK
  const cpAmm = new CpAmm(connection);

  // 3. 解析地址
  const tokenAMint = new PublicKey(config.tokenMint);
  const tokenBMint = NATIVE_MINT; // SOL 的 mint 地址
  const configPubkey = new PublicKey(config.configAddress);

  // 4. 获取配置状态
  const configState = await cpAmm.fetchConfigState(configPubkey);

  // 5. 检测 Token 类型 (SPL Token 或 Token 2022)
  const tokenAAccountInfo = await connection.getAccountInfo(tokenAMint);
  if (!tokenAAccountInfo) {
    throw new Error(`Token mint not found: ${config.tokenMint}`);
  }

  let tokenAProgram = TOKEN_PROGRAM_ID;
  let tokenAInfo = undefined;

  if (tokenAAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    tokenAProgram = TOKEN_2022_PROGRAM_ID;
    const baseMint = await getMint(
      connection,
      tokenAMint,
      connection.commitment,
      tokenAProgram
    );
    const epochInfo = await connection.getEpochInfo();
    tokenAInfo = {
      mint: baseMint,
      currentEpoch: epochInfo.epoch,
    };
  }

  // 6. 计算金额 (添加精度)
  const tokenADecimals = config.tokenDecimals;
  const tokenBDecimals = 9; // SOL 精度固定为 9

  const tokenAAmount = new BN(config.tokenAmount).mul(
    new BN(10 ** tokenADecimals)
  );
  const tokenBAmount = new BN(config.solAmount * 10 ** tokenBDecimals);

  // 7. 计算初始价格的平方根
  const initSqrtPrice = getSqrtPriceFromPrice(
    config.initialPrice.toString(),
    tokenADecimals,
    tokenBDecimals
  );

  // 8. 计算流动性
  const liquidityDelta = cpAmm.getLiquidityDelta({
    maxAmountTokenA: tokenAAmount,
    maxAmountTokenB: tokenBAmount,
    sqrtPrice: initSqrtPrice,
    sqrtMinPrice: configState.sqrtMinPrice,
    sqrtMaxPrice: configState.sqrtMaxPrice,
    tokenAInfo,
  });

  // 9. 生成头寸 NFT keypair
  const positionNft = Keypair.generate();

  // 10. 创建池子交易
  console.log("Creating pool...");
  console.log(`Token A: ${tokenAMint.toBase58()}`);
  console.log(`Token B: ${tokenBMint.toBase58()} (SOL)`);
  console.log(`Token A Amount: ${config.tokenAmount}`);
  console.log(`SOL Amount: ${config.solAmount}`);
  console.log(`Initial Price: 1 Token = ${config.initialPrice} SOL`);

  const initPoolTx = await cpAmm.createPool({
    payer: wallet.publicKey,
    creator: wallet.publicKey,
    config: configPubkey,
    positionNft: positionNft.publicKey,
    tokenAMint: tokenAMint,
    tokenBMint: tokenBMint,
    tokenAAmount: tokenAAmount,
    tokenBAmount: tokenBAmount,
    liquidityDelta: liquidityDelta,
    initSqrtPrice: initSqrtPrice,
    activationPoint: null,
    tokenAProgram,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: config.isLockLiquidity,
  });

  // 11. 发送交易
  const signature = await sendAndConfirmTransaction(
    connection,
    initPoolTx,
    [wallet, positionNft],
    { commitment: "confirmed" }
  );

  // 12. 计算返回地址
  const poolAddress = derivePoolAddress(configPubkey, tokenAMint, tokenBMint);
  const positionAddress = derivePositionAddress(positionNft.publicKey);

  console.log("\n✅ Pool created successfully!");
  console.log(`Pool: ${poolAddress.toBase58()}`);
  console.log(`Position: ${positionAddress.toBase58()}`);
  console.log(`Position NFT: ${positionNft.publicKey.toBase58()}`);
  console.log(`Signature: ${signature}`);

  return {
    pool: poolAddress.toBase58(),
    position: positionAddress.toBase58(),
    positionNft: positionNft.publicKey.toBase58(),
    signature,
  };
}

// ============================================
// 简化版本：最少参数调用
// ============================================

/**
 * 快速创建 Token + SOL 流动性池 (最简参数版本)
 *
 * @param rpcUrl - RPC URL
 * @param walletKeypair - 钱包 Keypair
 * @param tokenMint - Token mint 地址
 * @param configAddress - 配置地址
 * @param tokenAmount - Token 数量
 * @param solAmount - SOL 数量
 * @param tokenDecimals - Token 精度
 */
export async function quickCreatePool(
  rpcUrl: string,
  walletKeypair: Keypair,
  tokenMint: string,
  configAddress: string,
  tokenAmount: number,
  solAmount: number,
  tokenDecimals: number = 9
): Promise<{
  pool: string;
  position: string;
  positionNft: string;
  signature: string;
}> {
  const connection = new Connection(rpcUrl);
  const cpAmm = new CpAmm(connection);

  const tokenAMint = new PublicKey(tokenMint);
  const tokenBMint = NATIVE_MINT;
  const configPubkey = new PublicKey(configAddress);

  // 获取配置
  const configState = await cpAmm.fetchConfigState(configPubkey);

  // 检测 Token 类型
  const tokenAAccountInfo = await connection.getAccountInfo(tokenAMint);
  let tokenAProgram = TOKEN_PROGRAM_ID;
  let tokenAInfo = undefined;

  if (tokenAAccountInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    tokenAProgram = TOKEN_2022_PROGRAM_ID;
    const baseMint = await getMint(connection, tokenAMint, connection.commitment, tokenAProgram);
    const epochInfo = await connection.getEpochInfo();
    tokenAInfo = { mint: baseMint, currentEpoch: epochInfo.epoch };
  }

  // 计算金额和价格
  const tokenAAmount = new BN(tokenAmount).mul(new BN(10 ** tokenDecimals));
  const tokenBAmount = new BN(solAmount * 10 ** 9);

  // 根据数量自动计算初始价格
  const initialPrice = solAmount / tokenAmount;
  const initSqrtPrice = getSqrtPriceFromPrice(initialPrice.toString(), tokenDecimals, 9);

  // 计算流动性
  const liquidityDelta = cpAmm.getLiquidityDelta({
    maxAmountTokenA: tokenAAmount,
    maxAmountTokenB: tokenBAmount,
    sqrtPrice: initSqrtPrice,
    sqrtMinPrice: configState.sqrtMinPrice,
    sqrtMaxPrice: configState.sqrtMaxPrice,
    tokenAInfo,
  });

  // 创建池子
  const positionNft = Keypair.generate();
  const initPoolTx = await cpAmm.createPool({
    payer: walletKeypair.publicKey,
    creator: walletKeypair.publicKey,
    config: configPubkey,
    positionNft: positionNft.publicKey,
    tokenAMint,
    tokenBMint,
    tokenAAmount,
    tokenBAmount,
    liquidityDelta,
    initSqrtPrice,
    activationPoint: null,
    tokenAProgram,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: true,
  });

  const signature = await sendAndConfirmTransaction(
    connection,
    initPoolTx,
    [walletKeypair, positionNft],
    { commitment: "confirmed" }
  );

  const poolAddress = derivePoolAddress(configPubkey, tokenAMint, tokenBMint);
  const positionAddress = derivePositionAddress(positionNft.publicKey);

  return {
    pool: poolAddress.toBase58(),
    position: positionAddress.toBase58(),
    positionNft: positionNft.publicKey.toBase58(),
    signature,
  };
}

// ============================================
// 使用示例
// ============================================

async function main() {
  // 方式1: 完整配置
  const result1 = await createTokenSolPool({
    rpcUrl: clusterApiUrl("devnet"),
    keypairPath: "~/.config/solana/id.json",
    tokenMint: "YOUR_TOKEN_MINT_ADDRESS",
    configAddress: "8CNy9goNQNLM4wtgRw528tUQGMKD3vSuFRZY2gLGLLvF", // Devnet config
    tokenAmount: 1_000_000,  // 100万个代币
    solAmount: 1,            // 1 SOL
    initialPrice: 0.000001,  // 1 Token = 0.000001 SOL
    tokenDecimals: 9,
    isLockLiquidity: true,   // 锁定流动性
  });

  console.log("Result:", result1);

  // 方式2: 简化调用
  // const wallet = Keypair.fromSecretKey(...);
  // const result2 = await quickCreatePool(
  //   clusterApiUrl("devnet"),
  //   wallet,
  //   "YOUR_TOKEN_MINT_ADDRESS",
  //   "8CNy9goNQNLM4wtgRw528tUQGMKD3vSuFRZY2gLGLLvF",
  //   1_000_000,  // Token 数量
  //   1,          // SOL 数量
  //   9           // Token 精度
  // );
}

// 如果直接运行此文件
if (require.main === module) {
  main().catch(console.error);
}
