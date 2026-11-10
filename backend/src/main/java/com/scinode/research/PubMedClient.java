package com.scinode.research;

import com.alibaba.fastjson2.*;
import java.io.StringReader;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.*;
import org.xml.sax.InputSource;

/** NCBI search and structured abstracts. XML parsing never loads external entities. */
final class PubMedClient {
    private static final String BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    JSONObject search(JSONObject config) throws Exception {
        String term = config.getString("query");
        if (term == null || term.isBlank()) throw new IllegalArgumentException("请填写 PubMed 检索式");
        int limit = Math.max(1, Math.min(config.getIntValue("limit", 10), 100));
        JSONObject search = JSON.parseObject(get(BASE + "esearch.fcgi?db=pubmed&retmode=json&retmax=" + limit
                + "&term=" + URLEncoder.encode(term, StandardCharsets.UTF_8)));
        JSONObject result = search.getJSONObject("esearchresult");
        if (result == null || result.containsKey("errorlist") || result.containsKey("ERROR") || search.containsKey("error"))
            throw new IllegalStateException("PubMed 检索返回错误: " + search);
        JSONArray ids = result.getJSONArray("idlist");
        JSONArray papers = new JSONArray();
        if (ids != null && !ids.isEmpty()) {
            // Two requests per search, within NCBI's anonymous request-rate limit.
            Thread.sleep(350);
            JSONArray fetched = parseArticles(get(BASE + "efetch.fcgi?db=pubmed&retmode=xml&id=" + String.join(",", ids.toJavaList(String.class))));
            for (Object id : ids) {
                JSONObject paper = fetched.stream().map(o -> (JSONObject)o).filter(o -> id.toString().equals(o.getString("uid")))
                        .findFirst().orElseThrow(() -> new IllegalStateException("PubMed 未返回文献 " + id));
                papers.add(paper);
            }
        }
        long abstracts = papers.stream().filter(o -> !((JSONObject)o).getString("abstract").isBlank()).count();
        StringBuilder text = new StringBuilder("# PubMed 文献检索\n\n检索式：" + term + "\n\n命中 " + result.getString("count")
                + " 篇 · 本次获取 " + papers.size() + " 篇 · 含摘要 " + abstracts + " 篇\n");
        for (Object o : papers) {
            JSONObject p = (JSONObject)o;
            text.append("\n## ").append(p.getString("title")).append("\n\nPMID：[").append(p.getString("uid")).append("](")
                .append(p.getString("url")).append(") · ").append(p.getString("pubdate")).append(" · ").append(p.getString("source"))
                .append("\n\n").append(p.getString("abstract").isBlank() ? "摘要：未报告；需核对原文。" : p.getString("abstract")).append("\n");
        }
        return new JSONObject(Map.of("query", term, "searchedAt", Instant.now().toString(), "total", result.getString("count"),
                "retrieved", papers.size(), "abstractCount", abstracts, "papers", papers, "text", text.toString()));
    }

    static JSONArray parseArticles(String xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.setXIncludeAware(false); factory.setExpandEntityReferences(false);
        factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        var builder = factory.newDocumentBuilder();
        builder.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));
        Document document = builder.parse(new InputSource(new StringReader(xml)));
        if (document.getElementsByTagName("ERROR").getLength() > 0) throw new IllegalArgumentException("PubMed 文献读取失败");
        JSONArray papers = new JSONArray();
        NodeList articles = document.getElementsByTagName("PubmedArticle");
        for (int i = 0; i < articles.getLength(); i++) {
            Element article = (Element)articles.item(i);
            String pmid = first(article, "PMID");
            JSONArray sections = new JSONArray(), authors = new JSONArray();
            StringBuilder abstractText = new StringBuilder();
            NodeList abstracts = article.getElementsByTagName("AbstractText");
            for (int j = 0; j < abstracts.getLength(); j++) {
                Element section = (Element)abstracts.item(j);
                String label = section.getAttribute("Label"), content = section.getTextContent().trim();
                sections.add(Map.of("label", label, "text", content));
                if (!content.isBlank()) abstractText.append(label.isBlank() ? "" : "**" + label + "**：").append(content).append("\n\n");
            }
            NodeList authorNodes = article.getElementsByTagName("Author");
            for (int j = 0; j < authorNodes.getLength(); j++) {
                Element author = (Element)authorNodes.item(j);
                String name = (first(author, "ForeName") + " " + first(author, "LastName")).trim();
                authors.add(Map.of("name", name.isBlank() ? first(author, "CollectiveName") : name));
            }
            String doi = "";
            NodeList identifiers = article.getElementsByTagName("ArticleId");
            for (int j = 0; j < identifiers.getLength(); j++) {
                Element identifier = (Element)identifiers.item(j);
                if ("doi".equals(identifier.getAttribute("IdType"))) doi = identifier.getTextContent().trim();
            }
            NodeList dates = article.getElementsByTagName("PubDate");
            String date = dates.getLength() == 0 ? "未报告" : dates.item(0).getTextContent().trim().replaceAll("\\s+", " ");
            JSONObject p = new JSONObject(Map.of("uid", pmid, "pmid", pmid, "title", first(article, "ArticleTitle"),
                    "source", first(article, "Title"), "pubdate", date, "url", "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/",
                    "abstract", abstractText.toString().trim(), "abstractSections", sections, "authors", authors, "doi", doi));
            papers.add(p);
        }
        return papers;
    }

    private static String first(Element element, String tag) {
        NodeList nodes = element.getElementsByTagName(tag);
        return nodes.getLength() == 0 ? "" : nodes.item(0).getTextContent().trim();
    }

    private String get(String url) throws Exception {
        for (int attempt = 0; attempt < 3; attempt++) {
            var response = client.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(45))
                    .header("User-Agent", "SciNode/1.0 personal-research").GET().build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) return response.body();
            if ((response.statusCode() == 429 || response.statusCode() >= 500) && attempt < 2) { Thread.sleep(1000L * (attempt + 1)); continue; }
            throw new IllegalStateException("PubMed HTTP " + response.statusCode());
        }
        throw new IllegalStateException("PubMed 请求失败");
    }
}
