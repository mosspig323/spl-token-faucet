import { BN, getProvider, web3, workspace } from "@project-serum/anchor";
import {
  createMint,
  createTokenAccountInstrs,
  getMintInfo,
  getTokenAccount,
} from "@project-serum/common";
import { TokenInstructions } from "@project-serum/serum";
import assert from "assert";

describe("Faucet", () => {
  const provider = getProvider();
  const faucetProgram = workspace.Faucet;

  let testTokenMint: web3.PublicKey;
  let testTokenAuthority: web3.PublicKey;
  let nonce: number;
  let faucetConfig: web3.Keypair;

  const testTokenDecimals = 9;
  const dripVolume = new BN(10 ** testTokenDecimals);

  before(async () => {
    faucetConfig = web3.Keypair.generate();
    [testTokenAuthority, nonce] = await web3.PublicKey.findProgramAddress(
      [faucetConfig.publicKey.toBuffer()],
      faucetProgram.programId
    );
    testTokenMint = await createMint(
      provider,
      testTokenAuthority,
      testTokenDecimals
    );
  });

  describe("#initialize", () => {
    it("should init successful", async () => {
      await faucetProgram.rpc.initialize(nonce, dripVolume, {
        accounts: {
          faucetConfig: faucetConfig.publicKey,
          tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
          tokenMint: testTokenMint,
          tokenAuthority: testTokenAuthority,
          rent: web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [faucetConfig],
        instructions: [
          await faucetProgram.account.faucetConfig.createInstruction(
            faucetConfig
          ),
        ],
      });

      const faucetConfigAccount = await faucetProgram.account.faucetConfig(
        faucetConfig.publicKey
      );

      assert.strictEqual(
        faucetConfigAccount.tokenProgram.toBase58(),
        TokenInstructions.TOKEN_PROGRAM_ID.toBase58()
      );
      assert.strictEqual(
        faucetConfigAccount.tokenMint.toBase58(),
        testTokenMint.toBase58()
      );
      assert.strictEqual(
        faucetConfigAccount.tokenAuthority.toBase58(),
        testTokenAuthority.toBase58()
      );
      assert.strictEqual(faucetConfigAccount.nonce, nonce);
      assert.strictEqual(
        faucetConfigAccount.dripVolume.toNumber(),
        dripVolume.toNumber()
      );
    });
  });

  describe("#drip", () => {
    it("should drip successful", async () => {
      const signers: web3.Keypair[] = [];
      const instructions: web3.TransactionInstruction[] = [];
      const receiver = web3.Keypair.generate();
      const receiverTokenAccount = web3.Keypair.generate();
      instructions.push(
        ...(await createTokenAccountInstrs(
          provider,
          receiverTokenAccount.publicKey,
          testTokenMint,
          receiver.publicKey
        ))
      );
      signers.push(receiverTokenAccount);

      const tokenMintInfo = await getMintInfo(provider, testTokenMint);
      await faucetProgram.rpc.drip({
        accounts: {
          faucetConfig: faucetConfig.publicKey,
          receiver: receiverTokenAccount.publicKey,
          tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
          tokenMint: testTokenMint,
          tokenAuthority: tokenMintInfo.mintAuthority,
        },
        instructions: instructions.length ? instructions : undefined,
        signers: signers.length ? signers : undefined,
      });

      const tokenAccount = await getTokenAccount(
        provider,
        receiverTokenAccount.publicKey
      );

      assert.strictEqual(tokenAccount.amount.toNumber(), dripVolume.toNumber());
    });
  });
});
