use super::options::PdfOptions;
use super::{complete, options::Orientation, Job};
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{
    NSPaperOrientation, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode,
};
use objc2_foundation::{NSObjectProtocol, NSSize, NSString, NSURL};
use objc2_web_kit::WKWebView;

pub(super) fn print(view: tauri::webview::PlatformWebview, job: Job, options: PdfOptions) {
    // with_webview runs on the main thread. Tauri owns this live WKWebView
    // for the whole print operation; no Objective-C reference escapes it.
    let result = unsafe {
        let webview = &*view.inner().cast::<WKWebView>();
        if !webview.respondsToSelector(objc2::sel!(printOperationWithPrintInfo:)) {
            complete(
                &job.completion,
                Err("Native PDF export requires macOS 11 or later".into()),
            );
            return;
        }
        let info = NSPrintInfo::new();
        let (width, height) = options.paper_dimensions();
        let points = |millimeters: f64| millimeters * 72.0 / 25.4;
        info.setPaperSize(NSSize::new(points(width), points(height)));
        info.setOrientation(match options.orientation {
            Orientation::Portrait => NSPaperOrientation::Portrait,
            Orientation::Landscape => NSPaperOrientation::Landscape,
        });
        info.setScalingFactor(1.0);
        info.setTopMargin(points(options.margins.top));
        info.setRightMargin(points(options.margins.right));
        info.setBottomMargin(points(options.margins.bottom));
        info.setLeftMargin(points(options.margins.left));
        info.setHorizontallyCentered(false);
        info.setVerticallyCentered(false);
        info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
        info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
        info.setJobDisposition(NSPrintSaveJob);
        let path = NSString::from_str(&job.temporary_output.to_string_lossy());
        let url = NSURL::fileURLWithPath(&path);
        info.dictionary()
            .setObject_forKey(&url, ProtocolObject::from_ref(NSPrintJobSavingURL));
        let operation = webview.printOperationWithPrintInfo(&info);
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        operation.setCanSpawnSeparateThread(false);
        operation.setJobTitle(Some(&NSString::from_str(&job.payload.snapshot().title)));
        operation.runOperation()
    };
    complete(
        &job.completion,
        if result {
            Ok(())
        } else {
            Err("macOS could not create the PDF".into())
        },
    );
}
