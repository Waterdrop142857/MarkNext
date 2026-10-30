use sha2::{Digest, Sha256};
use std::io;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum FileEncoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
}

#[derive(Debug, serde::Serialize)]
pub(crate) struct ReadDocument {
    pub(super) content: String,
    pub(super) encoding: FileEncoding,
    pub(super) bom: bool,
    pub(super) version: String,
    pub(super) stamp: String,
}

pub(super) fn content_version(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn decode_document(bytes: &[u8], fallback: FileEncoding) -> io::Result<ReadDocument> {
    let version = content_version(bytes);
    if bytes.starts_with(&[0xff, 0xfe, 0, 0]) || bytes.starts_with(&[0, 0, 0xfe, 0xff]) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "UTF-32 is not supported",
        ));
    }
    let (bytes, encoding, bom) = if let Some(text) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        (text, FileEncoding::Utf8Bom, true)
    } else if let Some(text) = bytes.strip_prefix(&[0xff, 0xfe]) {
        (text, FileEncoding::Utf16Le, true)
    } else if let Some(text) = bytes.strip_prefix(&[0xfe, 0xff]) {
        (text, FileEncoding::Utf16Be, true)
    } else {
        (
            bytes,
            if fallback == FileEncoding::Utf8Bom {
                FileEncoding::Utf8
            } else {
                fallback
            },
            false,
        )
    };
    let content = match encoding {
        FileEncoding::Utf8 | FileEncoding::Utf8Bom => std::str::from_utf8(bytes)
            .map(str::to_owned)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?,
        FileEncoding::Utf16Le | FileEncoding::Utf16Be => {
            if bytes.len() % 2 != 0 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "UTF-16 has an incomplete code unit",
                ));
            }
            let units: Vec<u16> = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|unit| {
                    if encoding == FileEncoding::Utf16Le {
                        u16::from_le_bytes(*unit)
                    } else {
                        u16::from_be_bytes(*unit)
                    }
                })
                .collect();
            String::from_utf16(&units)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
        }
    };
    Ok(ReadDocument {
        content,
        encoding,
        bom,
        version,
        stamp: String::new(),
    })
}

pub(crate) fn encode_document(content: &str, encoding: FileEncoding, bom: bool) -> Vec<u8> {
    let mut bytes = Vec::new();
    match encoding {
        FileEncoding::Utf8 | FileEncoding::Utf8Bom => {
            if bom || encoding == FileEncoding::Utf8Bom {
                bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            }
            bytes.extend_from_slice(content.as_bytes());
        }
        FileEncoding::Utf16Le | FileEncoding::Utf16Be => {
            if bom {
                bytes.extend_from_slice(if encoding == FileEncoding::Utf16Le {
                    &[0xff, 0xfe]
                } else {
                    &[0xfe, 0xff]
                });
            }
            for unit in content.encode_utf16() {
                bytes.extend_from_slice(&if encoding == FileEncoding::Utf16Le {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
        }
    }
    bytes
}
