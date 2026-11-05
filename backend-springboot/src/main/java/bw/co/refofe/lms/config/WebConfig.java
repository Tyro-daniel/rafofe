package bw.co.refofe.lms.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    private final AppProperties properties;
    private final ActivityAuditInterceptor activityAuditInterceptor;

    public WebConfig(AppProperties properties, ActivityAuditInterceptor activityAuditInterceptor) {
        this.properties = properties;
        this.activityAuditInterceptor = activityAuditInterceptor;
    }

    @Override
    public void addInterceptors(org.springframework.web.servlet.config.annotation.InterceptorRegistry registry) {
        registry.addInterceptor(activityAuditInterceptor);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins(
                        properties.corsOrigin(),
                        "http://localhost:4200",
                        "http://127.0.0.1:4200",
                        "http://localhost:8080")
                .allowedMethods("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("Authorization", "Content-Type");
    }
}
