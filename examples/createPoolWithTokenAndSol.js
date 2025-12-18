/**
 * 简单封装：使用 Token 和 SOL 创建流动性池
 *
 * 使用: node examples/createPoolWithTokenAndSol.js
 */

import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { CpAmm, derivePoolAddress, derivePositionAddress, getSqrtPriceFromPrice } from "../dist/index.js";
import { getMint, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * 获取第一个可用的配置地址
 */
export async function getDefaultConfig(rpcUrl) {
  const connection = new Connection(rpcUrl);
  const cpAmm = new CpAmm(connection);
  const configs = await cpAmm.getAllConfigs();

  if (configs.length === 0) {
    throw new Error("No config found");
  }

  console.log(`Found ${configs.length} configs, using first one`);
  return configs[0].publicKey.toBase58();
}

/**
 * 获取所有配置地址
 */
export async function getAllConfigs(rpcUrl) {
  const connection = new Connection(rpcUrl);
  const cpAmm = new CpAmm(connection);
  const configs = await cpAmm.getAllConfigs();

  return configs.map((c, i) => ({
    index: i,
    address: c.publicKey.toBase58(),
    sqrtMinPrice: c.account.sqrtMinPrice.toString(),
    sqrtMaxPrice: c.account.sqrtMaxPrice.toString(),
  }));
}

/**
 * 创建 Token + SOL 流动性池
 */
export async function createTokenSolPool(
  rpcUrl,
  wallet,
  tokenMint,
  configAddress,
  tokenAmount,
  solAmount,
  tokenDecimals = 9,
  lockLiquidity = false
) {
  const connection = new Connection(rpcUrl);
  const cpAmm = new CpAmm(connection);

  const tokenAMint = new PublicKey(tokenMint);
  const tokenBMint = NATIVE_MINT;
  const configPubkey = new PublicKey(configAddress);

  // 获取配置
  const configState = await cpAmm.fetchConfigState(configPubkey);

  // 检测 Token 类型
  const tokenAAccountInfo = await connection.getAccountInfo(tokenAMint);
  if (!tokenAAccountInfo) {
    throw new Error(`Token mint not found: ${tokenMint}`);
  }

  let tokenAProgram = TOKEN_PROGRAM_ID;
  let tokenAInfo = undefined;

  if (tokenAAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    tokenAProgram = TOKEN_2022_PROGRAM_ID;
    const baseMint = await getMint(connection, tokenAMint, connection.commitment, tokenAProgram);
    const epochInfo = await connection.getEpochInfo();
    tokenAInfo = { mint: baseMint, currentEpoch: epochInfo.epoch };
  }

  // 计算金额
  const tokenAAmount = new BN(tokenAmount).mul(new BN(10 ** tokenDecimals));
  const tokenBAmount = new BN(Math.floor(solAmount * 1e9));

  // 计算价格
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

  console.log("Creating pool...");
  console.log(`  Token: ${tokenAMint.toBase58()}`);
  console.log(`  Token Amount: ${tokenAmount}`);
  console.log(`  SOL Amount: ${solAmount}`);
  console.log(`  Price: 1 Token = ${initialPrice} SOL`);
  console.log(`  Lock: ${lockLiquidity}`);

  const tx = await cpAmm.createPool({
    payer: wallet.publicKey,
    creator: wallet.publicKey,
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
    isLockLiquidity: lockLiquidity,
  });

  const signature = await sendAndConfirmTransaction(connection, tx, [wallet, positionNft], {
    commitment: "confirmed",
  });

  const pool = derivePoolAddress(configPubkey, tokenAMint, tokenBMint).toBase58();
  const position = derivePositionAddress(positionNft.publicKey).toBase58();

  console.log("\nPool created!");
  console.log(`  Pool: ${pool}`);
  console.log(`  Position: ${position}`);
  console.log(`  Signature: ${signature}`);

  return {
    pool,
    position,
    positionNft: positionNft.publicKey.toBase58(),
    positionNftKeypair: positionNft,
    signature,
  };
}
