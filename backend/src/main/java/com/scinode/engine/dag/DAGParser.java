package com.scinode.engine.dag;

import com.scinode.engine.model.WorkflowConfig;
import com.scinode.engine.model.WorkflowEdge;
import com.scinode.engine.model.WorkflowNode;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;

/**
 * 为科研运行生成依赖顺序；只规划执行，不修改节点配置或运行数据。
 */
@Component
public class DAGParser {

    public List<WorkflowNode> parse(WorkflowConfig config) {
        DependencyGraph graph = index(config);
        Queue<String> ready = new ArrayDeque<>();
        graph.pending().forEach((id, count) -> {
            if (count == 0) ready.add(id);
        });

        List<WorkflowNode> execution = new ArrayList<>();
        while (!ready.isEmpty()) {
            String completed = ready.remove();
            execution.add(graph.nodes().get(completed));
            for (String next : graph.successors().get(completed)) {
                int pending = graph.pending().merge(next, -1, Integer::sum);
                if (pending == 0) ready.add(next);
            }
        }

        if (execution.size() != graph.nodes().size()) {
            // 未就绪节点包含环及其下游；沿原节点列表报告首个受影响节点，
            // 与原有深度优先检查的诊断保持一致。
            String affected = config.getNodes().stream()
                    .map(WorkflowNode::getId)
                    .filter(id -> graph.pending().get(id) > 0)
                    .findFirst().orElseThrow();
            throw new RuntimeException("工作流存在循环依赖,节点: " + affected);
        }
        return execution;
    }

    private DependencyGraph index(WorkflowConfig config) {
        Map<String, WorkflowNode> nodes = new HashMap<>();
        Map<String, List<String>> prerequisites = new HashMap<>();
        for (WorkflowNode node : config.getNodes()) {
            nodes.put(node.getId(), node);
            prerequisites.put(node.getId(), new ArrayList<>());
        }
        for (WorkflowEdge edge : config.getEdges()) {
            prerequisites.get(edge.getTarget()).add(edge.getSource());
        }

        Map<String, Integer> pending = new HashMap<>();
        Map<String, List<String>> successors = new HashMap<>();
        for (String id : nodes.keySet()) {
            pending.put(id, prerequisites.get(id).size());
            successors.put(id, new ArrayList<>());
        }
        // 沿用原来的索引遍历顺序，避免改变无依赖分支的相对执行次序。
        prerequisites.forEach((target, sources) -> {
            for (String source : sources) {
                successors.get(source).add(target);
            }
        });
        return new DependencyGraph(nodes, pending, successors);
    }

    private record DependencyGraph(
            Map<String, WorkflowNode> nodes,
            Map<String, Integer> pending,
            Map<String, List<String>> successors
    ) {}
}
