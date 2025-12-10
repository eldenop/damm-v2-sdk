# CLAUDE.md - AI Assistant Guide for DAMM V2 SDK

## Project Overview

This is the **Meteora Constant Product AMM SDK (DAMM V2 SDK)** - a TypeScript SDK for interacting with Meteora's DAMM V2 (Dynamic Automated Market Maker) on the Solana blockchain. The SDK provides a comprehensive set of tools for pool management, liquidity operations, token swaps, position management, and reward systems.

**Package Name**: `@meteora-ag/cp-amm-sdk`
**Version**: 1.2.3
**Program ID**: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` (Mainnet & Devnet)

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js (v18.20.6)
- **Package Manager**: pnpm (v9.5.0), yarn, or bun
- **Blockchain**: Solana (web3.js v1.95.3)
- **Framework**: Anchor (v0.31.0)
- **Build Tool**: tsup (v8.4.0)
- **Test Framework**: Mocha with ts-mocha
- **Key Dependencies**:
  - `@solana/web3.js` - Solana blockchain interactions
  - `@coral-xyz/anchor` - Solana program framework
  - `@solana/spl-token` - Token program interactions
  - `decimal.js` - Precise decimal math
  - `bn.js` - Big number handling
  - `solana-bankrun` - Testing framework

## Project Structure

```
damm-v2-sdk/
├── src/                       # Source code
│   ├── CpAmm.ts              # Main SDK class - primary interface
│   ├── index.ts              # Public exports
│   ├── types.ts              # TypeScript type definitions
│   ├── constants.ts          # Program constants and limits
│   ├── pda.ts                # Program Derived Address helpers
│   ├── math/                 # Mathematical calculations
│   │   ├── curve.ts          # Constant product curve math
│   │   ├── feeMath.ts        # Fee calculations
│   │   ├── quote.ts          # Swap and liquidity quotes
│   │   ├── priceMath.ts      # Price conversions (sqrt price <-> price)
│   │   ├── utilsMath.ts      # Math utilities
│   │   └── poolFees/         # Dynamic fee mechanisms
│   │       ├── baseFee.ts
│   │       ├── feeScheduler.ts
│   │       ├── rateLimiter.ts
│   │       └── dynamicFee.ts
│   ├── helpers/              # Utility functions
│   │   ├── token.ts          # Token operations
│   │   ├── token2022.ts      # Token-2022 support
│   │   ├── utils.ts          # General utilities
│   │   ├── validation.ts     # Input validation
│   │   ├── vestings.ts       # Vesting calculations
│   │   ├── computeUnits.ts   # Compute unit management
│   │   ├── accountFilters.ts # Account filtering
│   │   └── common.ts         # Common helpers
│   └── idl/                  # Interface Definition Language
│       ├── cp_amm.ts         # IDL type definitions
│       └── cp_amm.json       # Anchor IDL file
├── tests/                    # Test suite
│   ├── *.test.ts            # Test files for each feature
│   └── bankrun-utils/       # Bankrun testing utilities
├── examples/                 # Example usage scripts
├── docs.md                   # Detailed API documentation
├── CHANGELOG.md             # Version history
└── package.json             # Package configuration
```

## Core Architecture

### Main Class: CpAmm

The `CpAmm` class (src/CpAmm.ts) is the primary interface for all SDK operations. It's initialized with a Solana connection:

```typescript
import { Connection } from "@solana/web3.js";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const cpAmm = new CpAmm(connection);
```

### Key Concepts

1. **Pools**: Liquidity pools following constant product (x*y=k) formula
   - Standard pools (predefined configs)
   - Customizable pools (custom fee structures)
   - Dynamic fee pools (with rate limiters and schedulers)

2. **Positions**: NFT-based liquidity positions
   - Represented by NFTs (SPL tokens)
   - Can be locked, split, merged, or closed
   - Earn trading fees and rewards

3. **Vesting**: Time-locked liquidity
   - Prevents immediate withdrawal
   - Used for liquidity locking mechanisms

4. **Rewards**: Additional incentives for liquidity providers
   - Permissionless reward system
   - Multiple rewards per pool supported

5. **Fee Mechanisms**:
   - Base fees (fixed or dynamic)
   - Fee schedulers (linear/exponential)
   - Rate limiters (anti-manipulation)
   - Protocol, partner, and referral fees

## Module Breakdown

### src/math/
Contains all mathematical operations for the AMM:
- **curve.ts**: Constant product curve calculations (getLiquidityFromAmounts, getAmountsFromLiquidity)
- **quote.ts**: Swap quotes and liquidity quotes
- **feeMath.ts**: Fee calculations including transfer fees for Token-2022
- **priceMath.ts**: Price conversions (sqrt price in Q64 format ↔ decimal price)
- **poolFees/**: Dynamic fee calculation modules

### src/helpers/
Utility functions for common operations:
- **token.ts**: Token account creation, balance checks
- **token2022.ts**: Token-2022 specific operations (transfer fees, extensions)
- **vestings.ts**: Vesting state calculations
- **validation.ts**: Input validation helpers
- **computeUnits.ts**: Compute budget optimization

### src/pda.ts
Program Derived Address (PDA) derivation functions:
- `derivePoolAddress()` - Pool account PDA
- `derivePositionAddress()` - Position account PDA
- `derivePositionNftAccount()` - Position NFT token account
- `deriveTokenVaultAddress()` - Token vault PDA
- `deriveRewardVaultAddress()` - Reward vault PDA

## Development Workflow

### Setup
```bash
# Install dependencies
pnpm install

# Build the SDK
pnpm run build

# Watch mode for development
pnpm run start
```

### Testing
```bash
# Run all tests
pnpm test

# Tests use solana-bankrun for fast, local testing
# No need for a validator or devnet
```

### Linting and Formatting
```bash
# Check formatting
pnpm run lint

# Fix formatting issues
pnpm run lint:fix
```

### Building
```bash
# Clean build
pnpm run clean
pnpm run build

# Output: dist/ directory with:
#   - index.js (CommonJS)
#   - index.mjs (ESM)
#   - index.d.ts (TypeScript definitions)
#   - Source maps
```

## Code Conventions

### TypeScript Configuration
- **Strict mode**: Enabled (except `strictNullChecks: false`)
- **Target**: ES6
- **Module**: CommonJS with ESM support
- **noImplicitAny**: true
- All exports are strongly typed

### Naming Conventions
- **Classes**: PascalCase (e.g., `CpAmm`)
- **Functions**: camelCase (e.g., `createPool`, `addLiquidity`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `CP_AMM_PROGRAM_ID`)
- **Types/Interfaces**: PascalCase (e.g., `PoolState`, `CreatePoolParams`)
- **Enums**: PascalCase with PascalCase values (e.g., `TradeDirection.AtoB`)

### File Organization
- One main class per file
- Group related functions in modules
- Export everything through index.ts
- Keep types in types.ts

### Number Handling
- Use `BN` (from bn.js) for all on-chain amounts
- Use `Decimal` (from decimal.js) for precise calculations
- Token amounts are always in base units (e.g., lamports for SOL)
- Sqrt prices are in Q64 format (64-bit fixed-point)

### Error Handling
- Use `invariant()` for critical assertions
- Validate inputs before operations
- Provide clear error messages

## Common Patterns

### 1. Transaction Building
Most SDK functions return `TxBuilder` (Promise<Transaction>):

```typescript
const tx = await cpAmm.createPool(params);
// tx is a Transaction object, ready to sign and send
```

### 2. Token Program Detection
Always detect token program (Token vs Token-2022):

```typescript
import { getTokenProgram } from "./helpers";

const tokenProgram = await getTokenProgram(connection, mintAddress);
```

### 3. Transfer Fee Handling (Token-2022)
Account for transfer fees in Token-2022:

```typescript
import { calculateTransferFeeIncludedAmount } from "./helpers";

// When calculating amounts for Token-2022 with transfer fees
const amountWithFee = calculateTransferFeeIncludedAmount(baseAmount, tokenInfo);
```

### 4. Quote Before Action
Always get quotes before executing operations:

```typescript
// Before swapping
const quote = cpAmm.getQuote(params);

// Before adding liquidity
const depositQuote = cpAmm.getDepositQuote(params);

// Before removing liquidity
const withdrawQuote = cpAmm.getWithdrawQuote(params);
```

### 5. Account Filters
Use account filters to query positions by pool or user:

```typescript
import { positionByPoolFilter } from "./helpers";

const filter = positionByPoolFilter(poolAddress);
const positions = await connection.getProgramAccounts(CP_AMM_PROGRAM_ID, {
  filters: filter,
});
```

## Testing Conventions

### Test Structure
- Each feature has its own test file (e.g., `swap.test.ts`, `addLiquidity.test.ts`)
- Use `solana-bankrun` for fast, deterministic tests
- Tests are in `tests/` directory
- Test utilities in `tests/bankrun-utils/`

### Test Patterns
```typescript
import { describe, it } from "mocha";
import { expect } from "chai";

describe("Feature Name", () => {
  it("should do something", async () => {
    // Setup
    // Execute
    // Assert
  });
});
```

### Running Tests
- Tests use `ts-mocha` with 1000-second timeout
- Run with: `pnpm test`
- No need for local validator or devnet

## Important Constants

### Limits and Bounds
- `MIN_FEE_BPS`: 1 (0.01%)
- `MAX_FEE_BPS_V0`: 5000 (50%)
- `MAX_FEE_BPS_V1`: 9900 (99%)
- `FEE_DENOMINATOR`: 1,000,000,000
- `BASIS_POINT_MAX`: 10,000
- `LIQUIDITY_SCALE`: 128 (Q128 format)
- `SCALE_OFFSET`: 64 (Q64 format)

### Price Ranges
- `MIN_SQRT_PRICE`: 4,295,048,016
- `MAX_SQRT_PRICE`: 79,226,673,521,066,979,257,578,248,091

### Compute Units
- `MIN_CU_BUFFER`: 50,000
- `MAX_CU_BUFFER`: 200,000

## Key SDK Methods

### Pool Operations
- `createPool()` - Create standard pool
- `createCustomPool()` - Create customizable pool
- `createCustomPoolWithDynamicConfig()` - Create with dynamic fees
- `fetchPoolState()` - Get pool state
- `getAllPools()` - Get all pools

### Position Management
- `createPosition()` - Create new position
- `createPositionAndAddLiquidity()` - Create and add liquidity atomically
- `fetchPositionState()` - Get position state
- `getPositionsByUser()` - Get user's positions
- `closePosition()` - Close empty position
- `splitPosition()` - Split position by percentage
- `splitPosition2()` - Split position by numerator
- `mergePosition()` - Merge two positions

### Liquidity Operations
- `addLiquidity()` - Add liquidity to position
- `removeLiquidity()` - Remove partial liquidity
- `removeAllLiquidity()` - Remove all liquidity
- `removeAllLiquidityAndClosePosition()` - Remove and close atomically
- `getLiquidityDelta()` - Calculate liquidity from token amounts
- `getDepositQuote()` - Quote for deposits
- `getWithdrawQuote()` - Quote for withdrawals

### Swap Operations
- `swap()` - Execute exact-in swap
- `swap2()` - Execute with swap mode (ExactIn/ExactOut/PartialFill)
- `getQuote()` - Get exact-in quote
- `getQuote2()` - Get quote with swap mode

### Lock/Vesting Operations
- `lockPosition()` - Lock liquidity with vesting
- `permanentLockPosition()` - Permanently lock liquidity
- `refreshVesting()` - Refresh vesting state
- `isVestingComplete()` - Check if vesting complete
- `getAvailableVestingLiquidity()` - Get unlocked liquidity

### Fee Operations
- `claimPositionFee()` - Claim position fees
- `claimPositionFee2()` - Claim with specific mode
- `claimPartnerFee()` - Claim partner fees
- `getUnClaimLpFee()` - Calculate unclaimed fees

### Reward Operations
- `initializeReward()` - Initialize reward for pool
- `initializeAndFundReward()` - Initialize and fund atomically
- `fundReward()` - Add reward tokens
- `claimReward()` - Claim position rewards
- `updateRewardDuration()` - Update reward duration
- `updateRewardFunder()` - Update reward funder
- `withdrawIneligibleReward()` - Withdraw unclaimed rewards

### Helper Functions
- `getPriceFromSqrtPrice()` - Convert Q64 sqrt price to decimal
- `getSqrtPriceFromPrice()` - Convert decimal to Q64 sqrt price
- `getBaseFeeNumerator()` - Get current base fee
- `getDynamicFeeNumerator()` - Get dynamic fee component
- `getPriceImpact()` - Calculate price impact
- `preparePoolCreationParams()` - Prepare pool creation parameters

## CI/CD Pipeline

The project uses GitHub Actions for continuous integration:

### Triggers
- Pull requests to `main` branch
- Only runs if `src/` or `tests/` directories changed

### Pipeline Steps
1. Setup Solana CLI (v2.1.0)
2. Install dependencies with pnpm
3. Setup Rust toolchain
4. Cache Rust and node_modules
5. Run tests: `npm install && npm run test`

### Environment
- **Solana CLI**: 2.1.0
- **Node**: 18.20.6
- **Anchor CLI**: 0.31.0
- **pnpm**: 9.5.0

## AI Assistant Guidelines

### When Working on This Codebase

1. **Always Check Token Programs**: Solana has Token Program and Token-2022 Program. Always detect which program a mint uses.

2. **Handle Transfer Fees**: Token-2022 tokens may have transfer fees. Use `calculateTransferFeeIncludedAmount()` and `calculateTransferFeeExcludedAmount()` when needed.

3. **Use BN for Amounts**: All token amounts and on-chain numbers use `BN` from bn.js, not JavaScript numbers.

4. **Q64 Format for Prices**: Sqrt prices are in Q64 fixed-point format. Use conversion helpers: `getPriceFromSqrtPrice()` and `getSqrtPriceFromPrice()`.

5. **Quote Before Action**: Always calculate quotes before operations to prevent slippage surprises.

6. **Understand Pool Versions**: There are V0 and V1 pools with different fee limits. Check `poolVersion` field.

7. **Account for Vesting**: Positions may have locked liquidity. Check vesting state before operations.

8. **Test with Bankrun**: Use solana-bankrun for tests - it's fast and deterministic.

9. **Read docs.md First**: The docs.md file contains detailed function documentation with examples.

10. **Follow Existing Patterns**: When adding new functions, follow patterns in CpAmm.ts.

### Common Tasks

#### Adding a New SDK Method
1. Add types to `src/types.ts`
2. Implement method in `src/CpAmm.ts`
3. Add helper functions to appropriate `src/helpers/` file
4. Export from `src/index.ts`
5. Add tests in `tests/`
6. Update `docs.md` with documentation
7. Add entry to `CHANGELOG.md`

#### Fixing a Bug
1. Write a failing test that reproduces the bug
2. Fix the bug
3. Ensure test passes
4. Update CHANGELOG.md
5. Consider if other similar code has the same bug

#### Adding Math Functions
1. Add to appropriate file in `src/math/`
2. Export from `src/math/index.ts`
3. Add unit tests
4. Document any Q64/Q128 format requirements

### Documentation Requirements

When modifying the SDK:
- Update `docs.md` for any public API changes
- Add JSDoc comments to public methods
- Update `CHANGELOG.md` following existing format
- Include examples for new features in `examples/`

### Version Bumping

Follow semantic versioning:
- **Patch** (1.2.3 → 1.2.4): Bug fixes, no API changes
- **Minor** (1.2.3 → 1.3.0): New features, backwards compatible
- **Major** (1.2.3 → 2.0.0): Breaking changes

Update version in:
1. `package.json`
2. Add entry to `CHANGELOG.md`

## Useful References

- **Main Documentation**: `docs.md` - Comprehensive API documentation
- **Program Repository**: https://github.com/MeteoraAg/damm-v2
- **Solana Web3.js**: https://solana-labs.github.io/solana-web3.js/
- **Anchor Framework**: https://www.anchor-lang.com/
- **Devnet Faucet**: https://faucet.raccoons.dev/

## Common Pitfalls to Avoid

1. **Don't use JavaScript numbers for amounts** - Always use BN
2. **Don't forget to check token programs** - Token vs Token-2022
3. **Don't ignore transfer fees** - Token-2022 may have them
4. **Don't forget slippage** - Use `getMinAmountWithSlippage()` and `getMaxAmountWithSlippage()`
5. **Don't assume positions are unlocked** - Check vesting state
6. **Don't modify IDL files manually** - They're generated from the program
7. **Don't skip validation** - Use validation helpers
8. **Don't use deprecated methods** - Check CHANGELOG for deprecations

## Recent Changes (v1.2.3)

- Added `initializeReward()` and `initializeAndFundReward()` endpoints
- Renamed `getUnclaimReward()` to `getUnClaimLpFee()`
- Updated reward-related parameters and method signatures
- Enhanced rate limiter functionality
- Improved Token-2022 support

## Support and Issues

- Report issues: https://github.com/MeteoraAg/damm-v2-sdk/issues
- Check CHANGELOG.md for recent changes
- Review docs.md for detailed API documentation
- See examples/ for usage patterns

---

**Last Updated**: 2025-12-10
**SDK Version**: 1.2.3
**Maintained by**: Meteora Team
