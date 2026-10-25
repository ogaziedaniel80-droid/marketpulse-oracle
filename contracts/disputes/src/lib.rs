#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct DisputesContract;

#[contractimpl]
impl DisputesContract {
    pub fn version(_env: Env) -> u32 {
        1
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_version() {
        let env = Env::default();
        let contract_id = env.register(DisputesContract, ());
        let client = DisputesContractClient::new(&env, &contract_id);
        assert_eq!(client.version(), 1);
    }
}
