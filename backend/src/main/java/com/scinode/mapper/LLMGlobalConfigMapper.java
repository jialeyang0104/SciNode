package com.scinode.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.scinode.entity.LLMGlobalConfig;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 全局模型配置 Mapper 接口。
 */
@Mapper
public interface LLMGlobalConfigMapper extends BaseMapper<LLMGlobalConfig> {

    @Select("""
            SELECT *
            FROM llm_global_config
            WHERE provider = #{provider}
              AND config_name = #{configName}
            LIMIT 1
            """)
    LLMGlobalConfig findAnyByProviderAndConfigName(@Param("provider") String provider,
                                                   @Param("configName") String configName);

    @Delete("""
            DELETE FROM llm_global_config
            WHERE id = #{id}
            """)
    int hardDeleteById(@Param("id") Long id);
}
