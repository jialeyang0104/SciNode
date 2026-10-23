package com.scinode;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {
        "scinode.auth.jwt-secret=test-jwt-secret-key-for-spring-context-123456",
        "minio.endpoint=http://localhost:9000",
        "minio.accessKey=minioadmin",
        "minio.secretKey=minioadmin",
        "minio.bucketName=scinode",
        "minio.publicUrl=http://localhost:9000",
        "spring.ai.openai.api-key=sk-test-placeholder"
})
class SciNodeApplicationTests {

	@Test
	void contextLoads() {
	}

}
