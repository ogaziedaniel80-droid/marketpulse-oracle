#![no_std]

pub mod constants;
pub mod errors;
pub mod interfaces;
pub mod math;
pub mod types;

pub use constants::*;
pub use errors::ContractError;
pub use interfaces::*;
pub use math::*;
pub use types::*;

pub fn version() -> u32 {
    1
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_version() {
        assert_eq!(version(), 1);
    }

    #[test]
    fn test_error_codes_are_stable() {
        assert_eq!(ContractError::AlreadyInitialized as u32, 1);
        assert_eq!(ContractError::Unauthorized as u32, 3);
        assert_eq!(ContractError::DeadlinePassed as u32, 4);
        assert_eq!(ContractError::DuplicateCommitment as u32, 23);
        assert_eq!(ContractError::UnderSubscribed as u32, 30);
    }
}
