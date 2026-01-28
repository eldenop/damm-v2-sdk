import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  ActivationType,
  BaseFeeMode,
  CpAmm,
  getBaseFeeParams,
  getSqrtPriceFromPrice,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  deriveCustomizablePoolAddress,
  derivePositionNftAccount,
  getTokenProgram,
} from "../src";
import {
  getMint,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

/**
 * Creates a custom fee pool with initial liquidity, or adds liquidity to an
 * existing pool if one already exists for the SOL/<token> pair.
 *
 * @returns pool address, position, NFT info, and transaction signature
 */
export async function createPoolOrAddLiquidity(
  rpcUrl: string,
  wallet: Keypair,
  tokenMint: string,
  tokenAmount: number,
  solAmount: number,
  tokenDecimals: number = 6,
  feeBps: number = 1,
  lockLiquidity: boolean = false
) {
  const connection = new Connection(rpcUrl);
  const cpAmm = new CpAmm(connection);

  const tokenAMint = NATIVE_MINT; // SOL
  const tokenBMint = new PublicKey(tokenMint); // Token

  // Validate token B mint exists and determine its program
  const tokenBAccountInfo = await connection.getAccountInfo(tokenBMint);
  if (!tokenBAccountInfo) {
    throw new Error(`Token mint not found: ${tokenMint}`);
  }

  let tokenBProgram = TOKEN_PROGRAM_ID;
  let tokenBInfo: { mint: Awaited<ReturnType<typeof getMint>>; currentEpoch: number } | undefined;

  if (tokenBAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    tokenBProgram = TOKEN_2022_PROGRAM_ID;
    const baseMint = await getMint(connection, tokenBMint, connection.commitment, tokenBProgram);
    const epochInfo = await connection.getEpochInfo();
    tokenBInfo = { mint: baseMint, currentEpoch: epochInfo.epoch };
  }

  const tokenAAmount = new BN(Math.floor(solAmount * 1e9));
  const tokenBAmount = new BN(tokenAmount).mul(new BN(10 ** tokenDecimals));

  // Check if pool already exists
  const poolAddress = deriveCustomizablePoolAddress(tokenAMint, tokenBMint);
  const poolExists = await cpAmm.isPoolExist(poolAddress);

  if (poolExists) {
    // --- Pool exists: create a new position and add liquidity ---
    return addLiquidityToExistingPool(
      connection,
      cpAmm,
      wallet,
      poolAddress,
      tokenAMint,
      tokenBMint,
      tokenAAmount,
      tokenBAmount,
      tokenBProgram,
      tokenBInfo,
    );
  }

  // --- Pool does not exist: create pool with initial liquidity ---
  return createNewPool(
    connection,
    cpAmm,
    wallet,
    tokenAMint,
    tokenBMint,
    tokenAAmount,
    tokenBAmount,
    tokenDecimals,
    tokenAmount,
    solAmount,
    feeBps,
    lockLiquidity,
    tokenBProgram,
    tokenBInfo,
  );
}

/**
 * Adds liquidity to an existing pool by creating a new position.
 */
async function addLiquidityToExistingPool(
  connection: Connection,
  cpAmm: CpAmm,
  wallet: Keypair,
  poolAddress: PublicKey,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  tokenAAmount: BN,
  tokenBAmount: BN,
  tokenBProgram: PublicKey,
  tokenBInfo?: { mint: Awaited<ReturnType<typeof getMint>>; currentEpoch: number },
) {
  const poolState = await cpAmm.fetchPoolState(poolAddress);

  // Calculate liquidity delta from SOL (token A) input amount
  const depositQuote = cpAmm.getDepositQuote({
    inAmount: tokenAAmount,
    isTokenA: true,
    sqrtPrice: poolState.sqrtPrice,
    minSqrtPrice: poolState.sqrtMinPrice,
    maxSqrtPrice: poolState.sqrtMaxPrice,
    inputTokenInfo: undefined,
    outputTokenInfo: tokenBInfo,
  });

  const positionNft = Keypair.generate();

  const tx = await cpAmm.createPositionAndAddLiquidity({
    owner: wallet.publicKey,
    pool: poolAddress,
    positionNft: positionNft.publicKey,
    liquidityDelta: depositQuote.liquidityDelta,
    maxAmountTokenA: tokenAAmount,
    maxAmountTokenB: tokenBAmount,
    tokenAAmountThreshold: new BN(0),
    tokenBAmountThreshold: new BN(0),
    tokenAMint,
    tokenBMint,
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram,
  });

  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = wallet.publicKey;

  const signature = await sendAndConfirmTransaction(connection, tx, [wallet, positionNft], {
    commitment: "confirmed",
  });

  const position = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), positionNft.publicKey.toBuffer()],
    cpAmm._program.programId
  )[0];

  return {
    pool: poolAddress.toBase58(),
    position: position.toBase58(),
    positionNft: positionNft.publicKey.toBase58(),
    positionNftKeypair: positionNft,
    signature,
    isNewPool: false,
  };
}

/**
 * Creates a new custom fee pool with initial liquidity.
 */
async function createNewPool(
  connection: Connection,
  cpAmm: CpAmm,
  wallet: Keypair,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  tokenAAmount: BN,
  tokenBAmount: BN,
  tokenDecimals: number,
  tokenAmount: number,
  solAmount: number,
  feeBps: number,
  lockLiquidity: boolean,
  tokenBProgram: PublicKey,
  tokenBInfo?: { mint: Awaited<ReturnType<typeof getMint>>; currentEpoch: number },
) {
  const initialPrice = tokenAmount / solAmount;
  const initSqrtPrice = getSqrtPriceFromPrice(initialPrice.toString(), 9, tokenDecimals);

  const liquidityDelta = cpAmm.getLiquidityDelta({
    maxAmountTokenA: tokenAAmount,
    maxAmountTokenB: tokenBAmount,
    sqrtPrice: initSqrtPrice,
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    tokenBInfo,
  });

  const baseFeeParams = getBaseFeeParams(
    {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: {
        startingFeeBps: feeBps,
        endingFeeBps: feeBps,
        numberOfPeriod: 0,
        totalDuration: 0,
      },
    },
    tokenDecimals,
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
    collectFeeMode: 1,
    activationPoint: null,
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram,
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
    isNewPool: true,
  };
}
