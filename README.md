# 用 Anchor 写 Solana program

## 简介

这篇文章旨在为了解 Solana 与智能合约相关背景知识的开发者介绍 [Anchor](https://project-serum.github.io/anchor/getting-started/introduction.html)。在这篇文章中，首先会介绍我们的目标：写一个 SPL Token 水龙头。然后，我们会用`Anchor`实现一个`Faucet`，通过这个过程来了解`Anchor`这个框架。
需要了解关于`Solana`相关的背景知识，可以先阅读以下文档：

- [Solana](https://docs.solana.com/developing/programming-model/overview)
- [Programming on Solana](https://paulx.dev/blog/2021/01/14/programming-on-solana-an-introduction/)
- [SPL](https://spl.solana.com/)

## 『水龙头』是什么

数字货币的水龙头（以后都会用`faucet`替代），是一种可以让用户快速获得某种特定数字货币的装置。它可以是一个服务，可以是一系列接口，也可以是一个运行在链上的智能合约。
一个典型的『Faucet』会包含这些信息：

- 可以赚什么币？（对本文来说，是`SPL Token`）
- 要怎么赚？（发起一个`transaction`）
- 能赚到多少？（我们准备通过配置参数来控制）

关于`Faucet`更多的信息可以参考[这篇文章](https://coinmarketcap.com/alexandria/article/what-is-a-crypto-faucet)

## 使用`Anchor`实现『水龙头』`program`

那么，我们终于进入正题，开始用`Anchor`写一个`Faucet`项目。

读者可以选择跟随本文一起了解 Anchor ，或者直接阅读 [Anchor官方文档](https://project-serum.github.io/anchor/getting-started/introduction.html)。本文中用到的所有命令与代码范式，都可以在 [Anchor官方文档](https://project-serum.github.io/anchor/getting-started/introduction.html)或者[官方例子](https://github.com/project-serum/anchor/tree/master/examples)中找到。

### 安装 Anchor 依赖

在最开始，我们需要安装`Anchor`依赖，这部分在[官方文档](https://project-serum.github.io/anchor/getting-started/installation.html#install-rust)中写得非常详细，本文就不再赘述。

让我们快速进入下一步，正式开始写代码。

### 通过`Anchor cli`生成新项目

```bash
$ anchor init faucet
$ cd faucet
```

可以看到`Anchor`为我们生成好了目录结构，这个结构基本保持与`Solana Program`一致

```bash
|- app
|- migrations // 迁移脚本
|- programs
|  |- faucet
|  |  |- src
|  |  |  |- lib.rs // Program 代码
|- tests   // 测试脚本
|- Cargo.lock
|- Cargo.toml
|- Anchor.toml // Anchor 配置
```

可以看到`src`目录里已经生成了一个`lib.rs`文件，里面已经包含了基本的代码结构

```rust
use anchor_lang::prelude::*;

#[program]
pub mod faucet {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>) -> ProgramResult {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
```

首先，代码中的`#[program]`宏定义了一个`Solana Program`。这意味着，这个模块所有的方法都应该对应到一个`Instruction`。

`Context<Initialize>`参数中包含了当前这个`Program`的`program_id`，还有这个`Instruction`中需要用到的所有`Account`。具体包含哪些`Account`则是在 `#[derive(Accounts)]`装饰的`struct`中定义。

### Initialize Faucet

让我们回忆一下我们的`Faucet Program`具体的功能 -- 当用户通过`rpc`调用了某个特定的`Instruction`之后，我们就给用户指定的账号发送一些`SPL Token`

- 发送的`token`种类由用户在我们提供的一个列表中选择；
- 发送的`token`数量则由`Faucet Program`配置决定；

那么在开放给用户使用之前，我们需要先初始化`Faucet Program`，为他配置支持的`token`种类和每次发送给用户的`token`数量。

由于`Solana Program`本身不会存储状态，所有的状态都会存储在`Account`中。那么我们需要先声明用于存储`Faucet`配置的`Account`数据结构。

我们在代码的最下方添加

```rust
#[account]
pub struct FaucetConfig {
    token_program: Pubkey,
    token_mint: Pubkey,
    token_authority: Pubkey,
    nonce: u8,
    drip_volume: u64,
}
```

- `#[account]`: 这个宏为`struct`增加了`Account`序列化和反序列化的实现。
- `Pubkey`: 类型代表`Solana`账号的公钥。存储在`FaucetConfig`中的公钥主要是给客户端读取或者作为`Instruction`的约束条件使用
- `token_program`: 是指一个特定的`Solana Program`，它实现了`SPL Token`的一些公共`Instruction`(例如我们会用到的`Mint_to`)，关于`Token`的解释可以参考: [Solana Token](https://spl.solana.com/token)
- token_mint: 我们需要通过`FaucetConfig`中`token_mint`来确定`Faucet`支持的`Token`具体是哪一种，`token_mint`是`TokenProgram`的`Account`地址，当中存储了关于`Token`的信息(比如 PRT 的地址)
- token_authority + nonce: 之后关于`PDA & CPI`的部分会介绍，现在可以简单的认为我们将通过 token_authority + nonce 获取操作`TokenProgram`的权限，然后给用户发一些`Token`

为了在`initialize`方法中能够修改`FaucetConfig`的配置，我们需要为`initialize`函数添加参数

```rust
pub fn initialize(ctx: Context<InitializeFaucet>, nonce: u8, drip_volume: u64) -> ProgramResult {
    Ok(())
}
```

接下来，需要在 `InitializeFaucet` 中添加需要的 account。在添加之前，我们需要增加一些依赖项。

我们需要在`Cargo.toml`里加上依赖库，修改后的依赖声明变成了这样 

```toml
# Cargo.toml
# ...
[dependencies]
anchor-lang = "0.4.1"
anchor-spl = "0.4.1"
```

回到`lib.rs`，在文件顶端添加`import`

```rust
// lib.rs
use anchor_spl::token;
```

然后就可以在`struct`中添加我们需要的`Account`了

```rust
// lib.rs
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
```

- `#[account(init)]`: 由于`faucet_config`是一个新创建的`account`，我们需要通过这个`Instruction`为它初始化数据，所以必须添加 `#[account(init)]` 宏，同时还需要增加 `rent:Sysvar<'info, Rent>` 定义。否则`transaction`会失败。关于`Rent`，可以通过这里了解更多[Rent](https://docs.solana.com/implemented-proposals/rent)
- `#[account(mut)]`: `mut` 标记和`Solana`中`mut account`一样，让`Program`能够把数据持久化到`account.data`中
- `#[account("token_program.key == &token:ID")]`: 这里的作用是检查`token_program`是否正确。其他可用的宏参数可以在[这里](https://docs.rs/anchor-lang/0.5.0/anchor_lang/derive.Accounts.html)找到。

好，现在需要的数据和账号都已经准备好，下一步就是完成我们的`initialize`方法，在`initialize`方法中我们只需要把数据保存到`account`中就可以，所以，修改后的`initialize`方法是：

```rust
#[program]
pub mod faucet {
    use super::*;
    pub fn initialize(ctx: Context<InitializeFaucet>, nonce: u8, drip_volume: u64) -> ProgramResult {
        let faucet_config = &mut ctx.accounts.faucet_config;
        faucet_config.token_program = *ctx.accounts.token_program.key;
        faucet_config.token_mint = *ctx.accounts.token_mint.key;
        faucet_config.token_authority = *ctx.accounts.token_authority.key;
        faucet_config.nonce = nonce;
        faucet_config.drip_volume = drip_volume;
        Ok(())
    }
}
```

下一步我们需要实现`Drip`方法

### Drip

由于大部分信息都已经配置好，`Drip`方法就只需要指定『把`token`发给谁』就可以。所以我们在 `faucet mod` 中添加一个函数 

```rust
pub mod faucet {
    pub fn drip(ctx: Context<Drip>) -> ProgramResult {
        Ok(())
    }
}
```

然后，我们需要定义所需的`Account`

```rust
#[derive(Accounts)]
pub struct Drip<'info> {
    #[account()]
    faucet_config: ProgramAccount<'info, FaucetConfig>,

    #[account("token_program.key == &token::ID")]
    token_program: AccountInfo<'info>,

    #[account(mut, "&faucet_config.token_mint == token_mint.key")]
    token_mint: AccountInfo<'info>,

    #[account("&faucet_config.token_authority == token_authority.key")]
    token_authority: AccountInfo<'info>,

    #[account(mut)]
    receiver: AccountInfo<'info>,
}
```

在 `#[account(...)]` 中我们添加了一些验证，确保用户传入的账号与配置中的账号一致。

接下来开始实现`Drip`方法。

#### PDA & CPI

为了在`Drip`方法中调用 `TokenProgram::MintTo` 方法（在`Solana`中被称为`CPI`，关于CPI可以通过这个文档了解更多[CPI](https://docs.solana.com/developing/programming-model/calling-between-programs#cross-program-invocations)），我们需要获得能够为`TokenProgram::MintTo`授权的`Account`。

但`Drip`方法的`Signer`是希望获得一些`Airdrop`的用户`TokenAccount`，它一定不会是`tokenMint::token_authority`，无法获得授权，所以在这里，我们需要用到`PDA`完成签名。关于 CPI 与 PDA 的详细介绍，可以参看[官方文档](https://docs.solana.com/developing/programming-model/calling-between-programs#program-derived-addresses)

`Anchor`简化了`CPI`调用的方式，并且在生成`PDA`的场合也变得简单了许多。首先我们需要获取保存在 `FaucetConfig` 中的`nonce`，并构建生成用于生成`PDA`的`seed`

```rust
pub mod faucet {
    // ... initialize

    pub fn drip(ctx: Context<Drip>) -> ProgramResult {
        let faucet_config = ctx.accounts.faucet_config.clone();
        let seeds = &[
            faucet_config.to_account_info().key.as_ref(),
            &[faucet_config.nonce],
        ];
        Ok(())
    }
}
```
在`Solana`中，当我们需要通过一个`PDA`为`Instruction`签名并调用另一个`Program`的方法时，需要通过调用`invoke_signed`来实现。

```rust
invoke_signed(instruction, accounts, signer_seeds);
```

在`anchor`中，这个方法被分解成了两部分:

```rust
let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
token::mint_to(cpi_ctx)?;
```

这里的`signer_seeds`是指生成`PDA`的`seeds`加上和`PDA`一同返回的`bump_seed`。`Solana`将通过`signer_seeds`来验证`PDA`的签名是否有效。

在这里我们通过`faucet_config.publicKey`与`nonce`作为`signer_seeds`，所以我们需要保证创建`SPL Token`的时候用`faucet_config.publicKey`参数生成`PDA`，将生成的`PDA`与`bump_seed`存到`faucet_config`中，并设置`PDA`地址为`token_mint.authority`。

这部分代码将会在接下来的 `Migration` 模块详细介绍。

那么在加入`CPI`与`PDA`部分的代码后，`Drip`方法将会变成这样

```rust
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
```

这时候由于我们还没引入`MintTo`这个 struct，所以会有一个编译错误，让我们修改一下`anchor_spl`的引入代码

```rust
use anchor_spl::token::{self, MintTo};
```

到这里我们的`Program`部分就完成了。

最终代码可以参考[这里](./programs/faucet/src/lib.rs)

### Error

因为 Program 中的程序验证全都依靠 Anchor 提供的宏命令完成，所以并没有自定义 Error 的出场机会。这里我们简单的介绍一下 Anchor 中的 Error。

```rust
// in processor
pub fn error_testing() -> ProgramError {
    return Err(FaucetError::WhateverError.into());
}
// ...


#[error]
pub enum FaucetError {
    #[msg("Error message")]
    WhateverError,
}
```

通过以上的代码，可以让`Instruction`失败。

### 集成测试

在部署之前，还是写一些集成测试比较好。普通的`Solana`项目主要是通过`TypeScript(JavaScript)`进行测试，我们同样也使用 TypeScript。

第一步，我们在当前目录中需要初始化一个`NodeJS`项目。在项目根目录创建一个`package.json`文件。

```json
{
  "name": "faucet",
  "version": "1.0.0",
  "scripts": {
    "test": "anchor test"
  },
  "private": true
}
```

接下来，我们创建一个单元测试的文件，可以直接把 `tests` 目录下的 JS 文件重命名成： `./tests/faucet.spec.ts`

在开始写单元测试之前，我们需要安装一些依赖库。在终端中执行以下命令：

```bash
$ npm install --save @project-serum/anchor @project-serum/serum @project-serum/common @solana/spl-token
$ npm install --save-dev @types/mocha assert
```

因为我们计划用`TypeScript`编写测试脚本，所以还需要添加 `tsconfig.json` 文件

```json
// tsconfig.json
{
  "compilerOptions": {
    "esModuleInterop": true,
    "module": "CommonJS",
    "moduleResolution": "node",
    "strictNullChecks": true,
    "baseUrl": "."
  },
  "exclude": [
    "node_modules"
  ],
  "include": [
    "./tests/**/*"
  ]
}
```

然后把 `faucet.test.ts` 文件内容替换成

```typescript
import * as anchor from "@project-serum/anchor";

describe("faucet", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  it("Is initialized!", async () => {
    // Add your test here.
    const program = anchor.workspace.Faucet;
    const tx = await program.rpc.initialize();
    console.log("Your transaction signature", tx);
  });
});

```

这时候执行`npm run test`，会获得一个错误信息：`Error: Unable to read keypair file`

因为我们没有给`Anchor`指定正确的`Account`文件地址。

如果还没有创建过`solana keypair`可以执行：`solana-keygen new`。

接着修改 `./Anchor.toml`

```yaml
cluster = "localnet"
wallet = "~/.config/solana/id.json"
```

接下来可以正式开始写单元测试。具体单元测试的内容可以参看: [faucet.spec.ts](./tests/faucet.spec.ts)

### 部署 Program

在本地测试执行通过之后，就可以部署到测试网络。`Anchor`提供了非常方便的命令行工具，只需要几条简单的指令就可以完成部署和初始化。

我们还需要为我们的`Faucet`写一个初始化脚本。

首先添加依赖

```javascript
const { Program, Provider, Wallet, web3, workspace, BN } = require("@project-serum/anchor");
const { TokenInstructions } = require('@project-serum/serum');
const { createMint } = require("@project-serum/common")
```

为了方便我们为`Faucet`创建`SPL Token`，我们需要在 `deploy.js` 中增加一个新的函数

```javascript
/**
 * tokenConfig: { symbol: string, name: string, decimals: number } 
 */
const createToken = async (provider, program, tokenConfig) => {
  const tokenOwnerAccount = new web3.Account();

  const [tokenAuthority, tokenNonce] = await web3.PublicKey.findProgramAddress(
    [tokenOwnerAccount.publicKey.toBuffer()],
    program.programId
  );

  const splToken = await createMint(
    provider,
    tokenAuthority,
    tokenConfig.decimals
  );

  console.log(`Created ${tokenConfig.symbol} Token`, splToken.toBase58());

  return {
    tokenOwnerAccount,
    splToken,
    tokenNonce,
    tokenAuthority,
  };
}
```

这个函数会创建一种新的`TokenMint`并且把`MintAuthority`、创建PDA时的`seed`、`bump_seed`一同返回。

还记得在`drip`方法中，我们尝试通过一个`PDA`签名调用`MintTo`。为了保证`PDA`确实有mint权限，我们需要在`CreateMint`时将相同的`PDA`设置成`mintAuthority`。

所以我们需要将`CreateToken`的返回值作为初始化参数传入到`FaucetProgram`中。

接下来修改`deploy`主函数

```javascript
module.exports = async function (provider) {
  anchor.setProvider(provider);

  const faucetProgram = workspace.Faucet;
  const wallet = provider.wallet;

  // 币种配置
  const tokenConfigs = [
    {
      symbol: 'btc',
      name: 'Wrapped Bitcoin',
      decimals: 8,
      dripVolume: new BN(10 ** 8)
    },
    {
      symbol: 'eth',
      name: 'Wrapped Ether',
      decimals: 8,
      dripVolume: new BN(10 ** 8)
    }
  ];

  for (const tokenConfig of tokenConfigs) {
    const { tokenOwnerAccount: faucetConfigAccount, splToken, tokenNonce, tokenAuthority } = await createToken(provider, faucetProgram, tokenConfig);

    await faucetProgram.rpc.initialize(tokenNonce, tokenConfig.dripVolume, {
      accounts: {
        faucetConfig: faucetConfigAccount.publicKey,
        tokenMint: splToken,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
        tokenAuthority,
        rent: web3.SYSVAR_RENT_PUBKEY
      },
      signers: [faucetConfigAccount],
      instructions: [
        await faucetProgram.account.faucetConfig.createInstruction(faucetConfigAccount)
      ],
    });
  }
}
```

这样就完成了`migration`脚本。

我们在`package.json`里加上部署指令

```json
// ...
"scripts": {
    // ...
    "build": "anchor build",
    "predeploy:devnet": "npm run build",
    "deploy:devnet": "anchor deploy --url https://devnet.solana.com"
},
// ...
```
在部署之前需要获取一些`SOL`作为燃料

```bash
solana airdrop 5 <你的钱包地址> --url https://devnet.solana.com
```

然后就可以通过以下指令部署到开发网络

```bash
npm run deploy:devnet
```

部署完成之后可以看到控制台输出

```
Program Id: <program-id>

Deploy success
```
