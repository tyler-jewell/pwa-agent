use thiserror::Error;

#[derive(Debug, Error)]
pub enum MsaError {
    #[error("{0}")]
    Msg(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("age crypto: {0}")]
    Age(String),
}

pub type Result<T> = std::result::Result<T, MsaError>;

impl From<String> for MsaError {
    fn from(s: String) -> Self {
        Self::Msg(s)
    }
}

impl From<&str> for MsaError {
    fn from(s: &str) -> Self {
        Self::Msg(s.to_string())
    }
}
