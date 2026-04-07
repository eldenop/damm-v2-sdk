import { BN } from "@coral-xyz/anchor";
import { BASIS_POINT_MAX, LIQUIDITY_SCALE } from "../constants";
import Decimal from "decimal.js";
import { PoolState, PositionState, RewardInfo, SwapMode } from "../types";

/**
 * It takes an amount and a slippage rate, and returns the maximum amount that can be received with
 * that slippage rate
 * @param {BN} amount - The amount of tokens you want to buy.
 * @param {number} rate - The maximum percentage of slippage you're willing to accept. (Max to 2 decimal place)
 * @returns The maximum amount of tokens that can be bought with the given amount of ETH, given the
 * slippage rate.
 */
export const getMaxAmountWithSlippage = (amount: BN, rate: number) => {
  const slippage = ((100 + rate) / 100) * BASIS_POINT_MAX;
  return amount.mul(new BN(slippage)).div(new BN(BASIS_POINT_MAX));
};

/**
 * Calculates minimum amount out or maximum amount in based on slippage and swap mode.
 * For ExactIn/PartialFill: returns minimum amount out.
 * For ExactOut: returns maximum amount in.
 *
 * @param {BN} amount - The base amount (outputAmount for ExactIn/PartialFill, includedFeeInputAmount for ExactOut)
 * @param {number} slippageBps - Slippage in basis points (1% = 100)
 * @param {SwapMode} swapMode - Swap mode (ExactIn, PartialFill, ExactOut)
 * @returns {BN} - Minimum amount out (for ExactIn/PartialFill) or maximum amount in (for ExactOut)
 */
export const getAmountWithSlippage = (
  amount: BN,
  slippageBps: number,
  swapMode: SwapMode
): BN => {
  let result: BN;

  if (slippageBps > 0) {
    if (swapMode === SwapMode.ExactOut) {
      // maximum amount in: amount * (10000 + slippageBps) / 10000
      const slippageFactor = new BN(BASIS_POINT_MAX + slippageBps);
      result = amount.mul(slippageFactor).div(new BN(BASIS_POINT_MAX));
    } else {
      // minimum amount out: amount * (10000 - slippageBps) / 10000
      const slippageFactor = new BN(BASIS_POINT_MAX - slippageBps);
      result = amount.mul(slippageFactor).div(new BN(BASIS_POINT_MAX));
    }
  } else {
    result = amount;
  }

  return result;
};

/**
 * Calculate price impact as a percentage
 * Price impact measures how much worse the user's execution was compared to the current market price
 * @param amountIn - Input amount (in base units)
 * @param amountOut - Output amount (in base units)
 * @param currentSqrtPrice - Current pool sqrt price (spot price)
 * @param aToB - Direction of swap: true for token A to token B, false for token B to token A
 * @param tokenADecimal - Decimal places for token A
 * @param tokenBDecimal - Decimal places for token B
 * @returns Price impact as a percentage (e.g., 1.5 means 1.5% worse than spot price)
 */
export const getPriceImpact = (
  amountIn: BN,
  amountOut: BN,
  currentSqrtPrice: BN,
  aToB: boolean,
  tokenADecimal: number,
  tokenBDecimal: number
): Decimal => {
  if (amountIn.eq(new BN(0))) {
    return new Decimal(0);
  }
  if (amountOut.eq(new BN(0))) {
    throw new Error("Amount out must be greater than 0");
  }

  // spot price: (sqrtPrice)^2 * 10^(base_decimal - quote_decimal) / 2^128
  const spotPrice = getPriceFromSqrtPrice(
    currentSqrtPrice,
    tokenADecimal,
    tokenBDecimal
  );

  // execution price: amountIn / amountOut
  const executionPrice = new Decimal(amountIn.toString())
    .div(new Decimal(amountOut.toString()))
    .mul(
      Decimal.pow(
        10,
        aToB ? tokenBDecimal - tokenADecimal : tokenADecimal - tokenBDecimal
      )
    );

  let priceImpact: Decimal;
  let actualExecutionPrice: Decimal;
  if (aToB) {
    actualExecutionPrice = new Decimal(1).div(executionPrice);
  } else {
    actualExecutionPrice = executionPrice;
  }

  // price impact = abs(execution_price - spot_price) / spot_price * 100%
  priceImpact = actualExecutionPrice
    .sub(spotPrice)
    .abs()
    .div(spotPrice)
    .mul(100);

  return priceImpact;
};

/**
 * Calculate price change as a percentage (old implementation)
 * This measures the percentage change in pool price after a swap
 * @param nextSqrtPrice sqrt price after swap
 * @param currentSqrtPrice current pool sqrt price
 * @returns Price change as a percentage (e.g., 1.5 means 1.5% change)
 */
export const getPriceChange = (
  nextSqrtPrice: BN,
  currentSqrtPrice: BN
): number => {
  // price = (sqrtPrice)^2 * 10 ** (base_decimal - quote_decimal) / 2^128
  // k = 10^(base_decimal - quote_decimal) / 2^128
  // priceA = (sqrtPriceA)^2 * k
  // priceB = (sqrtPriceB)^2 * k
  // => price_change = k * abs ( (sqrtPriceA)^2 - (sqrtPriceB)^2  )  * 100 /  (sqrtPriceB)^2 * k
  // => price_change = abs ( (sqrtPriceA)^2 - (sqrtPriceB)^2  )  * 100 / (sqrtPriceB)^2
  const diff = nextSqrtPrice
    .pow(new BN(2))
    .sub(currentSqrtPrice.pow(new BN(2)))
    .abs();

  return new Decimal(diff.toString())
    .div(new Decimal(currentSqrtPrice.pow(new BN(2)).toString()))
    .mul(100)
    .toNumber();
};

/**
 * Converts a sqrt price to a price
 * (sqrtPrice)^2 * 10 ** (base_decimal - quote_decimal) / 2^128
 * @param sqrtPrice - The sqrt price
 * @param tokenADecimal - The token A decimal
 * @param tokenBDecimal - The token B decimal
 * @returns The price
 */
export const getPriceFromSqrtPrice = (
  sqrtPrice: BN,
  tokenADecimal: number,
  tokenBDecimal: number
): Decimal => {
  const decimalSqrtPrice = new Decimal(sqrtPrice.toString());
  const price = decimalSqrtPrice
    .mul(decimalSqrtPrice)
    .mul(new Decimal(10 ** (tokenADecimal - tokenBDecimal)))
    .div(Decimal.pow(2, 128));

  return price;
};

/**
 * Converts a price to a sqrt price
 * sqrt(price / 10^(tokenADecimal - tokenBDecimal)) * 2^64
 * @param price - The price
 * @param tokenADecimal - The token A decimal
 * @param tokenBDecimal - The token B decimal
 * @returns The sqrt price
 */
export const getSqrtPriceFromPrice = (
  price: string,
  tokenADecimal: number,
  tokenBDecimal: number
): BN => {
  const decimalPrice = new Decimal(price);

  const adjustedByDecimals = decimalPrice.div(
    new Decimal(10 ** (tokenADecimal - tokenBDecimal))
  );

  const sqrtValue = Decimal.sqrt(adjustedByDecimals);

  const sqrtValueQ64 = sqrtValue.mul(Decimal.pow(2, 64));

  return new BN(sqrtValueQ64.floor().toFixed());
};

/**
 * 根据 token/SOL 池和 SOL/USDC 池计算 token 的 USD 价格。
 *
 * 计算流程：
 *   1. tokenPriceInSOL  = getPriceFromSqrtPrice(tokenSolPool.sqrtPrice, tokenDecimal, SOL_DECIMAL)
 *      → 每个 token 对应多少 SOL（tokenB / tokenA）
 *   2. solPriceInUSD    = getPriceFromSqrtPrice(solUsdcPool.sqrtPrice, SOL_DECIMAL, USDC_DECIMAL)
 *      → 每个 SOL 对应多少 USDC
 *   3. tokenPriceInUSD  = tokenPriceInSOL × solPriceInUSD
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

// SOL 价格缓存有效期：10 分钟
const SOL_PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * 创建一个带缓存的 SOL 价格获取器，最多每 10 分钟刷新一次链上数据。
 *
 * 使用示例：
 *   const getSolPrice = createSolPriceCache(async () => {
 *     const pool = await cpAmm.program.account.pool.fetch(solUsdcPoolAddress);
 *     return getPriceFromSqrtPrice(pool.sqrtPrice, SOL_DECIMAL, USDC_DECIMAL);
 *   });
 *
 *   const solPrice = await getSolPrice(); // 首次调用时拉取链上数据，10 分钟内直接返回缓存
 *
 * @param fetcher - 返回当前 SOL/USD 价格的异步函数（由调用方提供，可换成任意数据源）
 * @returns 带缓存的价格获取函数
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
 * @param tokenSolPoolSqrtPrice - token/SOL 池的 sqrtPrice（tokenA = 目标token，tokenB = SOL）
 * @param tokenDecimal          - 目标 token 的精度
 * @param solDecimal            - SOL 的精度（通常为 9）
 * @param getCachedSolPrice     - 由 createSolPriceCache() 创建的缓存获取函数
 * @returns token 的 USD 价格（Decimal 类型）
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

// fee = totalLiquidity * feePerTokenStore
// precision: (totalLiquidity * feePerTokenStore) >> 128
/**
 * Gets the unclaimed reward
 * fee = totalLiquidity * feePerTokenStore
 * precision: (totalLiquidity * feePerTokenStore) >> 128
 * @param poolState - The pool state
 * @param positionState - The position state
 * @returns The unclaimed reward
 */
export const getUnClaimLpFee = (
  poolState: PoolState,
  positionState: PositionState
): {
  feeTokenA: BN;
  feeTokenB: BN;
  rewards: BN[];
} => {
  const totalPositionLiquidity = positionState.unlockedLiquidity
    .add(positionState.vestedLiquidity)
    .add(positionState.permanentLockedLiquidity);

  const feeAPerTokenStored = new BN(
    Buffer.from(poolState.feeAPerLiquidity).reverse()
  ).sub(new BN(Buffer.from(positionState.feeAPerTokenCheckpoint).reverse()));

  const feeBPerTokenStored = new BN(
    Buffer.from(poolState.feeBPerLiquidity).reverse()
  ).sub(new BN(Buffer.from(positionState.feeBPerTokenCheckpoint).reverse()));

  const feeA = totalPositionLiquidity
    .mul(feeAPerTokenStored)
    .shrn(LIQUIDITY_SCALE);
  const feeB = totalPositionLiquidity
    .mul(feeBPerTokenStored)
    .shrn(LIQUIDITY_SCALE);

  return {
    feeTokenA: positionState.feeAPending.add(feeA),
    feeTokenB: positionState.feeBPending.add(feeB),
    rewards:
      positionState.rewardInfos.length > 0
        ? positionState.rewardInfos.map((item) => item.rewardPendings)
        : [],
  };
};

// update reward_per_token_store
// refer this implementation in program: https://github.com/MeteoraAg/damm-v2/blob/689a3264484799d833c505523f4ff4e4990690aa/programs/cp-amm/src/state/pool.rs#L315
function getRewardPerTokenStore(
  poolReward: RewardInfo,
  poolLiquidity: BN,
  currentTime: BN
): BN {
  if (poolLiquidity.eq(new BN(0))) {
    return new BN(0);
  }
  const lastTimeRewardApplicable = BN.min(
    currentTime,
    poolReward.rewardDurationEnd
  );

  const timePeriod = lastTimeRewardApplicable.sub(poolReward.lastUpdateTime);
  const currentTotalReward = timePeriod.mul(poolReward.rewardRate);
  const rewardPerTokenStore = currentTotalReward.shln(128).div(poolLiquidity);

  const totalRewardPerTokenStore = new BN(
    Buffer.from(poolReward.rewardPerTokenStored).reverse()
  ).add(rewardPerTokenStore);

  return totalRewardPerTokenStore;
}

function getRewardPerPeriod(
  poolReward: RewardInfo,
  currentTime: BN,
  periodTime: BN
): BN {
  const timeRewardAppicable = currentTime.add(periodTime);
  // cap max period in reward duration end
  const period =
    timeRewardAppicable <= poolReward.rewardDurationEnd
      ? periodTime
      : poolReward.rewardDurationEnd.sub(currentTime);
  // reward_rate = amount / periodTime
  const rewardPerPeriod = poolReward.rewardRate.mul(period);

  return rewardPerPeriod;
}

// get pool reward info
export function getRewardInfo(
  poolState: PoolState,
  rewardIndex: number,
  periodTime: BN,
  currentTime: BN
): {
  rewardPerPeriod: BN;
  rewardBalance: BN;
  totalRewardDistributed: BN;
} {
  const poolReward = poolState.rewardInfos[rewardIndex];

  const rewardPerTokenStore = getRewardPerTokenStore(
    poolReward,
    poolState.liquidity,
    currentTime
  );

  // calculate current reward distributed to user reward.
  const totalRewardDistributed = rewardPerTokenStore
    .mul(poolState.liquidity)
    .shrn(192);

  if (poolReward.rewardDurationEnd <= currentTime) {
    return {
      rewardPerPeriod: new BN(0),
      rewardBalance: new BN(0),
      totalRewardDistributed,
    };
  }

  const rewardPerPeriod = getRewardPerPeriod(
    poolReward,
    currentTime,
    periodTime
  );

  const remainTime = poolReward.rewardDurationEnd.sub(currentTime);
  const rewardBalance = poolReward.rewardRate.mul(remainTime).shrn(64);

  if (poolState.liquidity.eq(new BN(0))) {
    return {
      rewardPerPeriod,
      rewardBalance,
      totalRewardDistributed: new BN(0),
    };
  }

  return {
    rewardPerPeriod: rewardPerPeriod.shrn(64),
    rewardBalance,
    totalRewardDistributed,
  };
}

// get current pending user reward
// refer to this implementation: https://github.com/MeteoraAg/damm-v2/blob/689a3264484799d833c505523f4ff4e4990690aa/programs/cp-amm/src/state/position.rs#L29
export function getUserRewardPending(
  poolState: PoolState,
  positionState: PositionState,
  rewardIndex: number,
  currentTime: BN,
  periodTime: BN
): { userRewardPerPeriod: BN; userPendingReward: BN } {
  if (poolState.liquidity.eq(new BN(0))) {
    return {
      userRewardPerPeriod: new BN(0),
      userPendingReward: new BN(0),
    };
  }
  const poolReward = poolState.rewardInfos[rewardIndex];
  const userRewardInfo = positionState.rewardInfos[rewardIndex];

  const rewardPerTokenStore = getRewardPerTokenStore(
    poolReward,
    poolState.liquidity,
    currentTime
  );

  const totalPositionLiquidity = positionState.unlockedLiquidity
    .add(positionState.vestedLiquidity)
    .add(positionState.permanentLockedLiquidity);

  const userRewardPerTokenCheckPoint = new BN(
    Buffer.from(userRewardInfo.rewardPerTokenCheckpoint).reverse()
  );
  const newReward = totalPositionLiquidity
    .mul(rewardPerTokenStore.sub(userRewardPerTokenCheckPoint))
    .shrn(192);

  if (poolReward.rewardDurationEnd <= currentTime) {
    return {
      userPendingReward: userRewardInfo.rewardPendings.add(newReward),
      userRewardPerPeriod: new BN(0),
    };
  }

  const rewardPerPeriod = getRewardPerPeriod(
    poolReward,
    currentTime,
    periodTime
  );

  const rewardPerTokenStorePerPeriod = rewardPerPeriod
    .shln(128)
    .div(poolState.liquidity);
  const userRewardPerPeriod = totalPositionLiquidity
    .mul(rewardPerTokenStorePerPeriod)
    .shrn(192);

  return {
    userPendingReward: userRewardInfo.rewardPendings.add(newReward),
    userRewardPerPeriod: userRewardPerPeriod,
  };
}
