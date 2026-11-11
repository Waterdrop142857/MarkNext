use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Paper {
    A4,
    A5,
    B5,
    Letter,
    Custom,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Orientation {
    Portrait,
    Landscape,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Margins {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PdfOptions {
    pub paper: Paper,
    pub width: f64,
    pub height: f64,
    pub orientation: Orientation,
    #[serde(default, rename = "avoidPageBreaks")]
    pub avoid_page_breaks: bool,
    pub margins: Margins,
}
impl PdfOptions {
    pub fn paper_dimensions(&self) -> (f64, f64) {
        match self.paper {
            Paper::A4 => (210.0, 297.0),
            Paper::A5 => (148.0, 210.0),
            Paper::B5 => (176.0, 250.0),
            Paper::Letter => (215.9, 279.4),
            Paper::Custom => (self.width, self.height),
        }
    }
    pub fn page_dimensions(&self) -> (f64, f64) {
        let (width, height) = self.paper_dimensions();
        match self.orientation {
            Orientation::Portrait => (width, height),
            Orientation::Landscape => (height, width),
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        let (width, height) = self.page_dimensions();
        let margins = &self.margins;
        if [width, height]
            .into_iter()
            .any(|value| !value.is_finite() || !(50.0..=2000.0).contains(&value))
            || [margins.top, margins.right, margins.bottom, margins.left]
                .into_iter()
                .any(|value| !value.is_finite() || value < 0.0)
            || width - margins.left - margins.right < 20.0
            || height - margins.top - margins.bottom < 20.0
        {
            return Err("Invalid PDF paper size or margins".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options() -> PdfOptions {
        PdfOptions {
            paper: Paper::A4,
            width: 210.0,
            height: 297.0,
            orientation: Orientation::Portrait,
            avoid_page_breaks: false,
            margins: Margins {
                top: 20.0,
                right: 20.0,
                bottom: 20.0,
                left: 20.0,
            },
        }
    }
    #[test]
    fn pdf_page_sizes_and_orientation_match_the_printable_area() {
        let mut page = options();
        assert_eq!(page.page_dimensions(), (210.0, 297.0));
        page.paper = Paper::B5;
        page.orientation = Orientation::Landscape;
        assert_eq!(page.page_dimensions(), (250.0, 176.0));
        assert!(page.validate().is_ok());
        page.margins.top = 160.0;
        assert!(page.validate().is_err());
    }
    #[test]
    fn pdf_rejects_impossible_and_nonfinite_geometry() {
        let mut page = options();
        page.margins.left = -1.0;
        assert!(page.validate().is_err());
        page.margins.left = f64::NAN;
        assert!(page.validate().is_err());
        page = options();
        page.paper = Paper::Custom;
        page.width = 0.0;
        assert!(page.validate().is_err());
        page.width = 150.0;
        page.height = 100.0;
        assert!(page.validate().is_ok());
    }
}
