/**
 * 简单封装方法：使用 Token 和 SOL 创建流动性池
 *
 * 使用方法:
 * 1. 修改下方 CONFIG 配置
 * 2. 运行: npx ts-node examples/createPoolWithTokenAndSol.ts
 */

import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
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
// 配置参数类型
// ============================================
export interface CreatePoolParams {
  /** RPC URL */
  rpcUrl: string;
  /** 钱包 Keypair */
  wallet: Keypair;
  /** Token 的 mint 地址 */
  tokenMint: string;
  /** 池子配置地址 (从 Meteora 获取) */
  configAddress: string;
  /** Token 数量 (不含精度，例如 1000000 表示 100万个) */
  tokenAmount: number;
  /** SOL 数量 (例如 1 表示 1 SOL) */
  solAmount: number;
  /** Token 的精度 (通常是 6 或 9)，默认 9 */
  tokenDecimals?: number;
  /** 是否锁定流动性 (默认 false，不锁定可随时取出) */
  lockLiquidity?: boolean;
}

export interface CreatePoolResult {
  /** 池子地址 */
  pool: string;
  /** 头寸地址 */
  position: string;
  /** 头寸 NFT 地址 (需保存，用于后续操作) */
  positionNft: string;
  /** 头寸 NFT Keypair (需保存私钥，用于后续操作) */
  positionNftKeypair: Keypair;
  /** 交易签名 */
  signature: string;
}

// ============================================
// 主要封装方法
// ============================================

/**
 * 创建 Token + SOL 流动性池
 *
 * @param params - 创建池子的参数
 * @returns 创建结果
 *
 * @example
 * ```typescript
 * const result = await createTokenSolPool({
 *   rpcUrl: "https://api.devnet.solana.com",
 *   wallet: myWalletKeypair,
 *   tokenMint: "YOUR_TOKEN_MINT_ADDRESS",
 *   configAddress: "8CNy9goNQNLM4wtgRw528tUQGMKD3vSuFRZY2gLGLLvF",
 *   tokenAmount: 1_000_000,  // 100万个代币
 *   solAmount: 1,            // 1 SOL
 *   tokenDecimals: 9,        // 可选，默认 9
 *   lockLiquidity: false,    // 可选，默认 false (不锁定)
 * });
 * ```
 */
export async function createTokenSolPool(
  params: CreatePoolParams
): Promise<CreatePoolResult> {
  const {
    rpcUrl,
    wallet,
    tokenMint,
    configAddress,
    tokenAmount,
    solAmount,
    tokenDecimals = 9,
    lockLiquidity = false, // 默认不锁定，可以随时取出
  } = params;

  // 1. 初始化连接和 SDK
  const connection = new Connection(rpcUrl);
  const cpAmm = new CpAmm(connection);

  // 2. 解析地址
  const tokenAMint = new PublicKey(tokenMint);
  const tokenBMint = NATIVE_MINT; // SOL
  const configPubkey = new PublicKey(configAddress);

  // 3. 获取配置状态
  const configState = await cpAmm.fetchConfigState(configPubkey);

  // 4. 检测 Token 类型 (SPL Token 或 Token 2022)
  const tokenAAccountInfo = await connection.getAccountInfo(tokenAMint);
  if (!tokenAAccountInfo) {
    throw new Error(`Token mint not found: ${tokenMint}`);
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

  // 5. 计算金额 (添加精度)
  const tokenAAmount = new BN(tokenAmount).mul(new BN(10 ** tokenDecimals));
  const tokenBAmount = new BN(Math.floor(solAmount * 10 ** 9));

  // 6. 根据数量自动计算初始价格
  const initialPrice = solAmount / tokenAmount;
  const initSqrtPrice = getSqrtPriceFromPrice(
    initialPrice.toString(),
    tokenDecimals,
    9 // SOL 精度固定为 9
  );

  // 7. 计算流动性
  const liquidityDelta = cpAmm.getLiquidityDelta({
    maxAmountTokenA: tokenAAmount,
    maxAmountTokenB: tokenBAmount,
    sqrtPrice: initSqrtPrice,
    sqrtMinPrice: configState.sqrtMinPrice,
    sqrtMaxPrice: configState.sqrtMaxPrice,
    tokenAInfo,
  });

  // 8. 生成头寸 NFT keypair
  const positionNft = Keypair.generate();

  // 9. 打印信息
  console.log("Creating pool...");
  console.log(`  Token: ${tokenAMint.toBase58()}`);
  console.log(`  SOL: ${tokenBMint.toBase58()}`);
  console.log(`  Token Amount: ${tokenAmount}`);
  console.log(`  SOL Amount: ${solAmount}`);
  console.log(`  Initial Price: 1 Token = ${initialPrice} SOL`);
  console.log(`  Lock Liquidity: ${lockLiquidity}`);

  // 10. 创建池子交易
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
    isLockLiquidity: lockLiquidity,
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

  console.log("\nPool created successfully!");
  console.log(`  Pool: ${poolAddress.toBase58()}`);
  console.log(`  Position: ${positionAddress.toBase58()}`);
  console.log(`  Position NFT: ${positionNft.publicKey.toBase58()}`);
  console.log(`  Signature: ${signature}`);

  return {
    pool: poolAddress.toBase58(),
    position: positionAddress.toBase58(),
    positionNft: positionNft.publicKey.toBase58(),
    positionNftKeypair: positionNft,
    signature,
  };
}

// ============================================
// 使用示例
// ============================================

async function main() {
  // 加载钱包
  const keypairPath = "~/.config/solana/id.json";
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(require(keypairPath))
  );

  // 创建池子
  const result = await createTokenSolPool({
    rpcUrl: clusterApiUrl("devnet"),
    wallet: wallet,
    tokenMint: "YOUR_TOKEN_MINT_ADDRESS", // 替换为你的代币地址
    configAddress: "8CNy9goNQNLM4wtgRw528tUQGMKD3vSuFRZY2gLGLLvF", // Devnet config
    tokenAmount: 1_000_000, // 100万个代币
    solAmount: 1,           // 1 SOL
    tokenDecimals: 9,       // Token 精度
    lockLiquidity: false,   // 不锁定，可以随时取出流动性
  });

  console.log("\nResult:", result);

  // 重要：保存 positionNftKeypair 的私钥，后续取出流动性需要用到
  console.log("\n⚠️  请保存 Position NFT 私钥 (用于后续取出流动性):");
  console.log(JSON.stringify(Array.from(result.positionNftKeypair.secretKey)));
}

// 如果直接运行此文件
if (require.main === module) {
  main().catch(console.error);
}
