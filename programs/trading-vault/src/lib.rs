/*
 * Trading Vault — Solana 在线合约
 *
 * 设计说明:
 * ─────────────────────────────────────────────────────────────────────
 * 安全模型（三层权限）:
 *   1. Admin（管理员）  — 只有管理员可提取 SOL / Token。私钥离线保管，绝不上服务器。
 *   2. Operator（操作员）— 服务器热钱包，只能触发 swap，无法提取资金。
 *   3. Vault PDA（合约金库）— 合约自动管理，持有所有 SOL 和 Token。
 *
 * 交互流程:
 *   deposit_sol      → 任何人往合约存入 SOL
 *   execute_swap     → Operator 调用，通过 CPI 调用 DAMM V2 进行买/卖
 *   withdraw_sol     → Admin 专属，提取合约中的 SOL
 *   withdraw_token   → Admin 专属，提取合约中的 SPL Token
 *
 * 关键地址:
 *   DAMM V2 Program: cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG
 * ─────────────────────────────────────────────────────────────────────
 */

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    system_instruction,
};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("TVauLtxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

// ─── PDA Seeds ────────────────────────────────────────────────────────────────
pub const VAULT_STATE_SEED: &[u8] = b"vault_state";
pub const SOL_VAULT_SEED: &[u8] = b"sol_vault";

// ─── Constants ────────────────────────────────────────────────────────────────
/// 最多允许 10 个 Operator（服务器交易账号）
pub const MAX_OPERATORS: usize = 10;

/// DAMM V2 swap 指令鉴别符（discriminator）
/// = sha256("global:swap")[..8]，从 IDL 中读取
pub const DAMM_V2_SWAP_DISCRIMINATOR: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200];

// ─── Program ──────────────────────────────────────────────────────────────────
#[program]
pub mod trading_vault {
    use super::*;

    // ─── 初始化 ──────────────────────────────────────────────────────────────

    /// 初始化合约金库，设置管理员。
    /// 每个管理员地址只能创建一个 Vault。
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        state.admin = ctx.accounts.admin.key();
        state.operators = Vec::new();
        state.state_bump = ctx.bumps.vault_state;
        state.sol_vault_bump = ctx.bumps.sol_vault;
        state.total_swaps = 0;
        state.is_paused = false;

        msg!(
            "[TradingVault] Initialized. Admin: {}",
            state.admin
        );
        Ok(())
    }

    // ─── 管理员指令 ───────────────────────────────────────────────────────────

    /// 添加 Operator（服务器交易账号）。只有 Admin 可调用。
    pub fn add_operator(ctx: Context<AdminOnly>, operator: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require!(!state.is_paused, TradingVaultError::VaultPaused);
        require!(
            state.operators.len() < MAX_OPERATORS,
            TradingVaultError::TooManyOperators
        );
        require!(
            !state.operators.contains(&operator),
            TradingVaultError::OperatorAlreadyExists
        );
        state.operators.push(operator);
        msg!("[TradingVault] Operator added: {}", operator);
        Ok(())
    }

    /// 移除 Operator。只有 Admin 可调用。
    pub fn remove_operator(ctx: Context<AdminOnly>, operator: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        let before = state.operators.len();
        state.operators.retain(|&op| op != operator);
        require!(
            state.operators.len() < before,
            TradingVaultError::OperatorNotFound
        );
        msg!("[TradingVault] Operator removed: {}", operator);
        Ok(())
    }

    /// 转移 Admin 权限到新地址。只有 Admin 可调用。
    /// 警告：转移后原 Admin 立即失去所有权限！
    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        let old = state.admin;
        state.admin = new_admin;
        msg!(
            "[TradingVault] Admin transferred: {} -> {}",
            old,
            new_admin
        );
        Ok(())
    }

    /// 暂停/恢复合约。暂停后禁止 swap 和 deposit，只允许 withdraw。
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.vault_state.is_paused = paused;
        msg!("[TradingVault] Vault paused: {}", paused);
        Ok(())
    }

    // ─── 存款 ────────────────────────────────────────────────────────────────

    /// 存入 SOL 到合约金库。任何账户均可存入。
    pub fn deposit_sol(ctx: Context<DepositSol>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.vault_state.is_paused, TradingVaultError::VaultPaused);
        require!(amount > 0, TradingVaultError::ZeroAmount);

        let ix = system_instruction::transfer(
            &ctx.accounts.depositor.key(),
            &ctx.accounts.sol_vault.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.depositor.to_account_info(),
                ctx.accounts.sol_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        msg!(
            "[TradingVault] Deposited {} lamports. Vault balance: {}",
            amount,
            ctx.accounts.sol_vault.lamports()
        );
        Ok(())
    }

    // ─── 交易（Swap） ─────────────────────────────────────────────────────────

    /// 通过 CPI 调用 DAMM V2 执行 swap（买入或卖出）。
    ///
    /// 权限：只有已注册的 Operator 才能调用。
    /// 资金：合约的 sol_vault PDA 作为 payer/signer 参与 DAMM V2 swap。
    /// Token 账户：必须是以 sol_vault 为 authority 的 ATA。
    ///
    /// 参数:
    ///   amount_in          - 输入 Token 数量
    ///   minimum_amount_out - 最小接受输出数量（滑点保护）
    pub fn execute_swap(
        ctx: Context<ExecuteSwap>,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.vault_state;
        require!(!state.is_paused, TradingVaultError::VaultPaused);
        require!(
            state.operators.contains(&ctx.accounts.operator.key()),
            TradingVaultError::Unauthorized
        );
        require!(amount_in > 0, TradingVaultError::ZeroAmount);

        // ── 构建 DAMM V2 swap 指令数据 ──────────────────────────────────────
        // 格式: discriminator(8) + amount_in(8) + minimum_amount_out(8)
        // SwapParameters = { amount_in: u64, minimum_amount_out: u64 }
        let mut ix_data = Vec::with_capacity(24);
        ix_data.extend_from_slice(&DAMM_V2_SWAP_DISCRIMINATOR);
        ix_data.extend_from_slice(&amount_in.to_le_bytes());
        ix_data.extend_from_slice(&minimum_amount_out.to_le_bytes());

        // ── 构建 DAMM V2 账户列表 ────────────────────────────────────────────
        // 顺序必须与 IDL 完全一致:
        // pool_authority, pool, input_token_account, output_token_account,
        // token_a_vault, token_b_vault, token_a_mint, token_b_mint,
        // payer(=sol_vault, signer), token_a_program, token_b_program,
        // event_authority, program
        let mut accounts = vec![
            AccountMeta::new_readonly(ctx.accounts.pool_authority.key(), false),
            AccountMeta::new(ctx.accounts.pool.key(), false),
            AccountMeta::new(ctx.accounts.input_token_account.key(), false),
            AccountMeta::new(ctx.accounts.output_token_account.key(), false),
            AccountMeta::new(ctx.accounts.token_a_vault.key(), false),
            AccountMeta::new(ctx.accounts.token_b_vault.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_a_mint.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_b_mint.key(), false),
            // sol_vault PDA 作为 payer（signer），通过 invoke_signed 签名
            AccountMeta::new_readonly(ctx.accounts.sol_vault.key(), true),
            AccountMeta::new_readonly(ctx.accounts.token_a_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_b_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.damm_v2_program.key(), false),
        ];

        // 可选：referral_token_account
        let mut account_infos = vec![
            ctx.accounts.pool_authority.to_account_info(),
            ctx.accounts.pool.to_account_info(),
            ctx.accounts.input_token_account.to_account_info(),
            ctx.accounts.output_token_account.to_account_info(),
            ctx.accounts.token_a_vault.to_account_info(),
            ctx.accounts.token_b_vault.to_account_info(),
            ctx.accounts.token_a_mint.to_account_info(),
            ctx.accounts.token_b_mint.to_account_info(),
            ctx.accounts.sol_vault.to_account_info(),
            ctx.accounts.token_a_program.to_account_info(),
            ctx.accounts.token_b_program.to_account_info(),
            ctx.accounts.event_authority.to_account_info(),
            ctx.accounts.damm_v2_program.to_account_info(),
        ];

        // 如果传入了 referral_token_account，追加到列表
        if let Some(referral) = &ctx.accounts.referral_token_account {
            accounts.push(AccountMeta::new(referral.key(), false));
            account_infos.push(referral.to_account_info());
        }

        let damm_ix = Instruction {
            program_id: ctx.accounts.damm_v2_program.key(),
            accounts,
            data: ix_data,
        };

        // ── sol_vault PDA 签名 CPI ───────────────────────────────────────────
        // Seeds: [SOL_VAULT_SEED, admin_pubkey, sol_vault_bump]
        let admin_key = ctx.accounts.vault_state.admin;
        let sol_vault_bump = ctx.accounts.vault_state.sol_vault_bump;
        let seeds: &[&[u8]] = &[SOL_VAULT_SEED, admin_key.as_ref(), &[sol_vault_bump]];
        let signer_seeds = &[seeds];

        invoke_signed(&damm_ix, &account_infos, signer_seeds)?;

        // 更新 swap 计数
        ctx.accounts.vault_state.total_swaps = ctx
            .accounts
            .vault_state
            .total_swaps
            .saturating_add(1);

        msg!(
            "[TradingVault] Swap #{} executed. amount_in={}, min_out={}",
            ctx.accounts.vault_state.total_swaps,
            amount_in,
            minimum_amount_out
        );
        Ok(())
    }

    // ─── 提款（Admin 专属） ───────────────────────────────────────────────────

    /// 从合约金库提取 SOL 到 Admin 钱包。只有 Admin 可调用。
    ///
    /// 安全保证：
    ///   - 验证调用者是 Admin（has_one 约束）
    ///   - 保留最低 rent-exempt 余额，防止账户被系统回收
    pub fn withdraw_sol(ctx: Context<WithdrawSol>, amount: u64) -> Result<()> {
        require!(amount > 0, TradingVaultError::ZeroAmount);

        let vault_lamports = ctx.accounts.sol_vault.lamports();
        let rent = Rent::get()?;
        // 保留最低 rent-exempt 余额（大约 0.00089 SOL），防止账户关闭
        let min_balance = rent.minimum_balance(0);
        require!(
            vault_lamports.saturating_sub(amount) >= min_balance,
            TradingVaultError::InsufficientFunds
        );

        // 直接修改 PDA lamports（PDA 由本程序拥有，无需 CPI）
        **ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.admin.try_borrow_mut_lamports()? += amount;

        msg!(
            "[TradingVault] Withdrew {} lamports to admin. Remaining: {}",
            amount,
            ctx.accounts.sol_vault.lamports()
        );
        Ok(())
    }

    /// 从合约金库提取 SPL Token 到 Admin 的 Token 账户。只有 Admin 可调用。
    ///
    /// 使用方法：
    ///   vault_token_account 是以 sol_vault 为 authority 的 ATA，
    ///   admin_token_account 是 Admin 的 ATA。
    pub fn withdraw_token(ctx: Context<WithdrawToken>, amount: u64) -> Result<()> {
        require!(amount > 0, TradingVaultError::ZeroAmount);
        require!(
            ctx.accounts.vault_token_account.amount >= amount,
            TradingVaultError::InsufficientFunds
        );

        // sol_vault PDA 作为 token authority 签名 token::transfer CPI
        let admin_key = ctx.accounts.vault_state.admin;
        let sol_vault_bump = ctx.accounts.vault_state.sol_vault_bump;
        let seeds: &[&[u8]] = &[SOL_VAULT_SEED, admin_key.as_ref(), &[sol_vault_bump]];
        let signer_seeds = &[seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.admin_token_account.to_account_info(),
                authority: ctx.accounts.sol_vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        msg!(
            "[TradingVault] Withdrew {} tokens to admin",
            amount
        );
        Ok(())
    }
}

// ─── State ────────────────────────────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct VaultState {
    /// 管理员公钥（唯一有权提款的账户）
    pub admin: Pubkey,          // 32
    /// 授权交易的 Operator 列表（服务器热钱包）
    pub operators: Vec<Pubkey>, // 4 + 32 * MAX_OPERATORS
    /// vault_state PDA 的 bump seed
    pub state_bump: u8,         // 1
    /// sol_vault PDA 的 bump seed
    pub sol_vault_bump: u8,     // 1
    /// 累计 swap 次数（统计用）
    pub total_swaps: u64,       // 8
    /// 是否暂停（暂停时禁止 swap 和 deposit）
    pub is_paused: bool,        // 1
}

impl VaultState {
    /// Account 空间 = discriminator(8) + 各字段大小之和
    pub const LEN: usize = 8       // Anchor discriminator
        + 32                        // admin
        + 4 + 32 * MAX_OPERATORS    // operators Vec
        + 1                         // state_bump
        + 1                         // sol_vault_bump
        + 8                         // total_swaps
        + 1;                        // is_paused
}

// ─── Instruction Accounts ─────────────────────────────────────────────────────

/// 初始化合约金库
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// 合约状态账户（PDA）
    /// Seeds: [VAULT_STATE_SEED, admin.key]
    #[account(
        init,
        payer = admin,
        space = VaultState::LEN,
        seeds = [VAULT_STATE_SEED, admin.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    /// SOL 金库 PDA，持有所有 lamports
    /// Seeds: [SOL_VAULT_SEED, admin.key]
    /// 注意：此 PDA 同时是所有 Token 账户的 authority
    /// CHECK: 这是一个纯 lamport holder PDA，由本程序控制
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, admin.key().as_ref()],
        bump
    )]
    pub sol_vault: SystemAccount<'info>,

    /// 管理员（支付初始化费用，也是唯一可提款的账户）
    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Admin 专属操作（添加/移除 Operator，转移 Admin，暂停等）
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [VAULT_STATE_SEED, admin.key().as_ref()],
        bump = vault_state.state_bump,
        // has_one 确保 vault_state.admin == admin.key()
        has_one = admin @ TradingVaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// 必须是 vault_state 中记录的 admin
    pub admin: Signer<'info>,
}

/// 存入 SOL
#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(
        seeds = [VAULT_STATE_SEED, vault_state.admin.as_ref()],
        bump = vault_state.state_bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: SOL 金库 PDA（接收 lamports）
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, vault_state.admin.as_ref()],
        bump = vault_state.sol_vault_bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    /// 存款人（任何人均可存入）
    #[account(mut)]
    pub depositor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// 执行 swap（Operator 调用 DAMM V2 CPI）
#[derive(Accounts)]
pub struct ExecuteSwap<'info> {
    #[account(
        mut,
        seeds = [VAULT_STATE_SEED, vault_state.admin.as_ref()],
        bump = vault_state.state_bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: SOL 金库 PDA，作为 DAMM V2 swap 的 payer（通过 invoke_signed 签名）
    /// 注意：这个账户是所有 Token 账户的 authority
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, vault_state.admin.as_ref()],
        bump = vault_state.sol_vault_bump,
    )]
    pub sol_vault: AccountInfo<'info>,

    /// Operator（服务器热钱包），必须在 vault_state.operators 中
    pub operator: Signer<'info>,

    // ── DAMM V2 所需账户（顺序与 IDL 一致） ─────────────────────────────────

    /// CHECK: DAMM V2 pool_authority PDA
    pub pool_authority: AccountInfo<'info>,

    /// CHECK: DAMM V2 pool 状态账户
    #[account(mut)]
    pub pool: AccountInfo<'info>,

    /// CHECK: 输入 Token 账户（由 sol_vault 持有，买入时为 wSOL/USDC 等）
    /// 必须以 sol_vault 为 authority
    #[account(mut)]
    pub input_token_account: AccountInfo<'info>,

    /// CHECK: 输出 Token 账户（由 sol_vault 持有，买入后接收目标 Token）
    /// 必须以 sol_vault 为 authority
    #[account(mut)]
    pub output_token_account: AccountInfo<'info>,

    /// CHECK: DAMM V2 Pool Token A Vault
    #[account(mut)]
    pub token_a_vault: AccountInfo<'info>,

    /// CHECK: DAMM V2 Pool Token B Vault
    #[account(mut)]
    pub token_b_vault: AccountInfo<'info>,

    /// CHECK: Token A Mint
    pub token_a_mint: AccountInfo<'info>,

    /// CHECK: Token B Mint
    pub token_b_mint: AccountInfo<'info>,

    /// CHECK: Token A 程序（Token Program 或 Token-2022 Program）
    pub token_a_program: AccountInfo<'info>,

    /// CHECK: Token B 程序（Token Program 或 Token-2022 Program）
    pub token_b_program: AccountInfo<'info>,

    /// CHECK: DAMM V2 event_authority PDA
    pub event_authority: AccountInfo<'info>,

    /// CHECK: DAMM V2 主程序
    /// 地址必须是: cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG
    #[account(
        constraint = damm_v2_program.key().to_string() == "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"
            @ TradingVaultError::InvalidDammProgram
    )]
    pub damm_v2_program: AccountInfo<'info>,

    /// 可选：推荐人 Token 账户（referral）
    /// CHECK: 可选的推荐账户
    pub referral_token_account: Option<AccountInfo<'info>>,

    pub system_program: Program<'info, System>,
}

/// 提取 SOL（Admin 专属）
#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(
        seeds = [VAULT_STATE_SEED, admin.key().as_ref()],
        bump = vault_state.state_bump,
        has_one = admin @ TradingVaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: SOL 金库 PDA（提款来源）
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, admin.key().as_ref()],
        bump = vault_state.sol_vault_bump,
    )]
    pub sol_vault: AccountInfo<'info>,

    /// Admin 账户（接收 SOL）
    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// 提取 SPL Token（Admin 专属）
#[derive(Accounts)]
pub struct WithdrawToken<'info> {
    #[account(
        seeds = [VAULT_STATE_SEED, admin.key().as_ref()],
        bump = vault_state.state_bump,
        has_one = admin @ TradingVaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: SOL 金库 PDA（作为 Token 账户的 authority，通过 invoke_signed 签名）
    #[account(
        seeds = [SOL_VAULT_SEED, admin.key().as_ref()],
        bump = vault_state.sol_vault_bump,
    )]
    pub sol_vault: AccountInfo<'info>,

    /// 合约金库的 Token 账户（以 sol_vault 为 authority 的 ATA）
    #[account(
        mut,
        token::authority = sol_vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Admin 的 Token 账户（接收提款）
    #[account(
        mut,
        token::authority = admin,
    )]
    pub admin_token_account: Account<'info, TokenAccount>,

    /// Admin（必须签名）
    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ─── Errors ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum TradingVaultError {
    #[msg("Unauthorized: caller is not admin or operator")]
    Unauthorized,

    #[msg("Operator limit reached: maximum 10 operators")]
    TooManyOperators,

    #[msg("Operator already registered")]
    OperatorAlreadyExists,

    #[msg("Operator not found in the list")]
    OperatorNotFound,

    #[msg("Insufficient funds in vault")]
    InsufficientFunds,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Vault is paused, no swaps or deposits allowed")]
    VaultPaused,

    #[msg("Invalid DAMM V2 program ID")]
    InvalidDammProgram,
}
