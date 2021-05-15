use anchor_lang::prelude::*;
use anchor_spl::token::{self, MintTo};

#[program]
pub mod faucet {
    use super::*;
    pub fn initialize(
        ctx: Context<InitializeFaucet>,
        nonce: u8,
        drip_volume: u64,
    ) -> ProgramResult {
        let faucet_config = &mut ctx.accounts.faucet_config;
        faucet_config.token_program = *ctx.accounts.token_program.key;
        faucet_config.token_mint = *ctx.accounts.token_mint.key;
        faucet_config.token_authority = *ctx.accounts.token_authority.key;
        faucet_config.nonce = nonce;
        faucet_config.drip_volume = drip_volume;
        Ok(())
    }

    pub fn drip(ctx: Context<Drip>) -> ProgramResult {
        let faucet_config = ctx.accounts.faucet_config.clone();
        let seeds = &[
            faucet_config.to_account_info().key.as_ref(),
            &[faucet_config.nonce],
        ];
        let signer_seeds = &[&seeds[..]];
        let cpi_accounts = MintTo {
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.receiver.to_account_info(),
            authority: ctx.accounts.token_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.clone();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::mint_to(cpi_ctx, faucet_config.drip_volume)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeFaucet<'info> {
    #[account(init)]
    faucet_config: ProgramAccount<'info, FaucetConfig>,

    #[account("token_program.key == &token::ID")]
    token_program: AccountInfo<'info>,

    #[account(mut)]
    token_mint: AccountInfo<'info>,

    #[account()]
    token_authority: AccountInfo<'info>,

    rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Drip<'info> {
    #[account()]
    faucet_config: ProgramAccount<'info, FaucetConfig>,

    // #[account("token_program.key == &token::ID")]
    token_program: AccountInfo<'info>,

    // #[account(mut, "&faucet_config.token_mint == token_mint.key")]
    token_mint: AccountInfo<'info>,

    // #[account("&faucet_config.token_authority == token_authority.key")]
    token_authority: AccountInfo<'info>,

    #[account(mut)]
    receiver: AccountInfo<'info>,
}

#[account]
pub struct FaucetConfig {
    token_program: Pubkey,
    token_mint: Pubkey,
    token_authority: Pubkey,
    nonce: u8,
    drip_volume: u64,
}
