use sha2::{Digest, Sha256};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[derive(PartialEq, Eq)]
struct TargetState {
    resolved: PathBuf,
    digest: Option<Vec<u8>>,
}

fn state(path: &Path) -> io::Result<TargetState> {
    let resolved = match fs::canonicalize(path) {
        Ok(path) => path,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| io::Error::other("Invalid PDF directory"))?;
            fs::canonicalize(parent)?.join(
                path.file_name()
                    .ok_or_else(|| io::Error::other("Invalid PDF filename"))?,
            )
        }
        Err(error) => return Err(error),
    };
    let digest = match fs::read(path) {
        Ok(bytes) => Some(Sha256::digest(bytes).to_vec()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    Ok(TargetState { resolved, digest })
}

pub(super) struct OutputTarget {
    path: PathBuf,
    expected: TargetState,
}
impl OutputTarget {
    pub fn new(path: PathBuf, source: Option<&str>) -> io::Result<Self> {
        let expected = state(&path)?;
        if source.and_then(|path| fs::canonicalize(path).ok()).as_ref() == Some(&expected.resolved)
        {
            return Err(io::Error::other(
                "The PDF must not replace the source document",
            ));
        }
        Ok(Self { path, expected })
    }
    pub fn write(&self, bytes: &[u8]) -> io::Result<()> {
        crate::document::guarded_atomic_write(&self.path, bytes, || {
            if state(&self.path)? != self.expected {
                return Err(io::Error::other(
                    "The PDF destination changed while exporting. Choose the destination again.",
                ));
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf_export::{TemporaryExport, SEQUENCE};
    use std::sync::atomic::Ordering;
    fn directory() -> TemporaryExport {
        TemporaryExport::new(&format!(
            "pdf-output-test-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
        .unwrap()
    }
    #[test]
    fn pdf_output_replaces_only_the_captured_destination() {
        let directory = directory();
        let path = directory.0.join("out.pdf");
        fs::write(&path, b"old").unwrap();
        let output = OutputTarget::new(path.clone(), None).unwrap();
        output.write(b"%PDF-new").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"%PDF-new");
        let output = OutputTarget::new(path.clone(), None).unwrap();
        fs::write(&path, b"external").unwrap();
        assert!(output.write(b"%PDF-mine").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external");
    }
    #[test]
    fn pdf_output_keeps_files_created_while_rendering() {
        let directory = directory();
        let path = directory.0.join("out.pdf");
        let output = OutputTarget::new(path.clone(), None).unwrap();
        fs::write(&path, b"created elsewhere").unwrap();
        assert!(output.write(b"%PDF-mine").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"created elsewhere");
    }
    #[cfg(unix)]
    #[test]
    fn pdf_output_rejects_source_aliases_and_late_symlink_changes() {
        use std::os::unix::fs::symlink;
        let directory = directory();
        let source = directory.0.join("source.md");
        let old = directory.0.join("old.pdf");
        let alias = directory.0.join("alias.pdf");
        fs::write(&source, b"source content").unwrap();
        fs::write(&old, b"old PDF").unwrap();
        symlink(&source, &alias).unwrap();
        assert!(OutputTarget::new(alias.clone(), source.to_str()).is_err());
        fs::remove_file(&alias).unwrap();
        symlink(&old, &alias).unwrap();
        let output = OutputTarget::new(alias.clone(), source.to_str()).unwrap();
        fs::remove_file(&alias).unwrap();
        symlink(&source, &alias).unwrap();
        assert!(output.write(b"%PDF-mine").is_err());
        assert_eq!(fs::read(&source).unwrap(), b"source content");
    }
}
