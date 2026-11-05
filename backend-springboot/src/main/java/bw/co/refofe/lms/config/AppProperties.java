package bw.co.refofe.lms.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(String jwtSecret, String corsOrigin, String uploadDir, String frontendUrl) {
}
