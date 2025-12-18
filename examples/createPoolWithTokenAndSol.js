/**
 * 简单封装：使用 Token 和 SOL 创建流动性池
 *
 * 使用: node examples/createPoolWithTokenAndSol.js
 */

const { Connection, Keypair, PublicKey, sendAndConfirmTransaction } = require("@solana/web3.js");
const { BN } = require("@coral-xyz/anchor");
const { CpAmm, derivePoolAddress, derivePositionAddress, getSqrtPriceFromPrice } = require("../dist");
const { getMint, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = require("@solana/spl-token");

/**
 * 创建 Token + SOL 流动性池
 *
 * @param {string} rpcUrl - RPC 地址
 * @param {Keypair} wallet - 钱包 Keypair
 * @param {string} tokenMint - Token mint 地址
 * @param {string} configAddress - 配置地址
 * @param {number} tokenAmount - Token 数量 (不含精度)
 * @param {number} solAmount - SOL 数量
 * @param {number} tokenDecimals - Token 精度，默认 9
 * @param {boolean} lockLiquidity - 是否锁定流动性，默认 false
 */
async function createTokenSolPool(
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

module.exports = { createTokenSolPool };

// ============================================
// 使用示例
// ============================================
async function main() {
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(require("~/.config/solana/id.json"))
  );

  const result = await createTokenSolPool(
    "https://api.devnet.solana.com",     // RPC
    wallet,                               // 钱包
    "YOUR_TOKEN_MINT_ADDRESS",            // Token 地址
    "8CNy9goNQNLM4wtgRw528tUQGMKD3vSuFRZY2gLGLLvF",  // Devnet config
    1_000_000,                            // Token 数量
    1,                                    // SOL 数量
    9,                                    // Token 精度
    false                                 // 不锁定
  );

  console.log("Result:", result);

  // 保存私钥用于后续取出流动性
  console.log("\nPosition NFT 私钥 (请保存):");
  console.log(JSON.stringify(Array.from(result.positionNftKeypair.secretKey)));
}

if (require.main === module) {
  main().catch(console.error);
}
