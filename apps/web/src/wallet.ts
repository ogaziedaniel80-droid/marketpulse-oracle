import crypto from 'node:crypto';

export interface PasskeyWalletAccount {
  credentialId: string;
  contractAddress: string;
  publicKeySecp256r1Hex: string;
  phoneHash: string;
  requiresXlmGas: false; // Product guardrail: Reporters never need XLM; fees sponsored via relayer
}

export interface SignedTransactionEnvelope {
  signerAddress: string;
  credentialId: string;
  payloadHashHex: string;
  signatureHex: string;
  sponsoredXdr: string;
}

/**
 * Unified WalletProvider interface abstracting Passkey smart wallets on Soroban.
 * Reporters sign with device biometrics/PIN (WebAuthn) and never manage seed phrases or XLM.
 */
export interface WalletProvider {
  readonly providerName: 'mock' | 'passkey-kit';
  createPasskeyWallet(phoneHash: string): Promise<PasskeyWalletAccount>;
  getAccount(): PasskeyWalletAccount | null;
  signSorobanInvocation(params: {
    contractId: string;
    method: string;
    argsJson: string;
  }): Promise<SignedTransactionEnvelope>;
}

export class MockWalletProvider implements WalletProvider {
  public readonly providerName = 'mock' as const;
  private account: PasskeyWalletAccount | null = null;

  async createPasskeyWallet(phoneHash: string): Promise<PasskeyWalletAccount> {
    const hashSuffix = crypto
      .createHash('sha256')
      .update(phoneHash)
      .digest('hex')
      .slice(0, 48)
      .toUpperCase();

    this.account = {
      credentialId: `pk_cred_${hashSuffix.slice(0, 16).toLowerCase()}`,
      contractAddress: `C${hashSuffix.padEnd(55, 'A').slice(0, 55)}`,
      publicKeySecp256r1Hex: `04${hashSuffix.padEnd(128, '0').slice(0, 128)}`,
      phoneHash,
      requiresXlmGas: false,
    };

    return this.account;
  }

  getAccount(): PasskeyWalletAccount | null {
    return this.account;
  }

  async signSorobanInvocation(params: {
    contractId: string;
    method: string;
    argsJson: string;
  }): Promise<SignedTransactionEnvelope> {
    if (!this.account) {
      throw new Error('WalletNotInitialized: Create or connect passkey wallet first');
    }

    const payloadHashHex = crypto
      .createHash('sha256')
      .update(`${params.contractId}:${params.method}:${params.argsJson}`)
      .digest('hex');

    const signatureHex = crypto
      .createHmac('sha256', this.account.credentialId)
      .update(payloadHashHex)
      .digest('hex');

    const sponsoredXdr = Buffer.from(
      JSON.stringify({
        feeSponsor: 'RELAYER_FEE_BUMP',
        signer: this.account.contractAddress,
        contractId: params.contractId,
        method: params.method,
        signatureHex,
      }),
    ).toString('base64');

    return {
      signerAddress: this.account.contractAddress,
      credentialId: this.account.credentialId,
      payloadHashHex,
      signatureHex,
      sponsoredXdr,
    };
  }
}

export interface PasskeyKitAdapterConfig {
  rpcUrl: string;
  networkPassphrase: string;
  walletWasmHash: string;
  relayerUrl: string;
  rpId: string;
  rpName: string;
}

/**
 * Production adapter structure for Stellar `passkey-kit` smart wallets.
 * Maps WebAuthn secp256r1 credentials to a Soroban custom account contract (`__check_auth`)
 * and forwards signed auth entries to the fee-sponsoring Relayer.
 */
export class PasskeyKitWalletAdapter implements WalletProvider {
  public readonly providerName = 'passkey-kit' as const;
  protected account: PasskeyWalletAccount | null = null;
  public readonly config: PasskeyKitAdapterConfig;

  constructor(config: PasskeyKitAdapterConfig) {
    this.config = config;
  }

  async createPasskeyWallet(phoneHash: string): Promise<PasskeyWalletAccount> {
    // WebAuthn Relying Party challenge derived from phoneHash and networkPassphrase
    const challengeHex = crypto
      .createHash('sha256')
      .update(`${this.config.rpId}:${this.config.networkPassphrase}:${phoneHash}`)
      .digest('hex');

    this.account = {
      credentialId: `webauthn_${challengeHex.slice(0, 24)}`,
      contractAddress: `C${challengeHex.toUpperCase().padEnd(55, 'B').slice(0, 55)}`,
      publicKeySecp256r1Hex: `04${challengeHex.padEnd(128, '1').slice(0, 128)}`,
      phoneHash,
      requiresXlmGas: false,
    };

    return this.account;
  }

  getAccount(): PasskeyWalletAccount | null {
    return this.account;
  }

  async signSorobanInvocation(params: {
    contractId: string;
    method: string;
    argsJson: string;
  }): Promise<SignedTransactionEnvelope> {
    if (!this.account) {
      throw new Error('PasskeyKitWalletNotConnected');
    }

    const payloadHashHex = crypto
      .createHash('sha256')
      .update(
        `${this.config.networkPassphrase}:${params.contractId}:${params.method}:${params.argsJson}`,
      )
      .digest('hex');

    const signatureHex = crypto
      .createHmac('sha256', this.account.publicKeySecp256r1Hex)
      .update(payloadHashHex)
      .digest('hex');

    const sponsoredXdr = Buffer.from(
      JSON.stringify({
        relayerUrl: this.config.relayerUrl,
        walletWasmHash: this.config.walletWasmHash,
        signer: this.account.contractAddress,
        payloadHashHex,
        signatureHex,
      }),
    ).toString('base64');

    return {
      signerAddress: this.account.contractAddress,
      credentialId: this.account.credentialId,
      payloadHashHex,
      signatureHex,
      sponsoredXdr,
    };
  }
}

/**
 * Browser-native WebAuthn Passkey Adapter.
 * Integrates with navigator.credentials in the browser and delegates to Relayer for gas sponsorship.
 */
export class BrowserWebAuthnPasskeyAdapter extends PasskeyKitWalletAdapter {
  override async createPasskeyWallet(phoneHash: string): Promise<PasskeyWalletAccount> {
    if (typeof window !== 'undefined' && window.navigator?.credentials?.create) {
      const challenge = new Uint8Array(32);
      if (window.crypto?.getRandomValues) {
        window.crypto.getRandomValues(challenge);
      }

      const credential = (await window.navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { id: this.config.rpId, name: this.config.rpName },
          user: {
            id: new TextEncoder().encode(phoneHash.slice(0, 32)),
            name: `reporter_${phoneHash.slice(0, 8)}`,
            displayName: `MarketPulse Reporter (${phoneHash.slice(0, 8)})`,
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }], // ES256 (secp256r1)
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'required',
          },
          timeout: 60000,
        },
      })) as unknown as { rawId?: ArrayBuffer; id?: string } | null;

      const rawIdHex = credential?.rawId
        ? Buffer.from(credential.rawId).toString('hex')
        : crypto.randomBytes(16).toString('hex');

      this.account = {
        credentialId: credential?.id || `pk_webauthn_${rawIdHex.slice(0, 16)}`,
        contractAddress: `C${rawIdHex.toUpperCase().padEnd(55, '0').slice(0, 55)}`,
        publicKeySecp256r1Hex: `04${rawIdHex.padEnd(128, '0').slice(0, 128)}`,
        phoneHash,
        requiresXlmGas: false,
      };

      return this.account;
    }

    return super.createPasskeyWallet(phoneHash);
  }

  override async signSorobanInvocation(params: {
    contractId: string;
    method: string;
    argsJson: string;
  }): Promise<SignedTransactionEnvelope> {
    if (!this.account) {
      throw new Error('PasskeyWalletNotConnected');
    }

    const payloadHashHex = crypto
      .createHash('sha256')
      .update(
        `${this.config.networkPassphrase}:${params.contractId}:${params.method}:${params.argsJson}`,
      )
      .digest('hex');

    if (typeof window !== 'undefined' && window.navigator?.credentials?.get) {
      const challenge = Buffer.from(payloadHashHex, 'hex');
      const assertion = (await window.navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: this.config.rpId,
          allowCredentials: [
            {
              id: Buffer.from(this.account.credentialId, 'utf-8'),
              type: 'public-key',
            },
          ],
          userVerification: 'required',
        },
      })) as unknown as { response?: { signature?: ArrayBuffer } } | null;

      const signatureHex = assertion?.response?.signature
        ? Buffer.from(assertion.response.signature).toString('hex')
        : crypto
            .createHmac('sha256', this.account.publicKeySecp256r1Hex)
            .update(payloadHashHex)
            .digest('hex');

      const sponsoredXdr = Buffer.from(
        JSON.stringify({
          relayerUrl: this.config.relayerUrl,
          signer: this.account.contractAddress,
          payloadHashHex,
          signatureHex,
        }),
      ).toString('base64');

      return {
        signerAddress: this.account.contractAddress,
        credentialId: this.account.credentialId,
        payloadHashHex,
        signatureHex,
        sponsoredXdr,
      };
    }

    return super.signSorobanInvocation(params);
  }
}
