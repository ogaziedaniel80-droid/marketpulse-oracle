export interface ContractClientConfig {
  contractId: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}

export interface PreparedInvocation {
  contractId: string;
  method: string;
  args: Record<string, unknown>;
  simulatedFeeStroops: string;
}

export class RegistryContract {
  public readonly contractId: string;
  public readonly rpcUrl: string;
  public readonly networkPassphrase: string;

  constructor(config: ContractClientConfig) {
    this.contractId = config.contractId;
    this.rpcUrl = config.rpcUrl || 'https://soroban-testnet.stellar.org';
    this.networkPassphrase = config.networkPassphrase || 'Test SDF Network ; September 2015';
  }

  prepareEnroll(reporter: string, attestationHex: string): PreparedInvocation {
    return {
      contractId: this.contractId,
      method: 'enroll',
      args: { reporter, attestation: attestationHex },
      simulatedFeeStroops: '100000',
    };
  }

  prepareVouch(voucher: string, vouchee: string, stakeAtRisk: bigint): PreparedInvocation {
    return {
      contractId: this.contractId,
      method: 'vouch',
      args: { voucher, vouchee, stake_at_risk: stakeAtRisk.toString() },
      simulatedFeeStroops: '120000',
    };
  }
}

export class RequestBoardContract {
  public readonly contractId: string;
  public readonly rpcUrl: string;
  public readonly networkPassphrase: string;

  constructor(config: ContractClientConfig) {
    this.contractId = config.contractId;
    this.rpcUrl = config.rpcUrl || 'https://soroban-testnet.stellar.org';
    this.networkPassphrase = config.networkPassphrase || 'Test SDF Network ; September 2015';
  }

  prepareCreateRequest(params: {
    requester: string;
    dataType: string;
    geohash: string;
    bounty: bigint;
    token: string;
    minStake: bigint;
    toleranceBps: number;
    commitWindowSeconds: number;
    revealWindowSeconds: number;
    challengeWindowSeconds: number;
    minReports: number;
    maxReports: number;
  }): PreparedInvocation {
    return {
      contractId: this.contractId,
      method: 'create_request',
      args: {
        requester: params.requester,
        data_type: params.dataType,
        geohash: params.geohash,
        bounty: params.bounty.toString(),
        token: params.token,
        min_stake: params.minStake.toString(),
        tolerance_bps: params.toleranceBps,
        commit_window: params.commitWindowSeconds,
        reveal_window: params.revealWindowSeconds,
        challenge_window: params.challengeWindowSeconds,
        min_reports: params.minReports,
        max_reports: params.maxReports,
      },
      simulatedFeeStroops: '250000',
    };
  }
}

export class ReportEngineContract {
  public readonly contractId: string;
  public readonly rpcUrl: string;
  public readonly networkPassphrase: string;

  constructor(config: ContractClientConfig) {
    this.contractId = config.contractId;
    this.rpcUrl = config.rpcUrl || 'https://soroban-testnet.stellar.org';
    this.networkPassphrase = config.networkPassphrase || 'Test SDF Network ; September 2015';
  }

  prepareCommit(reporter: string, requestId: number, commitmentHex: string, stake: bigint): PreparedInvocation {
    return {
      contractId: this.contractId,
      method: 'commit',
      args: {
        reporter,
        request_id: requestId,
        commitment: commitmentHex,
        stake: stake.toString(),
      },
      simulatedFeeStroops: '150000',
    };
  }

  prepareReveal(reporter: string, requestId: number, value: bigint, saltHex: string, evidenceHashHex: string): PreparedInvocation {
    return {
      contractId: this.contractId,
      method: 'reveal',
      args: {
        reporter,
        request_id: requestId,
        value: value.toString(),
        salt: saltHex,
        evidence_hash: evidenceHashHex,
      },
      simulatedFeeStroops: '180000',
    };
  }

  prepareResolve(caller: string, requestId: number): PreparedInvocation {
    return {
      contractId: this.contractId,
      method: 'resolve',
      args: { caller, request_id: requestId },
      simulatedFeeStroops: '450000',
    };
  }

  prepareClaim(reporter: string, requestId: number): PreparedInvocation {
    return {
      contractId: this.contractId,
      method: 'claim_payout',
      args: { reporter, request_id: requestId },
      simulatedFeeStroops: '120000',
    };
  }

  prepareFinalise(caller: string, requestId: number): PreparedInvocation {
    return {
      contractId: this.contractId,
      method: 'finalise',
      args: { caller, request_id: requestId },
      simulatedFeeStroops: '150000',
    };
  }
}

export class DisputesContract {
  public readonly contractId: string;
  public readonly rpcUrl: string;
  public readonly networkPassphrase: string;

  constructor(config: ContractClientConfig) {
    this.contractId = config.contractId;
    this.rpcUrl = config.rpcUrl || 'https://soroban-testnet.stellar.org';
    this.networkPassphrase = config.networkPassphrase || 'Test SDF Network ; September 2015';
  }

  prepareChallenge(challenger: string, requestId: number, bond: bigint, reasonSymbol: string): PreparedInvocation {
    return {
      contractId: this.contractId,
      method: 'challenge',
      args: { challenger, request_id: requestId, bond: bond.toString(), reason: reasonSymbol },
      simulatedFeeStroops: '200000',
    };
  }

  prepareRuleVote(panelMember: string, requestId: number, upheld: boolean): PreparedInvocation {
    return {
      contractId: this.contractId,
      method: 'rule',
      args: { panel_member: panelMember, request_id: requestId, upheld },
      simulatedFeeStroops: '120000',
    };
  }
}

export class OracleFeedContract {
  public readonly contractId: string;
  public readonly rpcUrl: string;
  public readonly networkPassphrase: string;

  constructor(config: ContractClientConfig) {
    this.contractId = config.contractId;
    this.rpcUrl = config.rpcUrl || 'https://soroban-testnet.stellar.org';
    this.networkPassphrase = config.networkPassphrase || 'Test SDF Network ; September 2015';
  }

  async getLatestObservation(dataType: string, geohash: string): Promise<PreparedInvocation> {
    return {
      contractId: this.contractId,
      method: 'get_latest',
      args: { data_type: dataType, geohash },
      simulatedFeeStroops: '50000',
    };
  }
}
