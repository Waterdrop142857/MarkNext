mod codec;
pub(crate) mod commands;
pub(crate) mod images;
mod io;

use codec::{content_version, decode_document};
pub(crate) use codec::{encode_document, FileEncoding, ReadDocument};
#[cfg(test)]
use images::image_file_path;
pub(crate) use io::{atomic_write, FileError};
use io::{
    canonical_document_path_sync, disk_stamp, file_version_sync, read_file_sync, write_file_sync,
};
#[cfg(test)]
use io::{checked_atomic_write, TEMP_FILE_SEQUENCE};

#[cfg(test)]
mod tests {
    use super::{atomic_write, decode_document, encode_document, FileEncoding};
    use std::fs;

    #[test]
    fn document_paths_resolve_existing_aliases_and_new_file_parents() {
        let directory = std::env::temp_dir().join(format!(
            "marknext-path-{}-{}",
            std::process::id(),
            super::TEMP_FILE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(directory.join("nested")).unwrap();
        fs::write(directory.join("note.md"), "text").unwrap();
        let canonical = fs::canonicalize(&directory).unwrap();
        assert_eq!(
            super::canonical_document_path_sync(&directory.join("nested/../note.md")).unwrap(),
            canonical.join("note.md").to_str().unwrap()
        );
        assert_eq!(
            super::canonical_document_path_sync(&directory.join("nested/../new.md")).unwrap(),
            canonical.join("new.md").to_str().unwrap()
        );
        assert!(super::canonical_document_path_sync(&directory).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(directory.join("note.md"), directory.join("alias.md"))
                .unwrap();
            assert_eq!(
                super::canonical_document_path_sync(&directory.join("alias.md")).unwrap(),
                canonical.join("note.md").to_str().unwrap()
            );
            std::os::unix::fs::symlink(&directory, directory.join("alias-folder")).unwrap();
            assert_eq!(
                super::canonical_document_path_sync(&directory.join("alias-folder/new.md"))
                    .unwrap(),
                canonical.join("new.md").to_str().unwrap()
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn encoding_writes_known_bytes_and_bom() {
        assert_eq!(
            encode_document("A中", FileEncoding::Utf8, false),
            "A中".as_bytes()
        );
        assert_eq!(
            encode_document("A中", FileEncoding::Utf8Bom, true),
            [0xef, 0xbb, 0xbf, 0x41, 0xe4, 0xb8, 0xad]
        );
        assert_eq!(
            encode_document("A中", FileEncoding::Utf16Le, true),
            [0xff, 0xfe, 0x41, 0, 0x2d, 0x4e]
        );
        assert_eq!(
            encode_document("A中", FileEncoding::Utf16Be, true),
            [0xfe, 0xff, 0, 0x41, 0x4e, 0x2d]
        );
    }

    #[test]
    fn bom_detection_overrides_default_encoding_and_roundtrips_unicode() {
        for encoding in [
            FileEncoding::Utf8Bom,
            FileEncoding::Utf16Le,
            FileEncoding::Utf16Be,
        ] {
            for content in ["", "# 你好 📝\r\n\n$$\nx²\n$$", "\u{feff}literal BOM"] {
                let bytes = encode_document(content, encoding, true);
                let result = decode_document(&bytes, FileEncoding::Utf8).unwrap();
                assert_eq!(result.content, content);
                assert_eq!(result.encoding, encoding);
                assert!(result.bom);
                assert_eq!(
                    encode_document(&result.content, result.encoding, result.bom),
                    bytes
                );
            }
        }
    }

    #[test]
    fn bomless_documents_use_default_and_keep_bom_absent() {
        for encoding in [
            FileEncoding::Utf8,
            FileEncoding::Utf16Le,
            FileEncoding::Utf16Be,
        ] {
            let bytes = encode_document("中文 📝", encoding, false);
            let result = decode_document(&bytes, encoding).unwrap();
            assert_eq!(result.content, "中文 📝");
            assert_eq!(result.encoding, encoding);
            assert!(!result.bom);
            assert_eq!(
                encode_document(&result.content, result.encoding, result.bom),
                bytes
            );
        }
        let result = decode_document(b"plain", FileEncoding::Utf8Bom).unwrap();
        assert_eq!(result.encoding, FileEncoding::Utf8);
        assert!(!result.bom);
    }

    #[test]
    fn invalid_encoding_fails_without_silent_replacement_characters() {
        for (bytes, fallback) in [
            (vec![0xff], FileEncoding::Utf8),
            (vec![0xff, 0xfe, 0x41], FileEncoding::Utf8),
            (vec![0xfe, 0xff, 0xd8, 0], FileEncoding::Utf8),
            (vec![0, 0xd8], FileEncoding::Utf16Le),
            (vec![0xff, 0xfe, 0, 0, 0x41, 0, 0, 0], FileEncoding::Utf8),
        ] {
            assert!(decode_document(&bytes, fallback).is_err());
        }
    }

    #[test]
    fn native_commands_write_real_encoded_files_and_preserve_bytes_on_roundtrip() {
        let directory =
            std::env::temp_dir().join(format!("marknext-encoding-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        for encoding in [
            FileEncoding::Utf8,
            FileEncoding::Utf8Bom,
            FileEncoding::Utf16Le,
            FileEncoding::Utf16Be,
        ] {
            let file = directory.join(format!("{encoding:?}.md"));
            let path = file.to_str().unwrap().to_owned();
            super::write_file_sync(
                path.clone(),
                "中文 📝".to_owned(),
                Some(encoding),
                None,
                "missing".into(),
            )
            .unwrap();
            let expected = encode_document("中文 📝", encoding, encoding != FileEncoding::Utf8);
            assert_eq!(fs::read(&file).unwrap(), expected);
            let document = super::read_file_sync(path.clone(), None).unwrap();
            assert_eq!(document.content, "中文 📝");
            super::write_file_sync(
                path,
                document.content,
                Some(document.encoding),
                Some(document.bom),
                document.version,
            )
            .unwrap();
            assert_eq!(fs::read(&file).unwrap(), expected);
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn image_authorization_accepts_only_existing_image_files() {
        let directory =
            std::env::temp_dir().join(format!("marknext-image-scope-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let image = directory.join("图片 (1).SVG");
        let text = directory.join("note.md");
        fs::write(&image, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>").unwrap();
        fs::write(&text, "not an image").unwrap();
        assert_eq!(
            super::image_file_path(&image).unwrap(),
            fs::canonicalize(&image).unwrap()
        );
        assert!(super::image_file_path(&text).is_err());
        assert!(super::image_file_path(&directory).is_err());
        assert!(super::image_file_path(&directory.join("missing.png")).is_err());
        #[cfg(unix)]
        {
            let link = directory.join("disguised.png");
            std::os::unix::fs::symlink(&text, &link).unwrap();
            assert!(super::image_file_path(&link).is_err());
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn atomic_write_replaces_content_and_preserves_previous_file_on_error() {
        let directory = std::env::temp_dir().join(format!(
            "marknext-atomic-write-{}-{}",
            std::process::id(),
            super::TEMP_FILE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir(&directory).unwrap();
        let file = directory.join("document.md");
        fs::write(&file, "before").unwrap();

        atomic_write(&file, b"after").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "after");

        let original_permissions = fs::metadata(&file).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&file, permissions).unwrap();
        assert!(atomic_write(&file, b"lost").is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "after");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);

        fs::set_permissions(&file, original_permissions).unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn guarded_saves_reject_changed_deleted_and_newly_created_targets() {
        let dir = std::env::temp_dir().join(format!("marknext-conflict-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        let path = file.to_string_lossy().to_string();
        fs::write(&file, "base").unwrap();
        let baseline = super::file_version_sync(path.clone()).unwrap();
        fs::write(&file, "external").unwrap();
        let error =
            super::write_file_sync(path.clone(), "mine".into(), None, None, baseline.clone())
                .unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(fs::read_to_string(&file).unwrap(), "external");
        assert!(
            super::write_file_sync(path.clone(), "mine".into(), None, None, "missing".into())
                .is_err()
        );
        fs::remove_file(&file).unwrap();
        assert_eq!(
            super::write_file_sync(path.clone(), "mine".into(), None, None, baseline)
                .unwrap_err()
                .version
                .as_deref(),
            Some("missing")
        );
        let version =
            super::write_file_sync(path.clone(), "mine".into(), None, None, "missing".into())
                .unwrap();
        assert_eq!(version, super::file_version_sync(path).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_rechecks_after_temporary_write_and_cleans_up_on_conflict() {
        let dir =
            std::env::temp_dir().join(format!("marknext-late-conflict-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        fs::write(&file, "base").unwrap();
        let mut checks = 0;
        let error = super::checked_atomic_write(&file, b"mine", || {
            checks += 1;
            if checks == 2 {
                fs::write(&file, "late external edit")?;
                return Err(super::FileError {
                    code: "conflict",
                    message: "changed".into(),
                    version: None,
                });
            }
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(fs::read_to_string(file).unwrap(), "late external edit");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
