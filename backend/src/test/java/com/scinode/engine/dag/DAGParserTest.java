package com.scinode.engine.dag;

import com.scinode.engine.model.WorkflowConfig;
import com.scinode.engine.model.WorkflowEdge;
import com.scinode.engine.model.WorkflowNode;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class DAGParserTest {
    private final DAGParser parser = new DAGParser();

    @Test
    void emptyWorkflowHasNoExecutionSteps() {
        assertEquals(List.of(), parser.parse(flow(List.of())));
    }

    @Test
    void dependenciesDetermineOrderWithoutChangingNodesOrEdges() {
        WorkflowConfig flow = flow(List.of("export", "review", "source"),
                edge("source", "review"), edge("review", "export"));
        flow.getNodes().get(0).setData(Map.of("format", "docx"));
        List<WorkflowNode> nodesBefore = List.copyOf(flow.getNodes());
        List<WorkflowEdge> edgesBefore = List.copyOf(flow.getEdges());

        List<WorkflowNode> result = parser.parse(flow);

        assertEquals(List.of("source", "review", "export"), ids(result));
        assertSame(flow.getNodes().get(0), result.get(2));
        assertEquals(Map.of("format", "docx"), result.get(2).getData());
        assertEquals(nodesBefore, flow.getNodes());
        assertEquals(edgesBefore, flow.getEdges());
        assertEquals(result, parser.parse(flow));
    }

    @Test
    void branchJoinKeepsExistingSiblingOrderEvenWhenEdgesAreReversed() {
        WorkflowConfig flow = flow(List.of("finish", "b", "a", "start"),
                edge("start", "b"), edge("start", "a"),
                edge("b", "finish"), edge("a", "finish"));

        assertEquals(List.of("start", "a", "b", "finish"), ids(parser.parse(flow)));
    }

    @Test
    void hashCollisionNodeIdsKeepTheirExistingSiblingOrder() {
        WorkflowConfig flow = flow(List.of("finish", "FB", "Ea", "start"),
                edge("start", "Ea"), edge("start", "FB"),
                edge("Ea", "finish"), edge("FB", "finish"));

        assertEquals(List.of("start", "FB", "Ea", "finish"), ids(parser.parse(flow)));
    }

    @Test
    void independentComponentsAndIsolatedNodesAreAllScheduled() {
        WorkflowConfig flow = flow(List.of("d", "c", "b", "a", "e"),
                edge("a", "b"), edge("c", "d"));

        assertEquals(List.of("a", "c", "e", "b", "d"), ids(parser.parse(flow)));
    }

    @Test
    void multipleEdgesBetweenSameNodesDoNotExecuteNodesTwice() {
        WorkflowConfig flow = flow(List.of("a", "b"), edge("a", "b"), edge("a", "b"));

        assertEquals(List.of("a", "b"), ids(parser.parse(flow)));
    }

    @Test
    void selfLoopIsRejectedWithExistingDiagnostic() {
        RuntimeException error = assertThrows(RuntimeException.class,
                () -> parser.parse(flow(List.of("a"), edge("a", "a"))));

        assertEquals("工作流存在循环依赖,节点: a", error.getMessage());
    }

    @Test
    void cycleDiagnosticStillNamesFirstAffectedNodeInWorkflow() {
        WorkflowConfig flow = flow(List.of("finish", "a", "b", "start"),
                edge("start", "a"), edge("a", "b"), edge("b", "a"), edge("b", "finish"));

        RuntimeException error = assertThrows(RuntimeException.class, () -> parser.parse(flow));

        assertEquals("工作流存在循环依赖,节点: finish", error.getMessage());
    }

    private static WorkflowConfig flow(List<String> ids, WorkflowEdge... edges) {
        WorkflowConfig config = new WorkflowConfig();
        config.setNodes(ids.stream().map(id -> {
            WorkflowNode node = new WorkflowNode();
            node.setId(id);
            return node;
        }).toList());
        config.setEdges(Arrays.asList(edges));
        return config;
    }

    private static WorkflowEdge edge(String source, String target) {
        WorkflowEdge edge = new WorkflowEdge();
        edge.setSource(source);
        edge.setTarget(target);
        return edge;
    }

    private static List<String> ids(List<WorkflowNode> nodes) {
        return nodes.stream().map(WorkflowNode::getId).toList();
    }
}
