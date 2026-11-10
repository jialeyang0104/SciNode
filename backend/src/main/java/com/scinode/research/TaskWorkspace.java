package com.scinode.research;

import com.alibaba.fastjson2.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/** Human-readable task folders, alongside immutable run records. */
final class TaskWorkspace {
    static void json(Path path, Object value) throws IOException {
        Files.createDirectories(path.getParent());
        Path temp = Files.createTempFile(path.getParent(), ".writing-", ".json");
        try {
            Files.writeString(temp, JSON.toJSONString(value, JSONWriter.Feature.PrettyFormat));
            Files.move(temp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temp); }
    }

    static void prepare(Path dir, JSONObject config, JSONObject input) throws IOException {
        Files.createDirectories(dir.resolve("config"));
        json(dir.resolve("config/node.json"), config);
        json(dir.resolve("config/input.json"), input);
        Files.writeString(dir.resolve("README.md"), "# " + config.getString("label") + "\n\n"
                + "先查看 [任务结果与状态](config/result.json)，再对照 [本次配置](config/node.json) 和 [实际输入](config/input.json)。\n\n"
                + "| 路径 | 用途 |\n|---|---|\n| output/ | 本任务生成的报告、表格和图表 |\n"
                + "| config/ | 当次参数、解析后的输入、运行结果；脚本节点还记录解释器与依赖 |\n"
                + "| src/（脚本节点） | 实际执行代码与随附模块 |\n| logs/（脚本节点） | 标准输出与错误日志 |\n\n"
                + "在完整成果包根目录运行 `python reproduce.py --help` 查看本地脚本复现方法。"
                + "模型、联网检索和人工确认的结果通过本次记录审阅；重新调用应在 SciNode 中建立新运行。\n");
    }

    static void projectReadme(Path workspace, JSONObject project) throws IOException {
        StringBuilder text = new StringBuilder("# " + project.getString("name") + "\n\n"
                + "从 SciNode 项目页面编辑任务；本目录保存导入原件与逐次运行记录。\n\n"
                + "| 路径 | 用途 | 入口 |\n|---|---|---|\n| inputs/ | 已导入原始资料，保持原样 | 应用内资料列表 |\n"
                + "| runs/ | 各次运行的配置、任务代码、结果与审核 | 每次运行的 README.md |\n\n"
                + "当前配置版本：" + project.getInteger("revision") + "。原件、历史运行与冻结成果均需保留。\n");
        try(var runs=Files.list(workspace.resolve("runs"))){
            var latest=runs.filter(Files::isDirectory).sorted(Comparator.comparingLong((Path path)->path.toFile().lastModified()).reversed()).findFirst();
            if(latest.isPresent())text.append("\n现在先看：[最近一次运行](runs/").append(latest.get().getFileName()).append("/README.md)。\n");
        }
        Files.writeString(workspace.resolve("README.md"), text.toString());
    }

    static void runReadme(Path dir, JSONObject run) throws IOException {
        JSONObject project = run.getJSONObject("definition");
        StringBuilder text = new StringBuilder("# " + project.getString("name") + " · 运行 " + run.getString("id") + "\n\n"
                + "项目版本 " + run.getInteger("revision") + "。先按下表审阅任务结果；每个任务的 README 解释参数、代码与产物。\n\n"
                + "[工作流定义](config/workflow.json) · [本次任务输入](config/run-inputs.json)\n\n"
                + "| 任务 | 类型 | 文件入口 |\n|---|---|---|\n");
        for (Object entry : project.getJSONArray("nodes")) {
            JSONObject node = (JSONObject)entry, result = run.getJSONObject("nodeResults").getJSONObject(node.getString("id"));
            text.append("| ").append(node.getJSONObject("data").getString("label").replace("|", "\\|")).append(" | ")
                .append(node.getJSONObject("data").getString("kind")).append(" | ");
            if (result != null && result.getString("reusedFrom") != null)
                text.append("复用运行 ").append(result.getString("reusedFrom")).append("；完整代码与产物随成果包收录");
            else text.append("[打开任务](tasks/").append(node.getString("id")).append("/README.md)");
            text.append(" |\n");
        }
        text.append("\n尚未执行的任务在开始时生成文件。下载成果包后从包内 README.md 进入，可按任务复现本地脚本。\n");
        Files.writeString(dir.resolve("README.md"), text.toString());
        json(dir.resolve("config/workflow.json"), project);
        json(dir.resolve("config/run-inputs.json"), run.getJSONObject("inputs"));
    }
}
