# CLAUDE.md - AI Assistant Guide for DAMM V2 SDK

This guide provides AI assistants with comprehensive information about the Meteora DAMM V2 SDK codebase structure, development workflows, and key conventions.

## Project Overview

**Name**: Meteora Constant Product AMM SDK (DAMM V2 SDK)
**Package**: `@meteora-ag/cp-amm-sdk`
**Version**: 1.2.3
**Description**: A TypeScript SDK for interacting with the Meteora Dynamic AMM (DAMM) V2 on the Solana blockchain.

### Core Purpose
This SDK simplifies interactions with the DAMM V2 protocol, enabling developers to:
- Create and manage liquidity pools
- Add/remove liquidity to positions
- Perform token swaps
- Manage position locking and vesting
- Claim fees and rewards
- Handle both SPL Token and Token-2022 programs

### Key Technologies
- **Blockchain**: Solana
- **Language**: TypeScript (strict mode)
- **Framework**: Anchor v0.31.0
- **Web3**: @solana/web3.js v1.95.3
- **Token Support**: Both SPL Token and Token-2022
- **Math**: BN.js (big numbers), Decimal.js
- **Build**: tsup (ESM + CJS)
- **Test**: Mocha + ts-mocha + solana-bankrun

### Program ID
- **Mainnet & Devnet**: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`

---

## Repository Structure

```
damm-v2-sdk/
├── src/                          # Main source code
│   ├── CpAmm.ts                  # Main SDK class with all public methods
│   ├── index.ts                  # Package entry point (re-exports)
│   ├── types.ts                  # TypeScript type definitions
│   ├── pda.ts                    # Program Derived Address (PDA) functions
│   ├── constants.ts              # Constants and configuration values
│   ├── helpers/                  # Utility functions
│   │   ├── token.ts              # Token-related helpers
│   │   ├── token2022.ts          # Token-2022 specific helpers
│   │   ├── validation.ts         # Input validation
│   │   ├── vestings.ts           # Vesting calculations
│   │   ├── accountFilters.ts     # Account filtering utilities
│   │   ├── computeUnits.ts       # Compute unit calculations
│   │   ├── utils.ts              # General utilities
│   │   └── common.ts             # Common helper functions
│   ├── math/                     # Mathematical calculations
│   │   ├── curve.ts              # Curve math (constant product)
│   │   ├── quote.ts              # Swap quote calculations
│   │   ├── priceMath.ts          # Price conversion utilities
│   │   ├── feeMath.ts            # Fee calculations
│   │   ├── utilsMath.ts          # Math utility functions
│   │   └── poolFees/             # Fee mechanism implementations
│   │       ├── baseFee.ts        # Base fee calculations
│   │       ├── dynamicFee.ts     # Dynamic fee calculations
│   │       ├── feeScheduler.ts   # Fee scheduling logic
│   │       └── rateLimiter.ts    # Rate limiter logic
│   └── idl/                      # Interface Definition Language
│       ├── cp_amm.ts             # Generated TypeScript IDL
│       └── cp_amm.json           # Raw IDL JSON
├── tests/                        # Test files
│   ├── *.test.ts                 # Individual test files
│   ├── bankrun-utils/            # Testing utilities
│   │   ├── common.ts             # Common test functions
│   │   └── math.ts               # Math testing helpers
│   └── fixtures/                 # Test fixtures
├── examples/                     # Usage examples
│   ├── createPositionAndLock.ts
│   ├── createCustomizablePoolAndLockLiquidity.ts
│   ├── createPoolAndTransferPosition.ts
│   ├── getPositionAndClaimFees.ts
│   └── createPoolAndLockWithConfig.ts
├── docs.md                       # Detailed API documentation
├── README.md                     # User-facing documentation
├── CHANGELOG.md                  # Version history
├── package.json                  # NPM package configuration
├── tsconfig.json                 # TypeScript configuration
├── tsup.config.ts                # Build configuration
└── .github/workflows/ci.yml      # CI/CD configuration
```

---

## Core Architecture

### Main SDK Class: `CpAmm`

The `CpAmm` class (in `src/CpAmm.ts`) is the primary interface for all SDK operations. It's instantiated with a Solana `Connection`:

```typescript
import { Connection } from "@solana/web3.js";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const cpAmm = new CpAmm(connection);
```

### Key Functional Areas

1. **Pool Management**
   - `createPool()` - Create standard pools with predefined configs
   - `createCustomPool()` - Create customizable pools
   - `createCustomPoolWithDynamicConfig()` - Create pools with dynamic fee configuration
   - `fetchPoolState()` - Get pool state
   - `getAllPools()` - Fetch all pools

2. **Position Management**
   - `createPosition()` - Create a new position
   - `createPositionAndAddLiquidity()` - Combined operation
   - `lockPosition()` - Lock liquidity with vesting
   - `permanentLockPosition()` - Permanently lock position
   - `splitPosition()` / `splitPosition2()` - Split positions
   - `mergePosition()` - Merge positions
   - `closePosition()` - Close empty positions

3. **Liquidity Operations**
   - `addLiquidity()` - Add liquidity to position
   - `removeLiquidity()` - Remove partial liquidity
   - `removeAllLiquidity()` - Remove all liquidity
   - `removeAllLiquidityAndClosePosition()` - Combined operation
   - `getLiquidityDelta()` - Calculate liquidity changes
   - `getDepositQuote()` - Get deposit quotes
   - `getWithdrawQuote()` - Get withdrawal quotes

4. **Swap Operations**
   - `swap()` - Perform token swaps
   - `getQuote()` - Get swap quotes

5. **Fee & Reward Management**
   - `claimPositionFee()` / `claimPositionFee2()` - Claim LP fees
   - `claimPartnerFee()` - Claim partner fees
   - `initializeReward()` - Initialize reward pool
   - `fundReward()` - Fund reward pool
   - `claimReward()` - Claim rewards
   - `updateRewardDuration()` - Update reward duration
   - `updateRewardFunder()` - Update reward funder

### Type System

The SDK uses strict TypeScript with comprehensive type definitions in `src/types.ts`:

- **State Types**: `PoolState`, `PositionState`, `VestingState`, `ConfigState`
- **Enums**: `TradeDirection`, `Rounding`, `SwapMode`, `BaseFeeMode`, `PoolStatus`
- **IDL Types**: Imported from Anchor-generated types
- **Parameter Types**: For all function inputs (e.g., `CreatePoolParams`, `SwapParams`)

### Program Derived Addresses (PDAs)

PDA derivation functions are centralized in `src/pda.ts`:

```typescript
- derivePoolAddress(config, tokenAMint, tokenBMint)
- derivePositionAddress(positionNft)
- deriveTokenVaultAddress(pool, tokenMint)
- deriveRewardVaultAddress(pool, rewardIndex)
- derivePoolAuthority()
```

### Constants

Key constants defined in `src/constants.ts`:
- `CP_AMM_PROGRAM_ID` - Program address
- `MIN_SQRT_PRICE` / `MAX_SQRT_PRICE` - Price bounds
- `FEE_DENOMINATOR` - 1,000,000,000
- `BASIS_POINT_MAX` - 10,000
- `SCALE_OFFSET` - 64 (for Q64 fixed-point math)
- Fee limits, compute unit buffers, etc.

---

## Development Workflows

### Initial Setup

```bash
# Install dependencies (supports npm, yarn, pnpm, bun)
pnpm install

# Or
yarn install

# Or
npm install
```

### Build

```bash
# Build for production (outputs to dist/)
npm run build

# Build in watch mode
npm run start
```

The build configuration (`tsup.config.ts`) produces:
- **ESM**: `dist/index.mjs`
- **CJS**: `dist/index.js`
- **Types**: `dist/index.d.ts`
- Sourcemaps enabled
- No minification

### Testing

```bash
# Run all tests
npm test

# Or with yarn
yarn test
```

Test framework:
- **Test Runner**: Mocha with ts-mocha
- **Test Environment**: solana-bankrun (for simulated Solana runtime)
- **Timeout**: 1,000,000ms (extended for blockchain operations)
- **Test Files**: Located in `tests/*.test.ts`

Test utilities (`tests/bankrun-utils/`):
- `setupTestContext()` - Initialize test environment
- `executeTransaction()` - Execute and confirm transactions
- `startTest()` - Start test context

### Linting & Formatting

```bash
# Check formatting
npm run lint

# Auto-fix formatting
npm run lint:fix
```

Uses Prettier for code formatting.

### Cleaning

```bash
# Remove dist and node_modules
npm run clean
```

### CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):
- **Trigger**: Pull requests to `main` branch
- **Environment**:
  - Node.js 18.20.6
  - Solana CLI 2.1.0
  - Anchor CLI 0.31.0
  - pnpm 9.5.0
- **Jobs**:
  1. Check for changed files in `src/` or `tests/`
  2. If changed, run full test suite
  3. Cache node_modules and Rust dependencies

---

## Code Conventions

### TypeScript Configuration

```json
{
  "strict": true,
  "strictNullChecks": false,  // Note: Disabled
  "target": "es6",
  "module": "commonjs",
  "noImplicitAny": true
}
```

### Naming Conventions

1. **Functions**: camelCase
   - Examples: `createPool`, `getLiquidityDelta`, `fetchPoolState`

2. **Types/Interfaces**: PascalCase
   - Examples: `PoolState`, `CreatePoolParams`, `TradeDirection`

3. **Constants**: UPPER_SNAKE_CASE
   - Examples: `CP_AMM_PROGRAM_ID`, `MIN_SQRT_PRICE`, `FEE_DENOMINATOR`

4. **Enums**: PascalCase for enum name, PascalCase for members
   ```typescript
   enum TradeDirection {
     AtoB,
     BtoA,
   }
   ```

5. **Files**: camelCase or PascalCase
   - Main classes: `CpAmm.ts`
   - Utilities: `token.ts`, `validation.ts`

### Code Organization Patterns

1. **Module Exports**: Each directory has an `index.ts` that re-exports all public APIs
   ```typescript
   // src/helpers/index.ts
   export * from "./token";
   export * from "./validation";
   export * from "./utils";
   ```

2. **Imports Order** (by convention):
   - External dependencies (Anchor, Solana, etc.)
   - Internal IDL/types
   - Internal utilities and helpers
   - Constants

3. **Error Handling**: Uses `invariant` package for assertions
   ```typescript
   import invariant from "invariant";
   invariant(condition, "Error message");
   ```

### BigNumber Handling

**Critical**: Always use `BN` (from bn.js) for numerical operations involving tokens, prices, and liquidity:

```typescript
import BN from "bn.js";

const amount = new BN(1_000_000_000); // 1 token with 9 decimals
const sqrtPrice = new BN("79226673521066979257578248091");
```

**Never use JavaScript numbers for:**
- Token amounts
- Prices (especially sqrt prices in Q64 format)
- Liquidity deltas
- Fee calculations

### Q64 Fixed-Point Math

Prices are stored in Q64 format (64-bit fixed-point):
- Conversion helpers in `src/math/priceMath.ts`:
  - `getSqrtPriceFromPrice(price, decimalsA, decimalsB)`
  - `getPriceFromSqrtPrice(sqrtPrice, decimalsA, decimalsB)`

### Token-2022 Support

When working with Token-2022:
- Always fetch token mint info for transfer fee calculation
- Pass `tokenInfo` objects to functions that support it
- Use helpers in `src/helpers/token2022.ts`:
  - `calculateTransferFeeIncludedAmount()`
  - `calculateTransferFeeExcludedAmount()`

### Transaction Building

All mutation methods return `TxBuilder` (Promise<Transaction>):

```typescript
const tx = await cpAmm.createPool(params);
// tx is a Transaction object ready to sign and send
const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);
```

---

## Key Implementation Details

### Pool Creation Flow

1. **Standard Pool** (`createPool`):
   - Uses predefined config
   - Requires config account reference
   - Automatically creates initial position

2. **Custom Pool** (`createCustomPool`):
   - Allows custom fee parameters
   - Can set price ranges (sqrtMinPrice, sqrtMaxPrice)
   - Supports Alpha Vault integration

3. **Price Calculation**:
   - Use `preparePoolCreationParams()` to calculate `initSqrtPrice` and `liquidityDelta`
   - Use `getDepositQuote()` for accurate token amounts

### Liquidity Math

Located in `src/math/curve.ts`:
- Constant product formula: `x * y = k`
- Liquidity calculations use Q64 fixed-point math
- Supports rounding modes (Up/Down) for precision

### Fee Mechanisms

Three fee modes in `src/math/poolFees/`:

1. **Base Fee** (`baseFee.ts`):
   - Fee Scheduler (Linear/Exponential)
   - Rate Limiter

2. **Dynamic Fee** (`dynamicFee.ts`):
   - Volatility-based fee adjustments
   - Bin step calculations

3. **Fee Scheduler** (`feeScheduler.ts`):
   - Time-based fee reductions
   - Cliff fee with decay

### Vesting System

For locked positions (`src/helpers/vestings.ts`):
- Linear vesting over time
- `getAvailableVestingLiquidity()` - Calculate unlocked liquidity
- `isVestingComplete()` - Check if vesting period ended
- `refreshVesting()` - Update vesting state

### Account Filters

Helper functions for querying (`src/helpers/accountFilters.ts`):
- `positionByPoolFilter()` - Get positions for a pool
- `vestingByPositionFilter()` - Get vestings for a position

---

## Common Patterns & Best Practices

### 1. Fetching Pool State

```typescript
const poolAddress = derivePoolAddress(config, tokenAMint, tokenBMint);
const poolState = await cpAmm.fetchPoolState(poolAddress);
```

### 2. Getting Swap Quote

```typescript
const quote = cpAmm.getQuote({
  inAmount: new BN(1_000_000_000),
  swapInTokenMint: tokenAMint,
  poolState,
  // Optional: inputTokenInfo, outputTokenInfo for Token-2022
});

console.log(`Output: ${quote.outAmount.toString()}`);
console.log(`Price Impact: ${quote.priceImpact}%`);
```

### 3. Calculating Deposit Amounts

```typescript
const { consumedInputAmount, outputAmount, liquidityDelta } = cpAmm.getDepositQuote({
  inAmount: new BN(5_000_000_000),
  isTokenA: true,
  minSqrtPrice: poolState.sqrtMinPrice,
  maxSqrtPrice: poolState.sqrtMaxPrice,
  sqrtPrice: poolState.sqrtPrice,
  // Optional: inputTokenInfo, outputTokenInfo
});
```

### 4. Handling Native SOL

The SDK automatically wraps/unwraps SOL:
- Use `NATIVE_MINT` from `@solana/spl-token` for SOL mint
- SDK handles wSOL wrapping internally
- Always unwrap after operations using `unwrapSOLInstruction()`

### 5. Compute Units

Functions for estimating compute units (`src/helpers/computeUnits.ts`):
- Ensures transactions don't exceed compute limits
- Adds buffer (50k-200k CU) for safety

### 6. Slippage Protection

Helper functions in exports:
- `getMaxAmountWithSlippage(amount, slippageBps)` - For exact-in swaps
- `getMinAmountWithSlippage(amount, slippageBps)` - For exact-out swaps

### 7. Price Impact Calculation

```typescript
const priceImpact = cpAmm.getPriceImpact({
  inAmount,
  outAmount,
  sqrtPrice: poolState.sqrtPrice,
  tokenADecimals,
  tokenBDecimals,
});
```

---

## Testing Guidelines

### Test Structure

Each test file follows this pattern:

```typescript
import { ProgramTestContext } from "solana-bankrun";
import { setupTestContext, startTest, executeTransaction } from "./bankrun-utils/common";

describe("Feature Name", () => {
  describe("SPL token", () => {
    let context: ProgramTestContext;
    let ammInstance: CpAmm;

    beforeEach(async () => {
      context = await startTest();
      const prepareContext = await setupTestContext(/*...*/);
      // Setup...
    });

    it("should do something", async () => {
      // Test implementation
    });
  });

  describe("Token-2022", () => {
    // Similar structure for Token-2022 tests
  });
});
```

### Key Testing Utilities

- `startTest()` - Initialize bankrun context
- `setupTestContext()` - Create test users and tokens
- `executeTransaction()` - Execute and confirm transactions in bankrun

### Test Coverage Areas

1. Pool creation (standard, custom, with config)
2. Position operations (create, lock, split, merge, close)
3. Liquidity operations (add, remove)
4. Swap operations
5. Fee claiming
6. Reward mechanics
7. Token-2022 compatibility
8. Fee calculations

---

## Important Notes for AI Assistants

### When Making Changes

1. **Never modify generated files**: `src/idl/cp_amm.ts` and `src/idl/cp_amm.json` are generated from the Anchor program.

2. **Maintain type safety**: Always update corresponding types in `src/types.ts` when adding new parameters.

3. **Export new functions**: Add to appropriate `index.ts` files for public API exposure.

4. **Update documentation**: If adding features, update `docs.md` with function documentation.

5. **Test both token types**: Ensure changes work for both SPL Token and Token-2022.

6. **Preserve BN usage**: Never replace BN with number types for financial calculations.

7. **Follow existing patterns**: Match the established code style and architecture patterns.

### When Debugging

1. **Check decimal handling**: Ensure token decimals are correctly applied (often 9 for SOL/USDC).

2. **Verify PDA derivation**: Ensure PDAs are derived with correct seeds and program ID.

3. **Inspect sqrt price**: Prices in Q64 format can be very large numbers - use conversion helpers.

4. **Review fee calculations**: Multiple fee mechanisms (base, dynamic, scheduler) interact.

5. **Check account ownership**: Token accounts must have correct owners and programs.

### Common Pitfalls

1. **Sqrt price overflow**: Always use BN for sqrt price calculations.

2. **Token order**: Pool expects tokens in specific order (derived from PDA logic).

3. **Vesting constraints**: Locked positions cannot be closed until vesting completes.

4. **Transfer fees**: Token-2022 transfer fees affect actual amounts received.

5. **Compute limits**: Complex operations may need CU budget adjustments.

### Documentation References

- **API Documentation**: `docs.md` - Comprehensive function reference
- **Examples**: `examples/` directory - Real-world usage patterns
- **Changelog**: `CHANGELOG.md` - Version history and breaking changes
- **Tests**: `tests/` - Behavioral specifications

---

## Version Information

**Current Version**: 1.2.3
**Last Updated**: December 2024
**Anchor Version**: 0.31.0
**Solana Web3.js**: 1.95.3
**Node.js**: 18.20.6+
**TypeScript**: 5.8.2

---

## Additional Resources

- **Main Repository**: https://github.com/MeteoraAg/damm-v2-sdk
- **DAMM V2 Program**: https://github.com/MeteoraAg/damm-v2
- **Faucet (Devnet)**: https://faucet.raccoons.dev/

---

This guide should provide AI assistants with the context needed to understand, modify, and extend the DAMM V2 SDK effectively. Always prioritize type safety, use BN for numerical operations, and follow established patterns in the codebase.
