package com.scinode;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.scinode.mapper")
public class SciNodeApplication {

	public static void main(String[] args) {
		SpringApplication.run(SciNodeApplication.class, args);
	}

}
