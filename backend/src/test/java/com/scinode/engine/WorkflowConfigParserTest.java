package com.scinode.engine;

import com.scinode.engine.model.WorkflowConfig;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WorkflowConfigParserTest {

    private final WorkflowConfigParser parser = new WorkflowConfigParser();

    @Test
    void parseUsesDataTypeWhenReactFlowNodeTypeIsWorkflow() {
        String flowData = """
                {
                  "nodes": [
                    {
                      "id": "input-1",
                      "type": "workflow",
                      "data": {
                        "type": "input",
                        "label": "输入节点"
                      },
                      "position": {
                        "x": 180,
                        "y": 160
                      }
                    },
                    {
                      "id": "output-1",
                      "type": "workflow",
                      "data": {
                        "type": "output",
                        "label": "输出节点"
                      },
                      "position": {
                        "x": 500,
                        "y": 160
                      }
                    }
                  ],
                  "edges": []
                }
                """;

        WorkflowConfig config = parser.parse(flowData);

        assertEquals("input", config.getNodes().get(0).getType());
        assertEquals("output", config.getNodes().get(1).getType());
    }

    @Test
    void parseKeepsBusinessNodeTypeWhenAlreadySerialized() {
        String flowData = """
                {
                  "nodes": [
                    {
                      "id": "input-1",
                      "type": "input",
                      "data": {
                        "type": "input",
                        "label": "输入节点"
                      }
                    }
                  ],
                  "edges": []
                }
                """;

        WorkflowConfig config = parser.parse(flowData);

        assertEquals("input", config.getNodes().get(0).getType());
    }
}
