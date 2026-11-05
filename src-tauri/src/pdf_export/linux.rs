use super::{complete, Job};
use std::{cell::RefCell, rc::Rc};
use webkit2gtk::PrintOperationExt;

pub(super) fn print(view: tauri::webview::PlatformWebview, job: Job) {
    // Express orientation in the physical paper dimensions. GTK/WebKit's
    // landscape rotation can otherwise scale asymmetric margins differently
    // during page layout and drawing (verified with the native PDF regression).
    let (width, height) = job.payload.options.page_dimensions();
    let setup = gtk::PageSetup::new();
    let paper = gtk::PaperSize::new_custom("marknext", "MarkNext", width, height, gtk::Unit::Mm);
    setup.set_paper_size(&paper);
    setup.set_orientation(gtk::PageOrientation::Portrait);
    let margins = &job.payload.options.margins;
    setup.set_top_margin(margins.top, gtk::Unit::Mm);
    setup.set_right_margin(margins.right, gtk::Unit::Mm);
    setup.set_bottom_margin(margins.bottom, gtk::Unit::Mm);
    setup.set_left_margin(margins.left, gtk::Unit::Mm);
    let settings = gtk::PrintSettings::new();
    settings.set_paper_size(&paper);
    settings.set_orientation(gtk::PageOrientation::Portrait);
    // GTK localizes this printer's name using its own domain, independently
    // of the application's interface language. Never select a default printer.
    settings.set_printer(&gtk::glib::dgettext(Some("gtk30"), "Print to File"));
    settings.set("output-file-format", Some("pdf"));
    let output = match tauri::Url::from_file_path(&job.temporary_pdf) {
        Ok(url) => url,
        Err(_) => {
            complete(&job.completion, Err("Invalid temporary PDF path".into()));
            return;
        }
    };
    settings.set("output-uri", Some(output.as_str()));
    settings.set_print_pages(gtk::PrintPages::All);
    settings.set_scale(100.0);
    let operation = webkit2gtk::PrintOperation::new(&view.inner());
    operation.set_page_setup(&setup);
    operation.set_print_settings(&settings);
    let failure = Rc::new(RefCell::new(None));
    let failed = failure.clone();
    operation.connect_failed(move |_, error| {
        *failed.borrow_mut() = Some(error.to_string());
    });
    operation.connect_finished(move |_| {
        complete(
            &job.completion,
            match failure.borrow_mut().take() {
                Some(error) => Err(error),
                None => Ok(()),
            },
        );
    });
    operation.print();
}
