from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://tiquart:tiquart@db:5432/tiquart"
    redis_url: str = "redis://cache:6379/0"
    mqtt_host: str = "mosquitto"
    mqtt_port: int = 1883
    jwt_secret: str = "dev-secret"
    ticket_secret: str = "dev-ticket-secret"
    admin_token: str = "tiquart-admin"
    hold_ttl_seconds: int = 600
    public_base_url: str = "http://localhost:8080"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)


settings = Settings()
