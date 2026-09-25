use dom_query::Document;
use dom_smoothie::Readability;
use htmd::HtmlToMarkdown;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Article {
    title: String,
    content: String,
    text_content: String,
    url: String,
}

fn extract(html: &str, url: &str, selector: Option<&str>) -> Result<Article, String> {
    let doc = Document::from(html);
    doc.select("script, style, noscript, nav, aside, footer").remove();
    if let Some(selector) = selector {
        let text = doc.select(selector).text().to_string();
        if text.trim().is_empty() {
            return Err("selector matched no readable text".to_string());
        }
        return Ok(Article { title: String::new(), content: String::new(), text_content: text, url: url.to_string() });
    }
    let title = doc.select("title").text().to_string();
    let filtered = doc.html();
    if let Ok(mut readability) = Readability::with_document(Document::from(filtered.clone()), Some(url), None)
        && let Ok(article) = readability.parse()
    {
        let text_content = HtmlToMarkdown::builder().build().convert(&article.content)
            .unwrap_or_else(|_| article.text_content.to_string());
        return Ok(Article { title: article.title.to_string(), content: article.content.to_string(), text_content, url: url.to_string() });
    }
    Ok(Article { title, content: String::new(), text_content: doc.select("body").text().to_string(), url: url.to_string() })
}

#[wasm_bindgen]
pub fn extract_markdown(html: &str, url: &str, selector: Option<String>) -> Result<String, JsValue> {
    let article = extract(html, url, selector.as_deref()).map_err(|error| JsValue::from_str(&error))?;
    let mut markdown = String::new();
    if !article.title.trim().is_empty() { markdown.push_str(&format!("# {}\n\n", article.title.trim())); }
    markdown.push_str(article.text_content.trim());
    Ok(markdown)
}

#[wasm_bindgen]
pub fn extract_json(html: &str, url: &str, selector: Option<String>) -> Result<String, JsValue> {
    let article = extract(html, url, selector.as_deref()).map_err(|error| JsValue::from_str(&error))?;
    serde_json::to_string(&article).map_err(|error| JsValue::from_str(&error.to_string()))
}
