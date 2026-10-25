#![no_std]

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
}
