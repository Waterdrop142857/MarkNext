use super::options::PdfOptions;
use super::{complete, options::Orientation, Job};
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    },
    PrintToPdfCompletedHandler,
};
use windows::core::{Interface, HSTRING};

pub(super) fn print(view: tauri::webview::PlatformWebview, job: Job, options: PdfOptions) {
    // Tauri invokes this closure on the owning UI/COM thread. The WebView2
    // interfaces and settings stay local to it; only completion crosses threads.
    let result = unsafe { start(view, &job, &options) };
    if let Err(error) = result {
        complete(&job.completion, Err(error.to_string()));
    }
}

unsafe fn start(
    view: tauri::webview::PlatformWebview,
    job: &Job,
    options: &PdfOptions,
) -> windows::core::Result<()> {
    let engine: ICoreWebView2_7 = view.controller().CoreWebView2()?.cast()?;
    let environment: ICoreWebView2Environment6 = view.environment().cast()?;
    let settings = environment.CreatePrintSettings()?;
    let (width, height) = options.paper_dimensions();
    settings.SetPageWidth(width / 25.4)?;
    settings.SetPageHeight(height / 25.4)?;
    settings.SetOrientation(match options.orientation {
        Orientation::Portrait => COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
        Orientation::Landscape => COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
    })?;
    settings.SetMarginTop(options.margins.top / 25.4)?;
    settings.SetMarginRight(options.margins.right / 25.4)?;
    settings.SetMarginBottom(options.margins.bottom / 25.4)?;
    settings.SetMarginLeft(options.margins.left / 25.4)?;
    settings.SetScaleFactor(1.0)?;
    settings.SetShouldPrintBackgrounds(true)?;
    settings.SetShouldPrintSelectionOnly(false)?;
    settings.SetShouldPrintHeaderAndFooter(false)?;
    let completion = job.completion.clone();
    let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, success| {
        let result = result.map_err(|error| error.to_string()).and_then(|_| {
            if success {
                Ok(())
            } else {
                Err("WebView2 could not create the PDF".into())
            }
        });
        complete(&completion, result);
        Ok(())
    }));
    engine.PrintToPdf(
        &HSTRING::from(job.temporary_output.as_os_str()),
        &settings,
        &handler,
    )
}
