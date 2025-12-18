/**
 * 简单封装：使用 Token 和 SOL 创建流动性池（支持自定义费率）
 */

import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  CpAmm,
  ActivationType,
  BaseFeeMode,
  getBaseFeeParams,
  getSqrtPriceFromPrice,
  MIN_SQRT_PRICE,
  MAX_SQRT_PRICE,
  derivePoolAddress,
  deriveCustomizablePoolAddress,
  derivePositionAddress,
} from "../dist/index.js";
import { getMint, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

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
 * 创建 Token + SOL 流动性池（使用 config，费率由 config 决定）
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

  const configState = await cpAmm.fetchConfigState(configPubkey);

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

  const tokenAAmount = new BN(tokenAmount).mul(new BN(10 ** tokenDecimals));
  const tokenBAmount = new BN(Math.floor(solAmount * 1e9));

  const initialPrice = solAmount / tokenAmount;
  const initSqrtPrice = getSqrtPriceFromPrice(initialPrice.toString(), tokenDecimals, 9);

  const liquidityDelta = cpAmm.getLiquidityDelta({
    maxAmountTokenA: tokenAAmount,
    maxAmountTokenB: tokenBAmount,
    sqrtPrice: initSqrtPrice,
    sqrtMinPrice: configState.sqrtMinPrice,
    sqrtMaxPrice: configState.sqrtMaxPrice,
    tokenAInfo,
  });

  const positionNft = Keypair.generate();

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

  return {
    pool,
    position,
    positionNft: positionNft.publicKey.toBase58(),
    positionNftKeypair: positionNft,
    signature,
  };
}

/**
 * 创建自定义费率的 Token + SOL 池子
 *
 * @param feeBps - 费率，单位 bps。25 = 0.25%，100 = 1%
 */
export async function createCustomFeePool(
  rpcUrl,
  wallet,
  tokenMint,
  tokenAmount,
  solAmount,
  tokenDecimals = 9,
  feeBps = 25,
  lockLiquidity = false
) {
  const connection = new Connection(rpcUrl);
  const cpAmm = new CpAmm(connection);

  const tokenAMint = new PublicKey(tokenMint);
  const tokenBMint = NATIVE_MINT;

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

  const tokenAAmount = new BN(tokenAmount).mul(new BN(10 ** tokenDecimals));
  const tokenBAmount = new BN(Math.floor(solAmount * 1e9));

  const initialPrice = solAmount / tokenAmount;
  const initSqrtPrice = getSqrtPriceFromPrice(initialPrice.toString(), tokenDecimals, 9);

  const liquidityDelta = cpAmm.getLiquidityDelta({
    maxAmountTokenA: tokenAAmount,
    maxAmountTokenB: tokenBAmount,
    sqrtPrice: initSqrtPrice,
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    tokenAInfo,
  });

  // 固定费率设置
  const baseFeeParams = getBaseFeeParams(
    {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: {
        startingFeeBps: feeBps,
        endingFeeBps: feeBps,
        numberOfPeriod: 1,
        totalDuration: 1,
      },
    },
    9,
    ActivationType.Timestamp
  );

  const poolFees = {
    baseFee: baseFeeParams,
    padding: [],
    dynamicFee: null,
  };

  const positionNft = Keypair.generate();

  const { tx, pool, position } = await cpAmm.createCustomPool({
    payer: wallet.publicKey,
    creator: wallet.publicKey,
    positionNft: positionNft.publicKey,
    tokenAMint,
    tokenBMint,
    tokenAAmount,
    tokenBAmount,
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    liquidityDelta,
    initSqrtPrice,
    poolFees,
    hasAlphaVault: false,
    activationType: ActivationType.Timestamp,
    collectFeeMode: 0,
    activationPoint: null,
    tokenAProgram,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: lockLiquidity,
  });

  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = wallet.publicKey;

  const signature = await sendAndConfirmTransaction(connection, tx, [wallet, positionNft], {
    commitment: "confirmed",
  });

  return {
    pool: pool.toBase58(),
    position: position.toBase58(),
    positionNft: positionNft.publicKey.toBase58(),
    positionNftKeypair: positionNft,
    signature,
  };
}
