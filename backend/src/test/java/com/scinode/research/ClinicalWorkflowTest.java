package com.scinode.research;

import com.alibaba.fastjson2.*;
import com.scinode.engine.WorkflowConfigParser;
import com.scinode.engine.dag.DAGParser;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ClinicalWorkflowTest {
    @Test void pubmedParsesStructuredAbstractsWithoutInventingMissingOnes()throws Exception{
        String xml="""
          <!DOCTYPE PubmedArticleSet SYSTEM "https://invalid.example/external.dtd">
          <PubmedArticleSet>
           <PubmedArticle><MedlineCitation><PMID>123</PMID><Article><ArticleTitle>Clinical <i>trial</i></ArticleTitle>
           <Journal><Title>Medicine</Title><JournalIssue><PubDate><Year>2025</Year></PubDate></JournalIssue></Journal>
           <Abstract><AbstractText Label="METHODS">Included 80 adults.</AbstractText><AbstractText Label="RESULTS">HR <b>0.80</b>.</AbstractText></Abstract>
           <AuthorList><Author><LastName>Lee</LastName><ForeName>Ada</ForeName></Author></AuthorList></Article></MedlineCitation>
           <PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/test</ArticleId></ArticleIdList></PubmedData></PubmedArticle>
           <PubmedArticle><MedlineCitation><PMID>456</PMID><Article><ArticleTitle>Letter</ArticleTitle></Article></MedlineCitation></PubmedArticle>
          </PubmedArticleSet>
          """;
        JSONArray papers=PubMedClient.parseArticles(xml);
        assertEquals(2,papers.size());JSONObject first=papers.getJSONObject(0);
        assertEquals("Clinical trial",first.getString("title"));assertEquals(2,first.getJSONArray("abstractSections").size());
        assertTrue(first.getString("abstract").contains("HR 0.80"));assertEquals("10.1000/test",first.getString("doi"));
        assertEquals("",papers.getJSONObject(1).getString("abstract"));
        String xxe="<!DOCTYPE PubmedArticleSet [<!ENTITY leak SYSTEM 'file:///etc/passwd'>]><PubmedArticleSet><PubmedArticle><PMID>1</PMID><ArticleTitle>&leak;</ArticleTitle></PubmedArticle></PubmedArticleSet>";
        assertFalse(PubMedClient.parseArticles(xxe).toJSONString().contains("root:"));
    }
    @Test void livePubmedRetrievesActualAbstracts()throws Exception{
        org.junit.jupiter.api.Assumptions.assumeTrue(Boolean.getBoolean("scinode.test-pubmed"),"显式开启 PubMed 联网验收");
        JSONObject result=new PubMedClient().search(new JSONObject(Map.of("query","heat stroke[Title/Abstract]","limit",2)));
        assertEquals(2,result.getJSONArray("papers").size());assertTrue(result.getIntValue("abstractCount")>0);
        assertTrue(result.getString("text").contains("PMID"));
    }
    @Test void allClinicalTemplatesHaveOrderedDependenciesReviewAndExport(){
        for(String id:ClinicalTemplates.IDS){
            JSONObject flow=ResearchTemplates.flow(id);
            var order=new DAGParser().parse(new WorkflowConfigParser().parse(flow.toJSONString()));
            assertEquals(flow.getJSONArray("nodes").size(),order.size());
            assertEquals("package",order.getLast().getData().get("kind"));
            JSONObject review=flow.getJSONArray("nodes").stream().map(o->(JSONObject)o).filter(n->"approve".equals(n.getJSONObject("data").getString("kind"))).findFirst().orElseThrow();
            assertTrue(review.getJSONObject("data").getJSONArray("reviewChecklist").size()>=3);
            assertTrue(flow.getJSONArray("nodes").stream().map(o->(JSONObject)o).anyMatch(n->"export".equals(n.getJSONObject("data").getString("kind"))));
        }
    }
    @Test void clinicalOutboundPolicyBlocksRowsAndCustomScriptBypassesButAllowsBuiltInSummaries(){
        JSONObject project=ResearchTemplates.flow("cohort");project.put("clinicalData",true);
        project.put("files",new JSONArray(List.of(new JSONObject(Map.of("id","file","name","patients.csv")))));
        JSONObject table=project.getJSONArray("nodes").getJSONObject(1);table.getJSONObject("data").put("fileId","file");
        JSONObject llm=new JSONObject(Map.of("kind","llm","prompt","{{table.text}}\n{{analysis.summary}}"));
        assertDoesNotThrow(()->ClinicalDataPolicy.validateOutbound("model",llm,project));
        for(String field:List.of("preview","columns","dataPath")){
            llm.put("prompt","{{table."+field+"}}");
            assertThrows(IllegalArgumentException.class,()->ClinicalDataPolicy.validateOutbound("model",llm,project));
        }
        JSONObject approval=project.getJSONArray("nodes").stream().map(o->(JSONObject)o).filter(n->n.getString("id").equals("confirm")).findFirst().orElseThrow();
        approval.getJSONObject("data").put("inputs",Map.of("text","{{table.preview}}"));llm.put("prompt","{{confirm.text}}");
        assertThrows(IllegalArgumentException.class,()->ClinicalDataPolicy.validateOutbound("model",llm,project));
        JSONObject analysis=project.getJSONArray("nodes").stream().map(o->(JSONObject)o).filter(n->n.getString("id").equals("analysis")).findFirst().orElseThrow();
        analysis.getJSONObject("data").remove("analysisPreset");llm.put("prompt","{{analysis.text}}");
        assertThrows(IllegalArgumentException.class,()->ClinicalDataPolicy.validateOutbound("model",llm,project));
        project.put("clinicalData",false);assertDoesNotThrow(()->ClinicalDataPolicy.validateOutbound("model",llm,project));
    }
}
