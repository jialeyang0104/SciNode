-- 执行快照表（断点续执行）
CREATE TABLE IF NOT EXISTS execution_snapshot (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '快照主键 ID',
    execution_id BIGINT NOT NULL COMMENT '执行记录 ID',
    flow_id BIGINT NOT NULL COMMENT '工作流 ID',
    node_id VARCHAR(100) NOT NULL COMMENT '节点 ID',
    node_type VARCHAR(50) NOT NULL COMMENT '节点类型',
    node_name VARCHAR(255) COMMENT '节点名称',
    status VARCHAR(50) NOT NULL COMMENT '节点状态(PENDING/RUNNING/SUCCESS/FAILED/SKIPPED)',
    input_data JSON COMMENT '节点输入数据',
    output_data JSON COMMENT '节点输出数据',
    error_message TEXT COMMENT '错误信息',
    started_at TIMESTAMP NULL COMMENT '开始执行时间',
    completed_at TIMESTAMP NULL COMMENT '完成时间',
    duration INT COMMENT '执行耗时(毫秒)',
    retry_count INT DEFAULT 0 COMMENT '重试次数',
    execution_order INT DEFAULT 0 COMMENT '执行顺序',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_execution_id (execution_id),
    INDEX idx_flow_id (flow_id),
    INDEX idx_node_id (node_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='执行快照表';

-- 执行变量表（断点续执行）
CREATE TABLE IF NOT EXISTS execution_variable (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '变量主键 ID',
    execution_id BIGINT NOT NULL COMMENT '执行记录 ID',
    variable_name VARCHAR(100) NOT NULL COMMENT '变量名',
    variable_type VARCHAR(50) DEFAULT 'STRING' COMMENT '变量类型',
    variable_value TEXT COMMENT '变量值',
    is_modified TINYINT DEFAULT 0 COMMENT '是否被修改(0-否,1-是)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY uk_execution_variable (execution_id, variable_name),
    INDEX idx_execution_id (execution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='执行变量表';